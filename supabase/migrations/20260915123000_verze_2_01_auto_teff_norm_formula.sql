-- Verze 2.01 AUTO: canonical effective-time formula from OCR norm.
--
-- Effective time MUST be derived from the norm expected at 100% availability:
--   norma_100 = OCR norma / (availability_pct / 100)
--   teff      = norma_100 / Product Profile norm * 60 minutes
--
-- This replaces the previous actual-output-based time reconstruction.
-- Empty OCR hourly rows are ignored by the calculation.

create or replace function public.recalculate_import_item_kpis(p_import_item_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_operator_count integer;
  v_hour_count integer;
  v_perf_weight double precision := 0;
  v_avail_weight double precision := 0;
  v_oee_weight double precision := 0;
  v_perf_total double precision := 0;
  v_avail_total double precision := 0;
  v_oee_total double precision := 0;
  v_shift_perf double precision;
  v_shift_avail double precision;
  v_shift_oee double precision;
  r record;
  v_weight double precision;
  v_norm double precision;
  v_norm_100 double precision;
  v_capacity double precision;
  v_teff double precision;
  v_perf double precision;
  v_oee double precision;
begin
  select count(*) into v_operator_count
  from public.import_item_rows
  where import_item_id = p_import_item_id
    and employee_id is not null;

  if v_operator_count < 1 then return; end if;

  select count(*) into v_hour_count
  from public.import_item_hourly
  where import_item_id = p_import_item_id;

  if v_hour_count < 1 then return; end if;

  for r in
    select h.id, h.hour, h.product_code, h.actual_output, h.availability_pct,
           h.raw_data, row_number() over (order by h.hour, h.id) as rn
    from public.import_item_hourly h
    where h.import_item_id = p_import_item_id
      and not (
        coalesce(h.actual_output, 0) = 0
        and coalesce(h.norm_per_hour, 0) = 0
        and nullif(trim(coalesce(h.product_code, '')), '') is null
      )
    order by h.hour, h.id
  loop
    if v_hour_count = 1 then
      v_weight := 7.25;
    elsif v_hour_count = 2 then
      v_weight := 1;
    else
      v_weight := 1;
      if r.rn = 1 then v_weight := v_weight - 10.0 / 60.0; end if;
      if r.rn = v_hour_count then v_weight := v_weight - 5.0 / 60.0; end if;
      if r.rn = floor(v_hour_count / 2.0)::integer + 1 then v_weight := v_weight - 30.0 / 60.0; end if;
    end if;

    select case
      when lower(regexp_replace(coalesce(hp.ha_subassy, ''), '\s+', '', 'g')) = lower(regexp_replace(coalesce(r.product_code, ''), '\s+', '', 'g')) then hp.h_norm_per_hour
      when lower(regexp_replace(coalesce(hp.tup_subassy, ''), '\s+', '', 'g')) = lower(regexp_replace(coalesce(r.product_code, ''), '\s+', '', 'g')) then hp.t_norm_per_hour
      else null
    end,
    case
      when lower(regexp_replace(coalesce(hp.ha_subassy, ''), '\s+', '', 'g')) = lower(regexp_replace(coalesce(r.product_code, ''), '\s+', '', 'g')) then hp.h_capacity
      when lower(regexp_replace(coalesce(hp.tup_subassy, ''), '\s+', '', 'g')) = lower(regexp_replace(coalesce(r.product_code, ''), '\s+', '', 'g')) then hp.t_capacity
      else null
    end
    into v_norm, v_capacity
    from public.product_profiles hp
    where lower(regexp_replace(coalesce(hp.ha_subassy, ''), '\s+', '', 'g')) = lower(regexp_replace(coalesce(r.product_code, ''), '\s+', '', 'g'))
       or lower(regexp_replace(coalesce(hp.tup_subassy, ''), '\s+', '', 'g')) = lower(regexp_replace(coalesce(r.product_code, ''), '\s+', '', 'g'))
    order by hp.valid_to is null desc, hp.valid_from desc nulls last, hp.version_no desc nulls last
    limit 1;

    -- The OCR norm is the norm achieved during the observed available part of
    -- the hour. First convert it to the equivalent norm for 60 minutes at 100%
    -- availability, then convert that norm to effective time using the valid
    -- Product Profile norm.
    v_norm_100 := case
      when r.availability_pct is not null
           and r.availability_pct > 0
           and r.norm_per_hour is not null
           and r.norm_per_hour > 0
        then r.norm_per_hour / (r.availability_pct / 100.0)
      when r.availability_pct is not null
           and r.availability_pct >= 100
           and r.norm_per_hour is not null
           and r.norm_per_hour > 0
        then r.norm_per_hour
      else null
    end;

    v_teff := case
      when v_norm_100 is not null and v_norm is not null and v_norm > 0
        then (v_norm_100 / v_norm) * 60.0
      else null
    end;

    -- Performance is based on the actual output against the valid Product
    -- Profile norm over the effective productive time.
    v_perf := case
      when r.actual_output is not null
           and v_norm is not null and v_norm > 0
           and v_teff is not null and v_teff > 0
        then (r.actual_output / (v_norm * v_teff / 60.0)) * 100.0
      else null
    end;

    v_oee := case
      when v_perf is not null and r.availability_pct is not null
        then v_perf * r.availability_pct / 100.0
      else null
    end;

    update public.import_item_hourly
    set norm_per_hour = v_norm,
        capacity = v_capacity,
        operator_count = v_operator_count,
        performance_pct = v_perf,
        actual_oee_pct = v_oee,
        raw_data = coalesce(raw_data, '{}'::jsonb) || jsonb_build_object(
          'calculation', jsonb_build_object(
            'effective_time_formula', '(Norma při 100% dostupnosti / norma z Product Profile) × 60 min',
            'norm_at_100_availability', v_norm_100,
            'effective_time_minutes', v_teff,
            'performance_formula', 'Reálný výstup / (norma z Product Profile × teff / 60) × 100',
            'oee_formula', '(Výkon × Dostupnost × Kvalita) / 10000; Kvalita = 100%',
            'actual_output', r.actual_output,
            'ocr_norm', r.norm_per_hour,
            'norm_per_hour', v_norm,
            'availability_pct', r.availability_pct,
            'capacity', v_capacity,
            'operator_count', v_operator_count,
            'calculated_performance_pct', v_perf,
            'calculated_oee_pct', v_oee
          )
        )
    where id = r.id;

    if v_weight > 0 then
      if v_perf is not null then v_perf_total := v_perf_total + v_perf * v_weight; v_perf_weight := v_perf_weight + v_weight; end if;
      if r.availability_pct is not null then v_avail_total := v_avail_total + r.availability_pct * v_weight; v_avail_weight := v_avail_weight + v_weight; end if;
      if v_oee is not null then v_oee_total := v_oee_total + v_oee * v_weight; v_oee_weight := v_oee_weight + v_weight; end if;
    end if;
  end loop;

  v_shift_perf := case when v_perf_weight > 0 then v_perf_total / v_perf_weight else null end;
  v_shift_avail := case when v_avail_weight > 0 then v_avail_total / v_avail_weight else null end;
  v_shift_oee := case when v_oee_weight > 0 then v_oee_total / v_oee_weight else null end;

  update public.import_item_rows
  set performance = v_shift_perf,
      available_time = v_shift_avail,
      oee = v_shift_oee
  where import_item_id = p_import_item_id
    and daily_record_id is null;

  update public.import_items
  set ocr_data = jsonb_set(
      jsonb_set(
        jsonb_set(coalesce(ocr_data, '{}'::jsonb), '{actual_shift_performance_pct}', to_jsonb(v_shift_perf), true),
        '{actual_shift_availability_pct}', to_jsonb(v_shift_avail), true),
      '{actual_shift_oee_pct}', to_jsonb(v_shift_oee), true)
  where id = p_import_item_id;
end;
$$;

grant execute on function public.recalculate_import_item_kpis(uuid) to authenticated;
