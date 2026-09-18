-- The previous version of approve_import_item_legacy's p_confirm_conflict
-- path still tried to INSERT a new daily_records row even when the admin
-- confirmed a conflict wasn't a real duplicate - but daily_records has a
-- UNIQUE(employee_id, work_date, shift, line, product_id) constraint, so
-- that INSERT always fails with an unhandled 23505 the moment a conflict
-- genuinely exists (confirmed live in a rolled-back test). "Potvrdit
-- import" must mean update the existing conflicting record with this
-- import's freshly computed values, not create a second row for the same
-- natural key - the constraint makes a true duplicate physically
-- impossible, so replacing is the only coherent interpretation.
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
  v_existing_record_id uuid;
  v_now timestamptz := now();
  v_created integer := 0;
  v_updated integer := 0;
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
      v_existing_record_id := null;
      if p_confirm_conflict and v_product.product_id is not null then
        select d.id into v_existing_record_id
        from public.daily_records d
        where d.employee_id = v_row.employee_id
          and d.work_date = v_item.work_date
          and d.shift = v_item.shift
          and d.line = v_item.line
          and d.product_id = v_product.product_id
        limit 1;
      end if;

      if v_existing_record_id is not null then
        update public.daily_records
        set oee = round(v_product.oee, 2),
            performance = round(v_product.performance, 2),
            available_time = round(v_product.availability, 2),
            position = v_row.position,
            screenshot_path = v_item.screenshot_path,
            import_batch_id = v_item.batch_id,
            updated_at = v_now
        where id = v_existing_record_id;
        v_record_id := v_existing_record_id;
        v_updated := v_updated + 1;
      else
        insert into public.daily_records (
          employee_id, work_date, shift, line, product_id, product, position, oee, performance, available_time,
          help_score, screenshot_path, approval_status, import_batch_id
        ) values (
          v_row.employee_id, v_item.work_date, v_item.shift, v_item.line, v_product.product_id, v_product.product_code, v_row.position,
          round(v_product.oee, 2), round(v_product.performance, 2), round(v_product.availability, 2), 0, v_item.screenshot_path, 'approved', v_item.batch_id
        ) returning id into v_record_id;
        v_created := v_created + 1;
      end if;

      update public.import_item_rows
      set daily_record_id = coalesce(daily_record_id, v_record_id), validation_status = 'VALID'
      where id = v_row.id;

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
  values (v_item.id, p_actor_id, 'ADMIN_APPROVED', 'PENDING_APPROVAL', 'APPROVED', jsonb_build_object('created_daily_records', v_created, 'updated_daily_records', v_updated, 'confirmed_conflict', p_confirm_conflict and array_length(v_conflict_ids, 1) > 0));

  return jsonb_build_object('success', true, 'import_item_id', v_item.id, 'created_daily_records', v_created, 'updated_daily_records', v_updated);
end;
$function$;
