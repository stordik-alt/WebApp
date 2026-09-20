-- Fixes a real bug found while running today's OEE historical recompute:
-- _historical_recompute_run() / apply_ha_tup_capping() / the new
-- refresh_daily_records_for_import_item() all located the daily_records
-- row(s) to update via
--   import_batch_id = v_item.batch_id AND work_date = ... AND shift = ...
--   AND line = v_item.line AND product_id = ...
-- `import_items.line` is the raw line string as parsed/entered at import
-- time (e.g. "HandAssy L1/4 HF"), while `daily_records.line` can carry a
-- fuller/differently-formatted value (e.g. "041.01 - HandAssy L1/4 HF") -
-- confirmed live: import_item 8df2cf05-2128-45dd-9871-723769e8da0a has
-- line="HandAssy L1/4 HF" while its own daily_records rows have
-- line="041.01 - HandAssy L1/4 HF". The exact-string match silently
-- updates 0 rows whenever the two differ, leaving daily_records.oee/
-- performance stale forever with no error surfaced anywhere - 13 of the 74
-- live daily_records rows were affected by exactly this when the OEE fix's
-- historical recompute ran today.
--
-- Fix: add a real foreign key (daily_records.import_item_id) set at
-- approval time, and switch every recompute/capping function to match on
-- (import_item_id, product_id) instead of the fragile batch+date+shift+
-- line combination. import_item_id can never drift out of sync the way a
-- freeform text field can. Existing rows are backfilled best-effort via
-- import_item_rows.daily_record_id (reliable for the first product per
-- employee - see the documented limitation in
-- 20260917080000_multi_product_daily_records.sql) and, for the remainder,
-- via import_batch_id + work_date + shift + product_id matched against the
-- product codes actually present in that import_item's hourly data - only
-- when exactly one import_item qualifies, to avoid guessing under genuine
-- ambiguity (Master Prompt principle: don't invent precision the data
-- doesn't support).

alter table public.daily_records
  add column if not exists import_item_id uuid references public.import_items(id) on delete set null;

create index if not exists idx_daily_records_import_item_id
  on public.daily_records(import_item_id)
  where import_item_id is not null;

-- Backfill (a): reliable link already recorded on import_item_rows.
update public.daily_records d
set import_item_id = ir.import_item_id
from public.import_item_rows ir
where ir.daily_record_id = d.id
  and d.import_item_id is null;

-- Backfill (b): fallback for rows a multi-product approval didn't get to
-- link via import_item_rows.daily_record_id (that column only ever holds
-- the first product's record per employee). Only applied when exactly one
-- import_item in the same batch/date/shift actually produced hourly data
-- for that product - an ambiguous match is left null rather than guessed.
with candidates as (
  select
    d.id as daily_record_id,
    i.id as import_item_id,
    count(*) over (partition by d.id) as match_count
  from public.daily_records d
  join public.import_items i
    on i.batch_id = d.import_batch_id
   and i.work_date = d.work_date
   and i.shift = d.shift
  where d.import_item_id is null
    and d.import_batch_id is not null
    and exists (
      select 1 from public.import_item_hourly h
      where h.import_item_id = i.id
        and public.codes_match(
              lower(regexp_replace(coalesce(h.product_code, ''), '\s+', '', 'g')),
              lower(regexp_replace(coalesce(d.product, ''), '\s+', '', 'g'))
            )
    )
)
update public.daily_records d
set import_item_id = c.import_item_id
from candidates c
where c.daily_record_id = d.id
  and c.match_count = 1;

-- auto_approve_import_item_legacy(): set import_item_id on every new
-- daily_records row (was: 20260919090000_duplicate_vs_conflict_resolution.sql).
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
        help_score, screenshot_path, approval_status, import_batch_id, import_item_id
      ) values (
        v_row.employee_id, v_item.work_date, v_item.shift, v_item.line, v_product.product_id, v_product.product_code, v_row.position,
        round(v_product.oee, 2), round(v_product.performance, 2), round(v_product.availability, 2), 0, v_item.screenshot_path, 'approved', v_item.batch_id, v_item.id
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

-- approve_import_item_legacy(): set import_item_id on both the insert and
-- the update-existing-conflict path (was:
-- 20260919091000_fix_confirm_conflict_upsert_not_insert.sql).
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
            import_item_id = v_item.id,
            updated_at = v_now
        where id = v_existing_record_id;
        v_record_id := v_existing_record_id;
        v_updated := v_updated + 1;
      else
        insert into public.daily_records (
          employee_id, work_date, shift, line, product_id, product, position, oee, performance, available_time,
          help_score, screenshot_path, approval_status, import_batch_id, import_item_id
        ) values (
          v_row.employee_id, v_item.work_date, v_item.shift, v_item.line, v_product.product_id, v_product.product_code, v_row.position,
          round(v_product.oee, 2), round(v_product.performance, 2), round(v_product.availability, 2), 0, v_item.screenshot_path, 'approved', v_item.batch_id, v_item.id
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

-- _historical_recompute_run(): match daily_records via import_item_id
-- instead of the fragile batch+date+shift+line combination.
create or replace function public._historical_recompute_run(p_work_date_from date, p_work_date_to date, p_sample_limit integer)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_item record;
  v_total integer := 0;
  v_changed integer := 0;
  v_unchanged integer := 0;
  v_errors integer := 0;
  v_needs_review integer := 0;
  v_reopened integer := 0;
  v_error_list jsonb := '[]'::jsonb;
  v_needs_review_list jsonb := '[]'::jsonb;
  v_batches uuid[] := '{}';
  v_before jsonb;
  v_after jsonb;
  v_product record;
  v_item_reasons jsonb;
  v_item_needs_review boolean;
  v_reason_code text;
begin
  for v_item in
    select i.id, i.batch_id, i.work_date, i.shift, i.line, i.status
    from import_items i
    where i.status in ('AUTO_APPROVED', 'APPROVED')
      and (p_work_date_from is null or i.work_date >= p_work_date_from)
      and (p_work_date_to is null or i.work_date <= p_work_date_to)
    order by i.work_date, i.id
    limit p_sample_limit
  loop
    v_total := v_total + 1;
    begin
      select jsonb_agg(jsonb_build_object('id', id, 'performance_pct', performance_pct, 'availability_pct', availability_pct, 'actual_oee_pct', actual_oee_pct) order by id)
      into v_before from import_item_hourly where import_item_id = v_item.id;

      perform reconstruct_import_item_hourly(v_item.id);

      select jsonb_agg(jsonb_build_object('id', id, 'performance_pct', performance_pct, 'availability_pct', availability_pct, 'actual_oee_pct', actual_oee_pct) order by id)
      into v_after from import_item_hourly where import_item_id = v_item.id;

      if v_before is distinct from v_after then v_changed := v_changed + 1; else v_unchanged := v_unchanged + 1; end if;

      v_item_reasons := '[]'::jsonb;
      v_item_needs_review := false;

      for v_product in select * from compute_import_item_product_kpis(v_item.id, v_item.work_date) loop
        if v_product.product_id is null or v_product.performance is null or v_product.availability is null or v_product.oee is null then
          v_needs_review := v_needs_review + 1;
          v_item_needs_review := true;
          v_reason_code := case
            when v_product.product_id is null then 'PRODUCT_NOT_FOUND'
            when not coalesce(v_product.profile_complete, false) then 'PRODUCT_PROFILE_MISSING'
            else 'HOURLY_KPI_MISSING'
          end;
          if not (v_item_reasons ? v_reason_code) then
            v_item_reasons := v_item_reasons || to_jsonb(v_reason_code);
          end if;
          v_needs_review_list := v_needs_review_list || jsonb_build_object(
            'import_item_id', v_item.id,
            'work_date', v_item.work_date,
            'line', v_item.line,
            'product_code', v_product.product_code,
            'reason', case
              when v_product.product_id is null then 'Produkt nenalezen v databázi'
              when not coalesce(v_product.profile_complete, false) then 'Product Profile chybí nebo není kompletní'
              else 'KPI se nepodařilo dopočítat'
            end
          );
          continue;
        end if;
        update daily_records
        set oee = round(v_product.oee, 2), performance = round(v_product.performance, 2), available_time = round(v_product.availability, 2)
        where import_item_id = v_item.id and product_id = v_product.product_id;
      end loop;

      if v_item_needs_review then
        update import_items
        set status = 'PENDING_APPROVAL',
            pending_reasons = v_item_reasons,
            product_profile_status = case when v_item_reasons ? 'PRODUCT_PROFILE_MISSING' then 'MISSING' else product_profile_status end
        where id = v_item.id and status in ('AUTO_APPROVED', 'APPROVED');
        if found then
          v_reopened := v_reopened + 1;
          insert into import_item_events (import_item_id, event_type, from_status, to_status, payload)
          values (v_item.id, 'RECOMPUTE_NEEDS_REVIEW', v_item.status, 'PENDING_APPROVAL', jsonb_build_object('reasons', v_item_reasons));
        end if;
      end if;

      if v_item.batch_id is not null and not (v_item.batch_id = any(v_batches)) then
        v_batches := v_batches || v_item.batch_id;
      end if;
    exception when others then
      v_errors := v_errors + 1;
      v_error_list := v_error_list || jsonb_build_object('import_item_id', v_item.id, 'work_date', v_item.work_date, 'error', sqlerrm);
    end;
  end loop;

  declare v_batch_id uuid;
  begin
    foreach v_batch_id in array v_batches loop
      perform evaluate_batch_ha_tup_linkage(v_batch_id);
    end loop;
  end;

  return jsonb_build_object(
    'total', v_total, 'changed', v_changed, 'unchanged', v_unchanged,
    'needs_review', v_needs_review, 'needs_review_details', v_needs_review_list,
    'reopened_for_review', v_reopened,
    'errors', v_errors, 'error_details', v_error_list,
    'batches_relinked', array_length(v_batches, 1)
  );
end;
$function$;

-- apply_ha_tup_capping(): match daily_records via import_item_id instead
-- of the fragile batch+date+shift+line combination.
create or replace function public.apply_ha_tup_capping(
  p_tup_import_item_id uuid,
  p_tup_product_code text,
  p_allocation_fraction numeric default 1.0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.import_items%rowtype;
  v_link record;
  v_shift_start_hour integer;
  r record;
  v_cum_ha numeric;
  v_allocated_ha numeric;
  v_expected_before numeric;
  v_expected_after numeric;
  v_perf_new numeric;
  v_oee_new numeric;
  v_updated integer := 0;
  v_product record;
begin
  select * into v_item from public.import_items where id = p_tup_import_item_id;
  if not found or v_item.work_date is null or nullif(trim(coalesce(v_item.shift,'')),'') is null or nullif(trim(coalesce(v_item.line,'')),'') is null then
    return jsonb_build_object('status', 'SKIPPED', 'reason', 'missing_header');
  end if;

  select * into v_link from public.find_ha_tup_link(p_tup_product_code, v_item.line, v_item.work_date, v_item.shift) limit 1;

  if v_link.match_status = 'NONE' or v_link.ha_import_item_ids is null or array_length(v_link.ha_import_item_ids, 1) = 0 then
    return jsonb_build_object('status', coalesce(v_link.match_status, 'NONE'));
  end if;

  v_shift_start_hour := public.auto_shift_start_minute(v_item.shift) / 60;

  for r in
    select h.id, h.hour, h.actual_output,
      nullif(trim(coalesce(h.raw_data -> 'calculation' ->> 'expected_output_at_current_staffing', '')), '')::numeric as expected,
      h.availability_pct,
      ((h.hour - v_shift_start_hour + 24) % 24) as rel_hour
    from public.import_item_hourly h
    where h.import_item_id = p_tup_import_item_id
      and public.codes_match(
            lower(regexp_replace(coalesce(h.product_code, ''), '\s+', '', 'g')),
            lower(regexp_replace(p_tup_product_code, '\s+', '', 'g'))
          )
    order by ((h.hour - v_shift_start_hour + 24) % 24)
  loop
    select coalesce(sum(h2.actual_output), 0)
    into v_cum_ha
    from public.import_item_hourly h2
    where h2.import_item_id = any(v_link.ha_import_item_ids)
      and public.codes_match(
            lower(regexp_replace(coalesce(h2.product_code, ''), '\s+', '', 'g')),
            lower(regexp_replace(v_link.ha_product_code, '\s+', '', 'g'))
          )
      and ((h2.hour - v_shift_start_hour + 24) % 24) <= r.rel_hour;

    v_allocated_ha := v_cum_ha * p_allocation_fraction;

    v_expected_before := r.expected;
    if v_expected_before is null or v_expected_before <= 0 then
      continue;
    end if;

    v_expected_after := least(v_expected_before, v_allocated_ha);
    if v_expected_after <= 0 then
      v_perf_new := null;
    elsif r.actual_output is not null then
      v_perf_new := r.actual_output / v_expected_after * 100;
    else
      v_perf_new := null;
    end if;
    v_oee_new := v_perf_new;

    update public.import_item_hourly
    set performance_pct = coalesce(v_perf_new, performance_pct),
        actual_oee_pct = coalesce(v_oee_new, actual_oee_pct),
        raw_data = coalesce(raw_data, '{}'::jsonb) || jsonb_build_object(
          'calculation', coalesce(raw_data -> 'calculation', '{}'::jsonb) || jsonb_build_object(
            'ha_tup_linkage', jsonb_build_object(
              'linked_ha_import_item_id', v_link.ha_import_item_id,
              'ha_source_import_item_ids', to_jsonb(v_link.ha_import_item_ids),
              'ha_source_ambiguous', v_link.match_status = 'AMBIGUOUS',
              'ha_product_code', v_link.ha_product_code,
              'ha_cumulative_available', v_cum_ha,
              'allocation_fraction', p_allocation_fraction,
              'ha_allocated_available', v_allocated_ha,
              'expected_before_cap', v_expected_before,
              'expected_after_cap', v_expected_after,
              'capped', v_expected_after < v_expected_before
            )
          )
        )
    where id = r.id;
    v_updated := v_updated + 1;
  end loop;

  if v_updated = 0 then
    return jsonb_build_object('status', 'NO_HOURS');
  end if;

  select * into v_product
  from public.compute_import_item_product_kpis(p_tup_import_item_id, v_item.work_date) x
  where public.codes_match(
          lower(regexp_replace(x.product_code, '\s+', '', 'g')),
          lower(regexp_replace(p_tup_product_code, '\s+', '', 'g'))
        )
  limit 1;

  if found and v_product.product_id is not null then
    update public.daily_records
    set oee = round(v_product.oee, 2), performance = round(v_product.performance, 2), available_time = round(v_product.availability, 2)
    where import_item_id = p_tup_import_item_id
      and product_id = v_product.product_id;
  end if;

  return jsonb_build_object('status', 'APPLIED', 'hours_updated', v_updated, 'linked_ha_import_item_id', v_link.ha_import_item_id, 'ha_source_ambiguous', v_link.match_status = 'AMBIGUOUS', 'allocation_fraction', p_allocation_fraction);
end;
$$;

grant execute on function public.apply_ha_tup_capping(uuid, text, numeric) to authenticated;

-- refresh_daily_records_for_import_item(): same match change.
create or replace function public.refresh_daily_records_for_import_item(p_import_item_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.import_items%rowtype;
  v_product record;
  v_updated integer := 0;
begin
  select * into v_item from public.import_items where id = p_import_item_id;
  if not found or v_item.work_date is null then
    return jsonb_build_object('status', 'SKIPPED', 'reason', 'missing_header');
  end if;

  for v_product in select * from public.compute_import_item_product_kpis(p_import_item_id, v_item.work_date) loop
    if v_product.product_id is null then
      continue;
    end if;
    update public.daily_records
    set oee = round(v_product.oee, 2), performance = round(v_product.performance, 2), available_time = round(v_product.availability, 2)
    where import_item_id = p_import_item_id
      and product_id = v_product.product_id;
    if found then
      v_updated := v_updated + 1;
    end if;
  end loop;

  return jsonb_build_object('status', 'REFRESHED', 'daily_records_updated', v_updated);
end;
$$;

grant execute on function public.refresh_daily_records_for_import_item(uuid) to authenticated;
