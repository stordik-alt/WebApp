-- Correction to the earlier help_score wiring (20260917030000): Vypomoc is
-- not actually read from daily_records.help_score anywhere in the app - the
-- real system of record is shift_evaluations (one row per employee/work_date
-- /shift, upserted on that key), which is what every report/aggregate
-- (aggregateShifts in src/lib/metrics.ts, via useShiftEvaluations) reads.
-- daily_records.help_score is vestigial and always written as 0 by the
-- manual "Denni data" entry form too. Writing the reviewer-entered
-- import_item_rows.help_score into daily_records.help_score therefore had no
-- effect anywhere in the app - it needs to go into shift_evaluations instead,
-- matching the existing, working manual-entry convention exactly (never
-- creating a parallel model).
create or replace function public.auto_approve_import_item_legacy(p_import_item_id uuid)
 returns jsonb
 language plpgsql
 set search_path to 'public'
as $function$
declare
  v_item public.import_items%rowtype;
  v_row record;
  v_resolved record;
  v_record_id uuid;
  v_now timestamptz := now();
  v_created integer := 0;
  v_oee numeric;
  v_performance numeric;
  v_availability numeric;
  v_hourly jsonb;
  v_reasons jsonb := '[]'::jsonb;
begin
  select * into v_item
  from public.import_items
  where id = p_import_item_id
    and status = 'VALIDATING'
  for update;

  if not found then
    raise exception 'AUTO import není ve stavu VALIDATING nebo neexistuje.' using errcode = 'P0002';
  end if;

  if v_item.work_date is null then v_reasons := v_reasons || '["MISSING_DATE"]'::jsonb; end if;
  if nullif(trim(v_item.shift), '') is null then v_reasons := v_reasons || '["MISSING_SHIFT"]'::jsonb; end if;
  if nullif(trim(v_item.line), '') is null then v_reasons := v_reasons || '["MISSING_LINE"]'::jsonb; end if;
  if nullif(trim(v_item.product_code), '') is null then v_reasons := v_reasons || '["PRODUCT_NOT_FOUND"]'::jsonb; end if;

  select * into v_resolved
  from public.resolve_product_profile(v_item.product_code, coalesce(v_item.work_date, current_date))
  limit 1;

  if v_resolved.product_id is null then
    v_reasons := v_reasons || '["PRODUCT_NOT_FOUND"]'::jsonb;
  elsif v_resolved.profile_id is null then
    v_reasons := v_reasons || '["PRODUCT_PROFILE_MISSING"]'::jsonb;
  elsif not coalesce(v_resolved.profile_complete, false) then
    v_reasons := v_reasons || '["PRODUCT_PROFILE_INCOMPLETE"]'::jsonb;
  end if;

  if not exists (select 1 from public.import_item_rows where import_item_id = v_item.id) then
    v_reasons := v_reasons || '["EMPLOYEE_UNMATCHED"]'::jsonb;
  end if;

  for v_row in
    select r.* from public.import_item_rows r
    where r.import_item_id = v_item.id
    order by r.row_index
  loop
    if v_row.employee_id is null then v_reasons := v_reasons || '["EMPLOYEE_UNMATCHED"]'::jsonb; end if;
    if v_row.position not in ('HA','TUP') then v_reasons := v_reasons || '["POSITION_MISSING"]'::jsonb; end if;
    if v_row.oee is null or not isfinite(v_row.oee::double precision) then v_reasons := v_reasons || '["OEE_MISSING"]'::jsonb; end if;
    if v_row.performance is null or not isfinite(v_row.performance::double precision) then v_reasons := v_reasons || '["PERFORMANCE_MISSING"]'::jsonb; end if;
    if v_row.available_time is null or not isfinite(v_row.available_time::double precision) then v_reasons := v_reasons || '["AVAILABILITY_MISSING"]'::jsonb; end if;
    if v_row.employee_id is not null and v_item.work_date is not null and nullif(trim(v_item.shift), '') is not null and nullif(trim(v_item.line), '') is not null then
      if exists (
        select 1 from public.daily_records d
        where d.employee_id = v_row.employee_id
          and d.work_date = v_item.work_date
          and d.shift = v_item.shift
          and d.line = v_item.line
      ) then
        v_reasons := v_reasons || '["DUPLICATE_RECORD"]'::jsonb;
      end if;
    end if;
  end loop;

  v_hourly := coalesce(v_item.ocr_data -> 'hourly_metrics', '[]'::jsonb);
  if jsonb_array_length(v_hourly) = 0 then v_reasons := v_reasons || '["HOURLY_DATA_MISSING"]'::jsonb; end if;

  select avg((x ->> 'performance_pct')::numeric)
    filter (where (x ->> 'performance_pct') ~ '^-?[0-9]+(\.[0-9]+)?$')
    into v_performance
  from jsonb_array_elements(v_hourly) x;

  select avg((x ->> 'availability_pct')::numeric)
    filter (where (x ->> 'availability_pct') ~ '^-?[0-9]+(\.[0-9]+)?$')
    into v_availability
  from jsonb_array_elements(v_hourly) x;

  v_oee := nullif((v_item.ocr_data ->> 'actual_shift_oee_pct'), '')::numeric;
  if v_oee is null then
    select avg(r.oee) into v_oee
    from public.import_item_rows r
    where r.import_item_id = v_item.id;
  end if;

  if v_performance is null or not isfinite(v_performance::double precision)
    or v_availability is null or not isfinite(v_availability::double precision)
    or v_oee is null or not isfinite(v_oee::double precision) then
    v_reasons := v_reasons || '["HOURLY_KPI_MISSING"]'::jsonb;
  end if;

  select coalesce(jsonb_agg(distinct reason_value), '[]'::jsonb)
    into v_reasons
  from jsonb_array_elements(v_reasons) as reasons(reason_value);

  if jsonb_array_length(v_reasons) > 0 then
    update public.import_items
    set product_id = v_resolved.product_id,
        product_match_status = case when v_resolved.product_id is null then 'UNMATCHED' else 'MATCHED' end,
        product_profile_status = case
          when v_resolved.profile_id is null then 'MISSING'
          when not coalesce(v_resolved.profile_complete, false) then 'INCOMPLETE'
          else 'VALID'
        end,
        pending_reasons = v_reasons,
        status = 'PENDING_APPROVAL',
        updated_at = v_now
    where id = v_item.id;

    insert into public.import_item_events(import_item_id, actor_id, event_type, from_status, to_status, payload)
    values (v_item.id, auth.uid(), 'VALIDATION_BLOCKED', 'VALIDATING', 'PENDING_APPROVAL', jsonb_build_object('blockers', v_reasons));

    return jsonb_build_object('success', false, 'status', 'PENDING_APPROVAL', 'import_item_id', v_item.id, 'blockers', v_reasons, 'created_daily_records', 0);
  end if;

  for v_row in
    select r.* from public.import_item_rows r
    where r.import_item_id = v_item.id
    order by r.row_index
  loop
    insert into public.daily_records (
      employee_id, work_date, shift, line, product_id, product, position, oee, performance, available_time,
      help_score, screenshot_path, approval_status, import_batch_id
    ) values (
      v_row.employee_id, v_item.work_date, v_item.shift, v_item.line, v_resolved.product_id, v_item.product_code, v_row.position,
      round(v_oee, 2), round(v_performance, 2), round(v_availability, 2), 0, v_item.screenshot_path, 'approved', v_item.batch_id
    ) returning id into v_record_id;

    update public.import_item_rows
    set daily_record_id = v_record_id, validation_status = 'VALID'
    where id = v_row.id;
    v_created := v_created + 1;

    if v_row.help_score is not null and v_row.help_score <> 0 then
      insert into public.shift_evaluations (employee_id, work_date, shift, help_score, approval_status)
      values (v_row.employee_id, v_item.work_date, v_item.shift, v_row.help_score, 'approved')
      on conflict (employee_id, work_date, shift)
      do update set help_score = excluded.help_score, approval_status = 'approved', updated_at = v_now;
    end if;
  end loop;

  update public.import_items
  set status = 'AUTO_APPROVED',
      product_id = v_resolved.product_id,
      product_match_status = 'EXACT',
      product_profile_status = 'VALID',
      pending_reasons = '[]'::jsonb,
      completed_at = v_now,
      updated_at = v_now
  where id = v_item.id;

  insert into public.import_item_events(import_item_id, actor_id, event_type, from_status, to_status, payload)
  values (v_item.id, auth.uid(), 'AUTO_APPROVED', 'VALIDATING', 'AUTO_APPROVED', jsonb_build_object('created_daily_records', v_created));

  return jsonb_build_object('success', true, 'status', 'AUTO_APPROVED', 'import_item_id', v_item.id, 'created_daily_records', v_created);
