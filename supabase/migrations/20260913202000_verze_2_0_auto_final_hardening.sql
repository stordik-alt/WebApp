-- Verze 2.0 AUTO
-- Final hardening: preserve the canonical calculated shift OEE and block duplicate employee rows before AUTO insert.

-- Keep the already reviewed transactional implementation available as the legacy worker.
alter function public.auto_approve_import_item(uuid) rename to auto_approve_import_item_legacy;

grant execute on function public.auto_approve_import_item_legacy(uuid) to authenticated;

create or replace function public.auto_approve_import_item(p_import_item_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_item public.import_items%rowtype;
  v_duplicate_count integer := 0;
  v_shift_oee numeric;
  v_hour_count integer := 0;
  v_oee_weight numeric := 0;
  v_now timestamptz := now();
  v_reasons jsonb := '[]'::jsonb;
  v_legacy jsonb;
begin
  select * into v_item
  from public.import_items
  where id = p_import_item_id
    and status = 'VALIDATING'
  for update;

  if not found then
    raise exception 'AUTO import není ve stavu VALIDATING nebo neexistuje.' using errcode = 'P0002';
  end if;

  -- Never allow two OCR rows for the same employee to become two daily records
  -- for the same date/shift/line. This would otherwise hit the UNIQUE constraint
  -- only after the first row had been inserted inside the transaction.
  select count(*) into v_duplicate_count
  from (
    select employee_id
    from public.import_item_rows
    where import_item_id = v_item.id
      and employee_id is not null
    group by employee_id
    having count(*) > 1
  ) duplicates;

  if v_duplicate_count > 0 then
    v_reasons := v_reasons || '["DUPLICATE_RECORD"]'::jsonb;
  end if;

  -- ocr.hourly.functions.ts calculates the canonical actual shift OEE as a
  -- weighted average of hourly actual_oee_pct values. Persist that calculated
  -- value into ocr_data before the legacy transactional worker reads it.
  -- Existing actual_shift_oee_pct always wins; the fallback reconstructs the
  -- same weighting from the persisted hourly rows.
  if nullif(trim(v_item.ocr_data ->> 'actual_shift_oee_pct'), '') is not null then
    begin
      v_shift_oee := (v_item.ocr_data ->> 'actual_shift_oee_pct')::numeric;
      if not isfinite(v_shift_oee::double precision) then v_shift_oee := null; end if;
    exception when others then
      v_shift_oee := null;
    end;
  end if;

  if v_shift_oee is null then
    select count(*) into v_hour_count
    from public.import_item_hourly
    where import_item_id = v_item.id;

    if v_hour_count > 0 then
      with numbered as (
        select
          actual_oee_pct,
          row_number() over (order by hour, id) as rn,
          count(*) over () as n
        from public.import_item_hourly
        where import_item_id = v_item.id
      ), weighted as (
        select
          actual_oee_pct,
          case
            when n = 1 then 7.25::numeric
            else 1::numeric
              - case when rn = 1 then 10::numeric / 60 else 0 end
              - case when rn = n then 5::numeric / 60 else 0 end
              - case when n >= 3 and rn = floor(n::numeric / 2)::integer + 1 then 30::numeric / 60 else 0 end
          end as weight
        from numbered
      )
      select
        sum(actual_oee_pct * weight) / nullif(sum(weight), 0),
        sum(weight)
      into v_shift_oee, v_oee_weight
      from weighted
      where actual_oee_pct is not null
        and isfinite(actual_oee_pct::double precision);
    end if;
  end if;

  if v_shift_oee is not null and isfinite(v_shift_oee::double precision) then
    update public.import_items
    set ocr_data = jsonb_set(
      coalesce(ocr_data, '{}'::jsonb),
      '{actual_shift_oee_pct}',
      to_jsonb(v_shift_oee),
      true
    ),
    updated_at = v_now
    where id = v_item.id;
  end if;

  if jsonb_array_length(v_reasons) > 0 then
    update public.import_items
    set status = 'PENDING_APPROVAL',
        pending_reasons = v_reasons,
        updated_at = v_now
    where id = v_item.id;

    insert into public.import_item_events(import_item_id, actor_id, event_type, from_status, to_status, payload)
    values (
      v_item.id, auth.uid(), 'VALIDATION_BLOCKED', 'VALIDATING', 'PENDING_APPROVAL',
      jsonb_build_object('blockers', v_reasons)
    );

    return jsonb_build_object(
      'success', false,
      'status', 'PENDING_APPROVAL',
      'import_item_id', v_item.id,
      'blockers', v_reasons,
      'created_daily_records', 0
    );
  end if;

  -- The legacy function contains the already hardened validation and one-RPC
  -- transaction that inserts all daily_records atomically.
  v_legacy := public.auto_approve_import_item_legacy(v_item.id);
  return v_legacy;
end;
$$;

grant execute on function public.auto_approve_import_item(uuid) to authenticated;
