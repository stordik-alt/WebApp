-- Regression fix #3 for the same import pipeline: auto_approve_import_item_legacy
-- checks that each ocr_data.hourly_metrics[].performance_pct / availability_pct
-- value "looks numeric" via a regex before averaging them. That regex was
-- double-escaped (`(\\.[0-9]+)?` instead of `(\.[0-9]+)?`), so in POSIX regex
-- terms it required a literal backslash character before the decimal digits —
-- something that never appears in a real number's text form. The optional
-- group made this invisible for plain integers ("99" still matches
-- `^-?[0-9]+$` with the group simply not participating), which is why this
-- pre-existing bug (unrelated to this session's V19 changes) never surfaced
-- against the old pipeline's rounded-integer OCR percentages. V19 produces
-- full-precision decimals (e.g. 107.335962033386), which always failed the
-- regex, so v_performance/v_availability came back NULL and every V19 import
-- was blocked with HOURLY_KPI_MISSING regardless of how correct the
-- underlying data was. Confirmed via `'107.34' ~ '^-?[0-9]+(\\.[0-9]+)?$'`
-- returning false while the single-backslash version returns true, and via a
-- rolled-back transaction reproducing the exact live blocker before this fix.
--
-- This migration only corrects the two regex literals; every other line is
-- unchanged from the live function (confirmed via pg_get_functiondef).
create or replace function public.auto_approve_import_item_legacy(p_import_item_id uuid)
 returns jsonb
 language plpgsql
 set search_path to 'public'
as $function$
declare
  v_item public.import_items%rowtype;
  v_row record;
  v_product public.products%rowtype;
  v_profile record;
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

  if v_item.product_code is not null then
    select * into v_product
    from public.products p
    where lower(regexp_replace(trim(p.code), '\s+', '', 'g')) = lower(regexp_replace(trim(v_item.product_code), '\s+', '', 'g'))
      and coalesce(p.active, true)
    limit 1;
  end if;

  if v_product.id is null then
    v_reasons := v_reasons || '["PRODUCT_NOT_FOUND"]'::jsonb;
  else
    select * into v_profile
    from public.product_profiles pp
    where pp.valid_to is null
      and pp.valid_from <= v_item.work_date
      and pp.ha_subassy is not null
      and pp.tup_subassy is not null
      and (
        lower(regexp_replace(trim(pp.ha_subassy), '\s+', '', 'g')) = lower(regexp_replace(trim(v_item.product_code), '\s+', '', 'g'))
        or lower(regexp_replace(trim(pp.ha_subassy), '\s+', '', 'g')) = lower(regexp_replace(trim(v_product.code), '\s+', '', 'g'))
        or lower(regexp_replace(trim(pp.tup_subassy), '\s+', '', 'g')) = lower(regexp_replace(trim(v_item.product_code), '\s+', '', 'g'))
      )
    order by pp.valid_from desc, pp.version_no desc
    limit 1;

    if v_profile.id is null then
      v_reasons := v_reasons || '["PRODUCT_PROFILE_MISSING"]'::jsonb;
    elsif v_profile.ha_subassy is null or v_profile.tup_subassy is null
      or v_profile.h_norm_per_hour is null or v_profile.h_norm_per_hour <= 0
      or v_profile.t_norm_per_hour is null or v_profile.t_norm_per_hour <= 0
      or v_profile.h_capacity is null or v_profile.h_capacity < 1
      or v_profile.t_capacity is null or v_profile.t_capacity < 1 then
      v_reasons := v_reasons || '["PRODUCT_PROFILE_INCOMPLETE"]'::jsonb;
    end if;
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
    set product_id = v_product.id,
        product_match_status = case when v_product.id is null then 'UNMATCHED' else 'MATCHED' end,
        product_profile_status = case
          when v_profile.id is null then 'MISSING'
          when v_profile.ha_subassy is null or v_profile.tup_subassy is null
            or v_profile.h_norm_per_hour is null or v_profile.h_norm_per_hour <= 0
            or v_profile.t_norm_per_hour is null or v_profile.t_norm_per_hour <= 0
            or v_profile.h_capacity is null or v_profile.h_capacity < 1
            or v_profile.t_capacity is null or v_profile.t_capacity < 1 then 'INCOMPLETE'
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

  -- All validation, duplicate checks and inserts are inside this single RPC transaction.
  for v_row in
    select r.* from public.import_item_rows r
    where r.import_item_id = v_item.id
    order by r.row_index
  loop
    insert into public.daily_records (
      employee_id, work_date, shift, line, product_id, product, position, oee, performance, available_time,
      help_score, screenshot_path, approval_status, import_batch_id
    ) values (
      v_row.employee_id, v_item.work_date, v_item.shift, v_item.line, v_product.id, v_item.product_code, v_row.position,
      round(v_oee, 2), round(v_performance, 2), round(v_availability, 2), 0, v_item.screenshot_path, 'approved', v_item.batch_id
    ) returning id into v_record_id;

    update public.import_item_rows
    set daily_record_id = v_record_id, validation_status = 'VALID'
    where id = v_row.id;
    v_created := v_created + 1;
  end loop;

  update public.import_items
  set status = 'AUTO_APPROVED',
      product_id = v_product.id,
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