end;
$function$;

create or replace function public.approve_import_item_legacy(p_import_item_id uuid, p_actor_id uuid default auth.uid())
 returns jsonb
 language plpgsql
 set search_path to 'public'
as $function$
declare
  v_item public.import_items%rowtype;
  v_row record;
  v_resolved record;
  v_record_id uuid;
  v_now timestamptz := now();
  v_created integer := 0;
  v_reasons jsonb := '[]'::jsonb;
  v_oee numeric;
  v_performance numeric;
  v_availability numeric;
  v_hourly jsonb;
begin
  if not public.has_role(auth.uid(), 'admin') then
    raise exception 'Schválení importu je povoleno pouze správci.' using errcode = '42501';
  end if;

  select * into v_item
  from public.import_items
  where id = p_import_item_id
    and status = 'PENDING_APPROVAL'
  for update;

  if not found then
    raise exception 'Import není ve stavu PENDING_APPROVAL nebo neexistuje.' using errcode = 'P0002';
  end if;

  if v_item.work_date is null then v_reasons := v_reasons || '["MISSING_DATE"]'::jsonb; end if;
  if nullif(trim(v_item.shift), '') is null then v_reasons := v_reasons || '["MISSING_SHIFT"]'::jsonb; end if;
  if nullif(trim(v_item.line), '') is null then v_reasons := v_reasons || '["MISSING_LINE"]'::jsonb; end if;
  if nullif(trim(v_item.product_code), '') is null then v_reasons := v_reasons || '["PRODUCT_NOT_FOUND"]'::jsonb; end if;

  select * into v_resolved
  from public.resolve_product_profile(v_item.product_code, coalesce(v_item.work_date, current_date))
  limit 1;

  if v_resolved.product_id is null then
    v_reasons := v_reasons || '["PRODUCT_NOT_FOUND"]'::jsonb;
  elsif v_resolved.profile_id is null then
    v_reasons := v_reasons || '["PRODUCT_PROFILE_MISSING"]'::jsonb;
  elsif not coalesce(v_resolved.profile_complete, false) then
    v_reasons := v_reasons || '["PRODUCT_PROFILE_INCOMPLETE"]'::jsonb;
  end if;

  if not exists (select 1 from public.import_item_rows where import_item_id = v_item.id) then
    v_reasons := v_reasons || '["EMPLOYEE_UNMATCHED"]'::jsonb;
  end if;

  for v_row in
    select r.* from public.import_item_rows r where r.import_item_id = v_item.id order by r.row_index
  loop
    if v_row.employee_id is null then v_reasons := v_reasons || '["EMPLOYEE_UNMATCHED"]'::jsonb; end if;
    if v_row.position not in ('HA','TUP') then v_reasons := v_reasons || '["POSITION_MISSING"]'::jsonb; end if;
    if v_row.oee is null or not isfinite(v_row.oee::double precision) then v_reasons := v_reasons || '["OEE_MISSING"]'::jsonb; end if;
    if v_row.performance is null or not isfinite(v_row.performance::double precision) then v_reasons := v_reasons || '["PERFORMANCE_MISSING"]'::jsonb; end if;
    if v_row.available_time is null or not isfinite(v_row.available_time::double precision) then v_reasons := v_reasons || '["AVAILABILITY_MISSING"]'::jsonb; end if;

    if v_row.employee_id is not null and v_item.work_date is not null and nullif(trim(v_item.shift), '') is not null and nullif(trim(v_item.line), '') is not null then
      if exists (
        select 1 from public.daily_records d
        where d.employee_id = v_row.employee_id
          and d.work_date = v_item.work_date
          and d.shift = v_item.shift
          and d.line = v_item.line
      ) then
        v_reasons := v_reasons || '["DUPLICATE_RECORD"]'::jsonb;
      end if;
    end if;
  end loop;

  select coalesce(jsonb_agg(distinct reason_value), '[]'::jsonb)
    into v_reasons
  from jsonb_array_elements(v_reasons) as reasons(reason_value);

  if jsonb_array_length(v_reasons) > 0 then
    update public.import_items
    set product_id = v_resolved.product_id,
        product_match_status = case when v_resolved.product_id is null then 'UNMATCHED' else 'MATCHED' end,
        product_profile_status = case
          when v_resolved.profile_id is null then 'MISSING'
          when not coalesce(v_resolved.profile_complete, false) then 'INCOMPLETE'
          else 'VALID'
        end,
        pending_reasons = v_reasons,
        updated_at = v_now
    where id = v_item.id;
    raise exception 'Import nelze schválit. Nejprve odstraňte všechny blokátory: %', v_reasons using errcode = 'P0001';
  end if;

  v_hourly := coalesce(v_item.ocr_data -> 'hourly_metrics', '[]'::jsonb);
  select avg((x ->> 'performance_pct')::numeric) filter (where (x ->> 'performance_pct') ~ '^-?[0-9]+(\.[0-9]+)?$')
    into v_performance from jsonb_array_elements(v_hourly) x;
  select avg((x ->> 'availability_pct')::numeric) filter (where (x ->> 'availability_pct') ~ '^-?[0-9]+(\.[0-9]+)?$')
    into v_availability from jsonb_array_elements(v_hourly) x;
  v_oee := nullif((v_item.ocr_data ->> 'actual_shift_oee_pct'), '')::numeric;

  if v_oee is null then select avg(r.oee) into v_oee from public.import_item_rows r where r.import_item_id = v_item.id; end if;
  if v_performance is null then select avg(r.performance) into v_performance from public.import_item_rows r where r.import_item_id = v_item.id; end if;
  if v_availability is null then select avg(r.available_time) into v_availability from public.import_item_rows r where r.import_item_id = v_item.id; end if;

  if v_oee is null or not isfinite(v_oee::double precision)
     or v_performance is null or not isfinite(v_performance::double precision)
     or v_availability is null or not isfinite(v_availability::double precision) then
    raise exception 'Import obsahuje neplatné KPI hodnoty.' using errcode = 'P0001';
  end if;

  for v_row in
    select r.* from public.import_item_rows r where r.import_item_id = v_item.id order by r.row_index
  loop
    insert into public.daily_records (
      employee_id, work_date, shift, line, product_id, product, position, oee, performance, available_time,
      help_score, screenshot_path, approval_status, import_batch_id
    ) values (
      v_row.employee_id, v_item.work_date, v_item.shift, v_item.line, v_resolved.product_id, v_item.product_code, v_row.position,
      round(v_oee, 2), round(v_performance, 2), round(v_availability, 2), 0, v_item.screenshot_path, 'approved', v_item.batch_id
    ) returning id into v_record_id;

    update public.import_item_rows
    set daily_record_id = v_record_id, validation_status = 'VALID'
    where id = v_row.id;
    v_created := v_created + 1;

    if v_row.help_score is not null and v_row.help_score <> 0 then
      insert into public.shift_evaluations (employee_id, work_date, shift, help_score, approval_status, approved_by, approved_at)
      values (v_row.employee_id, v_item.work_date, v_item.shift, v_row.help_score, 'approved', p_actor_id, v_now)
      on conflict (employee_id, work_date, shift)
      do update set help_score = excluded.help_score, approval_status = 'approved', approved_by = excluded.approved_by, approved_at = excluded.approved_at, updated_at = v_now;
    end if;
  end loop;

  update public.import_items
  set status = 'APPROVED', product_id = v_resolved.product_id, product_match_status = 'MATCHED', product_profile_status = 'VALID',
      pending_reasons = '[]'::jsonb, approved_by = p_actor_id, approved_at = v_now, completed_at = v_now, updated_at = v_now
  where id = v_item.id;

  insert into public.import_item_events(import_item_id, actor_id, event_type, from_status, to_status, payload)
  values (v_item.id, p_actor_id, 'ADMIN_APPROVED', 'PENDING_APPROVAL', 'APPROVED', jsonb_build_object('created_daily_records', v_created));

  return jsonb_build_object('success', true, 'import_item_id', v_item.id, 'created_daily_records', v_created);
end;
$function$;
