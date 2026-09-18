-- Master Prompt sections 8-10: distinguish an identical duplicate screenshot
-- (already handled - DUPLICATE status from source_hash, before this import
-- ever reaches OCR) from a NEW screenshot that conflicts with an EXISTING
-- daily_records row (same employee/date/shift/line/product). The latter
-- case only ever surfaced as a generic "DUPLICATE_RECORD" blocker string,
-- with no reference to WHICH record it conflicts with, and no way for an
-- admin to resolve it: approve_import_item_legacy re-checks the same
-- condition and unconditionally raises an exception if DUPLICATE_RECORD is
-- still present, so a genuine conflict could never be pushed through even
-- when the admin determines it isn't really a duplicate.

alter table public.import_items
  add column if not exists conflict_daily_record_ids uuid[],
  add column if not exists conflict_resolution text,
  add column if not exists conflict_resolved_by uuid,
  add column if not exists conflict_resolved_at timestamptz;

-- Capture (read-only) which daily_records rows triggered DUPLICATE_RECORD,
-- so the UI can show the specific conflicting record - no behavior change.
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
  v_conflict_ids uuid[] := '{}';
  v_conflict_row record;
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
        if v_product.product_id is not null then
          for v_conflict_row in
            select d.id from public.daily_records d
            where d.employee_id = v_row.employee_id
              and d.work_date = v_item.work_date
              and d.shift = v_item.shift
              and d.line = v_item.line
              and d.product_id = v_product.product_id
          loop
            v_conflict_ids := array_append(v_conflict_ids, v_conflict_row.id);
            v_reasons := v_reasons || '["DUPLICATE_RECORD"]'::jsonb;
          end loop;
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
        conflict_daily_record_ids = case when array_length(v_conflict_ids, 1) > 0 then v_conflict_ids else conflict_daily_record_ids end,
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

-- Manual approval: adds p_confirm_conflict. When true, a DUPLICATE_RECORD
-- finding no longer blocks approval (every OTHER blocker still does), and
-- the resolution is audited on the import_items row. Default false keeps
-- today's behavior (still raises) for every existing caller.
create or replace function public.approve_import_item_legacy(p_import_item_id uuid, p_actor_id uuid default auth.uid(), p_confirm_conflict boolean default false)
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
  v_conflict_ids uuid[] := '{}';
  v_conflict_row record;
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
        if v_product.product_id is not null then
          for v_conflict_row in
            select d.id from public.daily_records d
            where d.employee_id = v_row.employee_id
              and d.work_date = v_item.work_date
              and d.shift = v_item.shift
              and d.line = v_item.line
              and d.product_id = v_product.product_id
          loop
            v_conflict_ids := array_append(v_conflict_ids, v_conflict_row.id);
            if not p_confirm_conflict then
              v_reasons := v_reasons || '["DUPLICATE_RECORD"]'::jsonb;
            end if;
          end loop;
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
        conflict_daily_record_ids = case when array_length(v_conflict_ids, 1) > 0 then v_conflict_ids else conflict_daily_record_ids end,
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
      pending_reasons = '[]'::jsonb, approved_by = p_actor_id, approved_at = v_now, completed_at = v_now, updated_at = v_now,
      conflict_daily_record_ids = case when array_length(v_conflict_ids, 1) > 0 then v_conflict_ids else conflict_daily_record_ids end,
      conflict_resolution = case when p_confirm_conflict and array_length(v_conflict_ids, 1) > 0 then 'confirmed_import' else conflict_resolution end,
      conflict_resolved_by = case when p_confirm_conflict and array_length(v_conflict_ids, 1) > 0 then p_actor_id else conflict_resolved_by end,
      conflict_resolved_at = case when p_confirm_conflict and array_length(v_conflict_ids, 1) > 0 then v_now else conflict_resolved_at end
  where id = v_item.id;

  insert into public.import_item_events(import_item_id, actor_id, event_type, from_status, to_status, payload)
  values (v_item.id, p_actor_id, 'ADMIN_APPROVED', 'PENDING_APPROVAL', 'APPROVED', jsonb_build_object('created_daily_records', v_created, 'confirmed_conflict', p_confirm_conflict and array_length(v_conflict_ids, 1) > 0));

  return jsonb_build_object('success', true, 'import_item_id', v_item.id, 'created_daily_records', v_created);
end;
$function$;

create or replace function public.approve_import_item(p_import_item_id uuid, p_actor_id uuid default auth.uid(), p_confirm_conflict boolean default false)
 returns jsonb
 language plpgsql
 set search_path to 'public'
as $function$
declare
  v_item public.import_items%rowtype;
begin
  select * into v_item
  from public.import_items
  where id = p_import_item_id
    and status = 'PENDING_APPROVAL'
  for update;

  if not found then
    raise exception 'Import není ve stavu PENDING_APPROVAL nebo neexistuje.' using errcode = 'P0002';
  end if;

  perform public.recalculate_import_item_kpis(p_import_item_id);

  return public.approve_import_item_legacy(p_import_item_id, p_actor_id, p_confirm_conflict);
end;
$function$;
