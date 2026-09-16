-- Verze 2.01 AUTO – V18.2 KPI reconstruction patch
-- Fixes staffing direction, Performance denominator and OEE staffing double-counting.
-- CLASSIC single-product hours use shift-clock productive time; OCR norm is not used as time.
-- Existing Availability is preserved unless explicit downtime is present.

create or replace function public.reconstruct_import_item_hourly(p_import_item_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.import_items%rowtype;
  v_operator_count integer;
  r record;
  v_norm numeric;
  v_capacity numeric;
  v_ocr_norm numeric;
  v_downtime numeric;
  v_minutes numeric;
  v_expected numeric;
  v_perf numeric;
  v_oee numeric;
  v_avail numeric;
  v_source text;
  v_status text;
  v_hour_product_count integer;
  v_is_teff boolean;
begin
  select * into v_item
  from public.import_items
  where id = p_import_item_id;

  if not found then
    return;
  end if;

  select count(*) into v_operator_count
  from public.import_item_rows
  where import_item_id = p_import_item_id
    and employee_id is not null;

  v_operator_count := greatest(1, coalesce(v_operator_count, 1));

  for r in
    select h.*
    from public.import_item_hourly h
    where h.import_item_id = p_import_item_id
    order by h.hour, h.id
  loop
    v_norm := null;
    v_capacity := null;
    v_ocr_norm := null;
    v_downtime := 0;
    v_minutes := null;

    select x.norm, x.capacity
    into v_norm, v_capacity
    from (
      select
        case
          when upper(coalesce(r.role,'')) = 'HA'
           and lower(regexp_replace(coalesce(pp.ha_subassy,''),'\\s+','','g')) = lower(regexp_replace(coalesce(r.product_code,''),'\\s+','','g'))
          then pp.h_norm_per_hour
          when upper(coalesce(r.role,'')) = 'TUP'
           and lower(regexp_replace(coalesce(pp.tup_subassy,''),'\\s+','','g')) = lower(regexp_replace(coalesce(r.product_code,''),'\\s+','','g'))
          then pp.t_norm_per_hour
          when lower(regexp_replace(coalesce(pp.ha_subassy,''),'\\s+','','g')) = lower(regexp_replace(coalesce(r.product_code,''),'\\s+','','g'))
          then pp.h_norm_per_hour
          when lower(regexp_replace(coalesce(pp.tup_subassy,''),'\\s+','','g')) = lower(regexp_replace(coalesce(r.product_code,''),'\\s+','','g'))
          then pp.t_norm_per_hour
        end as norm,
        case
          when upper(coalesce(r.role,'')) = 'HA'
           and lower(regexp_replace(coalesce(pp.ha_subassy,''),'\\s+','','g')) = lower(regexp_replace(coalesce(r.product_code,''),'\\s+','','g'))
          then pp.h_capacity
          when upper(coalesce(r.role,'')) = 'TUP'
           and lower(regexp_replace(coalesce(pp.tup_subassy,''),'\\s+','','g')) = lower(regexp_replace(coalesce(r.product_code,''),'\\s+','','g'))
          then pp.t_capacity
          when lower(regexp_replace(coalesce(pp.ha_subassy,''),'\\s+','','g')) = lower(regexp_replace(coalesce(r.product_code,''),'\\s+','','g'))
          then pp.h_capacity
          when lower(regexp_replace(coalesce(pp.tup_subassy,''),'\\s+','','g')) = lower(regexp_replace(coalesce(r.product_code,''),'\\s+','','g'))
          then pp.t_capacity
        end as capacity,
        pp.valid_from, pp.valid_to, pp.version_no
      from public.product_profiles pp
      where lower(regexp_replace(coalesce(pp.ha_subassy,''),'\\s+','','g')) = lower(regexp_replace(coalesce(r.product_code,''),'\\s+','','g'))
         or lower(regexp_replace(coalesce(pp.tup_subassy,''),'\\s+','','g')) = lower(regexp_replace(coalesce(r.product_code,''),'\\s+','','g'))
    ) x
    where (x.valid_from is null or x.valid_from <= v_item.work_date)
      and (x.valid_to is null or x.valid_to >= v_item.work_date)
    order by x.valid_to is null desc, x.valid_from desc nulls last, x.version_no desc nulls last
    limit 1;

    v_ocr_norm := nullif(coalesce(r.raw_data,'{}'::jsonb) ->> 'norm_per_hour','')::numeric;

    v_downtime := nullif(coalesce(r.raw_data,'{}'::jsonb) ->> 'downtime_minutes','')::numeric;
    if v_downtime is null then
      v_downtime := nullif(coalesce(r.raw_data,'{}'::jsonb) ->> 'downtime_min','')::numeric;
    end if;

    if v_downtime is null
       and r.availability_pct is not null
       and r.availability_pct >= 0
       and r.availability_pct < 100
       and (coalesce(r.raw_data,'{}'::jsonb) ? 'availability_is_clock_time')
    then
      v_downtime := 60 * (1 - r.availability_pct / 100);
    end if;

    v_downtime := greatest(0, least(60, coalesce(v_downtime, 0)));

    select count(distinct h.product_code)
    into v_hour_product_count
    from public.import_item_hourly h
    where h.import_item_id = p_import_item_id
      and h.hour = r.hour
      and nullif(trim(coalesce(h.product_code,'')), '') is not null;

    v_is_teff := coalesce(v_hour_product_count, 0) > 1;

    if not v_is_teff then
      v_minutes := public.auto_shift_productive_minutes(
        v_item.shift,
        r.hour,
        v_item.ocr_data ->> 'screenshot_time'
      );
      v_source := 'SHIFT_CLOCK_MODEL_CLASSIC';
      v_status := 'CLOCK';
    else
      if v_norm is not null
         and v_norm > 0
         and v_ocr_norm is not null
         and v_ocr_norm >= 0
         and v_ocr_norm < v_norm
      then
        v_minutes := greatest(0, least(60, (v_ocr_norm / v_norm) * 60));
        v_source := 'OCR_interval_norm_divided_by_master_norm';
        v_status := 'DERIVED';
      elsif v_downtime > 0 then
        v_minutes := greatest(0, 60 - v_downtime);
        v_source := 'EXPLICIT_DOWNTIME';
        v_status := 'DERIVED';
      else
        v_minutes := public.auto_shift_productive_minutes(
          v_item.shift,
          r.hour,
          v_item.ocr_data ->> 'screenshot_time'
        );
        v_source := 'SHIFT_CLOCK_MODEL_TEFF_FALLBACK';
        v_status := 'CLOCK';
      end if;
    end if;

    -- Staffing is applied exactly once in Expected Output: operators / capacity.
    v_expected := case
      when v_norm is not null
       and v_capacity is not null
       and v_capacity > 0
      then
        v_norm
        * v_minutes
        / 60.0
        * (v_operator_count::numeric / v_capacity)
      else null
    end;

    -- Performance is Actual / Expected. Staffing is therefore not applied again.
    v_perf := case
      when r.actual_output is not null
       and v_expected is not null
       and v_expected > 0
      then
        r.actual_output / v_expected * 100
      else null
    end;

    -- Keep existing Availability semantics. Only explicit downtime replaces it.
    v_avail := case
      when v_downtime < 60
      then greatest(0, least(100, (60 - v_downtime) / 60.0 * 100))
      else 0
    end;

    -- Staffing must not be multiplied again in OEE.
    v_oee := case
      when v_perf is not null
       and v_avail is not null
      then v_perf * v_avail / 100.0
      else null
    end;

    update public.import_item_hourly
    set
      norm_per_hour = v_norm,
      capacity = v_capacity,
      operator_count = v_operator_count,
      performance_pct = v_perf,
      availability_pct = case when v_downtime > 0 then v_avail else availability_pct end,
      actual_oee_pct = v_oee,
      raw_data = coalesce(raw_data,'{}'::jsonb)
        || jsonb_build_object(
          'calculation',
          coalesce(raw_data -> 'calculation','{}'::jsonb)
          || jsonb_build_object(
            'model_version', '2.01-AUTO-reconstruction-v18.2',
            'calculation_mode', case when v_is_teff then 'TEFF' else 'CLASSIC_AVAILABILITY' end,
            'reconstructed_productive_minutes', v_minutes,
            'reconstructed_effective_norm', case when v_norm is not null then v_norm * v_minutes / 60.0 else null end,
            'expected_output_at_current_staffing', v_expected,
            'reconstruction_status', v_status,
            'reconstruction_source', v_source,
            'ocr_interval_norm', v_ocr_norm,
            'downtime_minutes', v_downtime,
            'master_norm', v_norm,
            'capacity', v_capacity,
            'operator_count', v_operator_count,
            'staffing_factor', case when v_capacity is not null and v_capacity > 0 then v_operator_count::numeric / v_capacity else null end,
            'hour_product_count', v_hour_product_count,
            'is_teff_hour', v_is_teff
          )
        )
    where id = r.id;
  end loop;
end;
$$;

grant execute on function public.reconstruct_import_item_hourly(uuid) to authenticated;

create or replace function public.trg_reconstruct_import_item_hourly_2_01()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.reconstruct_import_item_hourly(new.id);
  return new;
end;
$$;

grant execute on function public.trg_reconstruct_import_item_hourly_2_01() to authenticated;

drop trigger if exists zz_import_items_reconstruct_2_01 on public.import_items;
create trigger zz_import_items_reconstruct_2_01
after update on public.import_items
for each row
when (new.status = 'VALIDATING' and old.status is distinct from new.status)
execute function public.trg_reconstruct_import_item_hourly_2_01();
