-- Part A of "Master Prompt Agent Hodnoceni Pracovniku": when one screenshot's
-- shift spans multiple products (import_item_hourly already supports
-- multiple distinct product_code values per item), the approval pipeline
-- must create one independent daily_records row per employee PER PRODUCT,
-- each with its own performance/availability/OEE computed only from that
-- product's hours - not a single row per employee blending every product's
-- hours together, which is what recalculate_import_item_kpis /
-- auto_approve_import_item_legacy / approve_import_item_legacy did before
-- this migration.
--
-- Confirmed scope with the user: OCR/screenshot data does not indicate which
-- specific employee worked which specific product when a shift changes
-- products mid-shift - every employee listed for the shift is credited
-- against every product actually produced that shift. This means no new
-- employee-to-hour/product attribution table is needed; splitting only
-- needs to happen at the KPI-computation and daily_records-insert level.
--
-- 1) daily_records' uniqueness key gains product_id, so the same
--    employee/date/shift/line can now legitimately hold one row per
--    product. product_id has never been null in practice (verified: 0 of 32
--    existing rows), so this is a purely additive, non-breaking change.
alter table public.daily_records
  drop constraint if exists daily_records_employee_id_work_date_shift_line_key;
alter table public.daily_records
  add constraint daily_records_employee_id_work_date_shift_line_product_id_key
  unique (employee_id, work_date, shift, line, product_id);

-- 2) New helper: for a given import_item, compute one minutes-weighted
-- performance/availability/OEE triple PER DISTINCT product_code found in
-- its import_item_hourly rows (mirrors recalculate_import_item_kpis' existing
-- weighting logic, just grouped by product instead of blended across all of
-- them), and resolve each product's identity/profile via the same canonical
-- resolve_product_profile() used everywhere else - so a multi-product shift
-- gets the same ha_subassy/tup_subassy suffix-fallback matching as a
-- single-product one, per product.
create or replace function public.compute_import_item_product_kpis(p_import_item_id uuid, p_work_date date default current_date)
returns table (
  product_code text,
  product_id uuid,
  product_name text,
  profile_id uuid,
  profile_complete boolean,
  performance numeric,
  availability numeric,
  oee numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r record;
  v_resolved record;
begin
  for r in
    select
      h.product_code as pcode,
      case when sum(w.minutes) filter (where h.performance_pct is not null) > 0
        then sum(h.performance_pct * w.minutes) filter (where h.performance_pct is not null) / sum(w.minutes) filter (where h.performance_pct is not null)
        else null end as perf,
      case when sum(w.minutes) filter (where h.availability_pct is not null) > 0
        then sum(h.availability_pct * w.minutes) filter (where h.availability_pct is not null) / sum(w.minutes) filter (where h.availability_pct is not null)
        else null end as avail,
      case when sum(w.minutes) filter (where h.actual_oee_pct is not null) > 0
        then sum(h.actual_oee_pct * w.minutes) filter (where h.actual_oee_pct is not null) / sum(w.minutes) filter (where h.actual_oee_pct is not null)
        else null end as oee_val
    from public.import_item_hourly h
    cross join lateral (
      select coalesce(
        nullif(trim(coalesce(h.raw_data -> 'calculation' ->> 'reconstructed_productive_minutes', '')), '')::double precision,
        0
      ) as minutes
    ) w
    where h.import_item_id = p_import_item_id
      and nullif(trim(coalesce(h.product_code, '')), '') is not null
    group by h.product_code
  loop
    select * into v_resolved from public.resolve_product_profile(r.pcode, p_work_date) limit 1;
    product_code := r.pcode;
    performance := r.perf;
    availability := r.avail;
    oee := r.oee_val;
    if found then
      product_id := v_resolved.product_id;
      product_name := v_resolved.product_name;
      profile_id := v_resolved.profile_id;
      profile_complete := coalesce(v_resolved.profile_complete, false);
    else
      product_id := null;
      product_name := null;
      profile_id := null;
      profile_complete := false;
    end if;
    return next;
  end loop;
  return;
end;
$$;

grant execute on function public.compute_import_item_product_kpis(uuid, date) to authenticated;

-- 3) Rewire both approval RPCs to validate and insert per product instead of
-- per item. Known limitation: import_item_rows.daily_record_id is a single
-- column and can now only reference one of the (possibly several)
-- daily_records rows created for that employee - it is set to the first
-- created record, same as before this migration for the single-product
-- case, and its only real purpose (marking the row as finalized so nothing
-- re-touches it) still holds for the multi-product case too.
create or replace function public.auto_approve_import_item_legacy(p_import_item_id uuid)
 returns jsonb
 language plpgsql
 set search_path to 'public'
as $function$
declare
  v_item public.import_items%rowtype;
  v_row record;
  v_product record;
  v_record_id uuid;
  v_now timestamptz := now();
  v_created integer := 0;
  v_product_count integer := 0;
  v_first_product record;
  v_first_product_set boolean := false;
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
  end loop;

  for v_product in select * from public.compute_import_item_product_kpis(v_item.id, coalesce(v_item.work_date, current_date)) loop
    v_product_count := v_product_count + 1;
    if not v_first_product_set then v_first_product := v_product; v_first_product_set := true; end if;
    if v_product.product_id is null then
      v_reasons := v_reasons || '["PRODUCT_NOT_FOUND"]'::jsonb;
    elsif v_product.profile_id is null then
      v_reasons := v_reasons || '["PRODUCT_PROFILE_MISSING"]'::jsonb;
    elsif not v_product.profile_complete then
      v_reasons := v_reasons || '["PRODUCT_PROFILE_INCOMPLETE"]'::jsonb;
    end if;
    if v_product.performance is null or not isfinite(v_product.performance::double precision)
      or v_product.availability is null or not isfinite(v_product.availability::double precision)
      or v_product.oee is null or not isfinite(v_product.oee::double precision) then
      v_reasons := v_reasons || '["HOURLY_KPI_MISSING"]'::jsonb;
    end if;
  end loop;
  if v_product_count = 0 then
    v_reasons := v_reasons || '["HOURLY_DATA_MISSING"]'::jsonb;
  end if;

  if v_item.work_date is not null and nullif(trim(v_item.shift), '') is not null and nullif(trim(v_item.line), '') is not null then
    for v_row in select r.* from public.import_item_rows r where r.import_item_id = v_item.id and r.employee_id is not null loop
      for v_product in select * from public.compute_import_item_product_kpis(v_item.id, coalesce(v_item.work_date, current_date)) loop
        if v_product.product_id is not null and exists (
          select 1 from public.daily_records d
          where d.employee_id = v_row.employee_id
            and d.work_date = v_item.work_date
            and d.shift = v_item.shift
            and d.line = v_item.line
            and d.product_id = v_product.product_id
        ) then
          v_reasons := v_reasons || '["DUPLICATE_RECORD"]'::jsonb;
        end if;
      end loop;
    end loop;
  end if;

  select coalesce(jsonb_agg(distinct reason_value), '[]'::jsonb)
    into v_reasons
  from jsonb_array_elements(v_reasons) as reasons(reason_value);

  if jsonb_array_length(v_reasons) > 0 then
    update public.import_items
    set product_id = v_first_product.product_id,
        product_match_status = case when v_first_product.product_id is null then 'UNMATCHED' else 'MATCHED' end,
        product_profile_status = case
          when v_first_product.product_id is null then 'MISSING'
          when v_first_product.profile_id is null then 'MISSING'
          when not v_first_product.profile_complete then 'INCOMPLETE'
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

  for v_product in select * from public.compute_import_item_product_kpis(v_item.id, coalesce(v_item.work_date, current_date)) loop
    for v_row in
      select r.* from public.import_item_rows r
      where r.import_item_id = v_item.id
      order by r.row_index
    loop
      insert into public.daily_records (
        employee_id, work_date, shift, line, product_id, product, position, oee, performance, available_time,
        help_score, screenshot_path, approval_status, import_batch_id
      ) values (
        v_row.employee_id, v_item.work_date, v_item.shift, v_item.line, v_product.product_id, v_product.product_code, v_row.position,
        round(v_product.oee, 2), round(v_product.performance, 2), round(v_product.availability, 2), 0, v_item.screenshot_path, 'approved', v_item.batch_id
      ) returning id into v_record_id;

      update public.import_item_rows
      set daily_record_id = coalesce(daily_record_id, v_record_id), validation_status = 'VALID'
      where id = v_row.id;
      v_created := v_created + 1;

      if v_row.help_score is not null and v_row.help_score <> 0 then
        insert into public.shift_evaluations (employee_id, work_date, shift, help_score, approval_status)
        values (v_row.employee_id, v_item.work_date, v_item.shift, v_row.help_score, 'approved')
        on conflict (employee_id, work_date, shift)
        do update set help_score = excluded.help_score, approval_status = 'approved', updated_at = v_now;
      end if;
    end loop;
  end loop;

  update public.import_items
  set status = 'AUTO_APPROVED',
      product_id = v_first_product.product_id,
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
  v_product record;
  v_record_id uuid;
  v_now timestamptz := now();
  v_created integer := 0;
  v_product_count integer := 0;
  v_first_product record;
  v_first_product_set boolean := false;
  v_reasons jsonb := '[]'::jsonb;
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

  if not exists (select 1 from public.import_item_rows where import_item_id = v_item.id) then
    v_reasons := v_reasons || '["EMPLOYEE_UNMATCHED"]'::jsonb;
  end if;

  for v_row in
    select r.* from public.import_item_rows r where r.import_item_id = v_item.id order by r.row_index
  loop
    if v_row.employee_id is null then v_reasons := v_reasons || '["EMPLOYEE_UNMATCHED"]'::jsonb; end if;
    if v_row.position not in ('HA','TUP') then v_reasons := v_reasons || '["POSITION_MISSING"]'::jsonb; end if;
  end loop;

  for v_product in select * from public.compute_import_item_product_kpis(v_item.id, coalesce(v_item.work_date, current_date)) loop
    v_product_count := v_product_count + 1;
    if not v_first_product_set then v_first_product := v_product; v_first_product_set := true; end if;
    if v_product.product_id is null then
      v_reasons := v_reasons || '["PRODUCT_NOT_FOUND"]'::jsonb;
    elsif v_product.profile_id is null then
      v_reasons := v_reasons || '["PRODUCT_PROFILE_MISSING"]'::jsonb;
    elsif not v_product.profile_complete then
      v_reasons := v_reasons || '["PRODUCT_PROFILE_INCOMPLETE"]'::jsonb;
    end if;
    if v_product.performance is null or not isfinite(v_product.performance::double precision)
      or v_product.availability is null or not isfinite(v_product.availability::double precision)
      or v_product.oee is null or not isfinite(v_product.oee::double precision) then
      v_reasons := v_reasons || '["HOURLY_KPI_MISSING"]'::jsonb;
    end if;
  end loop;
  if v_product_count = 0 then
    v_reasons := v_reasons || '["HOURLY_DATA_MISSING"]'::jsonb;
  end if;

  if v_item.work_date is not null and nullif(trim(v_item.shift), '') is not null and nullif(trim(v_item.line), '') is not null then
    for v_row in select r.* from public.import_item_rows r where r.import_item_id = v_item.id and r.employee_id is not null loop
      for v_product in select * from public.compute_import_item_product_kpis(v_item.id, coalesce(v_item.work_date, current_date)) loop
        if v_product.product_id is not null and exists (
          select 1 from public.daily_records d
          where d.employee_id = v_row.employee_id
            and d.work_date = v_item.work_date
            and d.shift = v_item.shift
            and d.line = v_item.line
            and d.product_id = v_product.product_id
        ) then
          v_reasons := v_reasons || '["DUPLICATE_RECORD"]'::jsonb;
        end if;
      end loop;
    end loop;
  end if;

  select coalesce(jsonb_agg(distinct reason_value), '[]'::jsonb)
    into v_reasons
  from jsonb_array_elements(v_reasons) as reasons(reason_value);

  if jsonb_array_length(v_reasons) > 0 then
    update public.import_items
    set product_id = v_first_product.product_id,
        product_match_status = case when v_first_product.product_id is null then 'UNMATCHED' else 'MATCHED' end,
        product_profile_status = case
          when v_first_product.product_id is null then 'MISSING'
          when v_first_product.profile_id is null then 'MISSING'
          when not v_first_product.profile_complete then 'INCOMPLETE'
          else 'VALID'
        end,
        pending_reasons = v_reasons,
        updated_at = v_now
    where id = v_item.id;
    raise exception 'Import nelze schválit. Nejprve odstraňte všechny blokátory: %', v_reasons using errcode = 'P0001';
  end if;

  for v_product in select * from public.compute_import_item_product_kpis(v_item.id, coalesce(v_item.work_date, current_date)) loop
    for v_row in
      select r.* from public.import_item_rows r where r.import_item_id = v_item.id order by r.row_index
    loop
      insert into public.daily_records (
        employee_id, work_date, shift, line, product_id, product, position, oee, performance, available_time,
        help_score, screenshot_path, approval_status, import_batch_id
      ) values (
        v_row.employee_id, v_item.work_date, v_item.shift, v_item.line, v_product.product_id, v_product.product_code, v_row.position,
        round(v_product.oee, 2), round(v_product.performance, 2), round(v_product.availability, 2), 0, v_item.screenshot_path, 'approved', v_item.batch_id
      ) returning id into v_record_id;

      update public.import_item_rows
      set daily_record_id = coalesce(daily_record_id, v_record_id), validation_status = 'VALID'
      where id = v_row.id;
      v_created := v_created + 1;

      if v_row.help_score is not null and v_row.help_score <> 0 then
        insert into public.shift_evaluations (employee_id, work_date, shift, help_score, approval_status, approved_by, approved_at)
        values (v_row.employee_id, v_item.work_date, v_item.shift, v_row.help_score, 'approved', p_actor_id, v_now)
        on conflict (employee_id, work_date, shift)
        do update set help_score = excluded.help_score, approval_status = 'approved', approved_by = excluded.approved_by, approved_at = excluded.approved_at, updated_at = v_now;
      end if;
    end loop;
  end loop;

  update public.import_items
  set status = 'APPROVED', product_id = v_first_product.product_id, product_match_status = 'MATCHED', product_profile_status = 'VALID',
      pending_reasons = '[]'::jsonb, approved_by = p_actor_id, approved_at = v_now, completed_at = v_now, updated_at = v_now
  where id = v_item.id;

  insert into public.import_item_events(import_item_id, actor_id, event_type, from_status, to_status, payload)
  values (v_item.id, p_actor_id, 'ADMIN_APPROVED', 'PENDING_APPROVAL', 'APPROVED', jsonb_build_object('created_daily_records', v_created));

  return jsonb_build_object('success', true, 'import_item_id', v_item.id, 'created_daily_records', v_created);
end;
$function$;
