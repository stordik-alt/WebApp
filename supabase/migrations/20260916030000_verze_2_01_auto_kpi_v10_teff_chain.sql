-- Verze 2.01 AUTO V10
-- Multi-product hourly TEFF chaining.
--
-- Binding rule:
-- 1) The first production in a clock hour gets TEFF from its expected/OCR hourly norm:
--      TEFF1 = (expected hourly norm / Product Profile hourly norm) * 60
-- 2) Every following production gets the remaining time:
--      TEFFn = 60 - sum(previous TEFF) - relevant changeover downtime before n
-- 3) Changeover downtime may be zero or non-zero.
-- 4) Time allocation is chained independently per hour + role/workplace.
-- 5) Product Profile norm remains the canonical denominator.
-- 6) Staffing is applied exactly once in expected output.
-- 7) TEFF OEE = Performance; classic OEE = Performance * Availability / 100.
-- 8) An unknown downtime after a completed product does not reduce that completed product's TEFF.
-- 9) A first row is not a TEFF trigger merely because it is first in the shift/import.

create or replace function public.recalculate_import_item_kpis(p_import_item_id uuid)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  v_operator_count integer;
  v_work_date date;
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
  v_minutes double precision;
  v_norm double precision;
  v_ocr_norm double precision;
  v_norm_100 double precision;
  v_capacity double precision;
  v_teff double precision;
  v_perf double precision;
  v_oee double precision;
  v_staffing_ratio double precision;
  v_downtime_minutes double precision;
  v_downtime_before boolean;
  v_reason text;
  v_changeover boolean;
  v_changed boolean;
  v_relevant boolean;
  v_mode text;
  v_product_finished boolean;
  v_is_first_in_hour boolean;
  v_hour_minutes_used double precision := 0;
  v_previous_hour integer := null;
  v_previous_role text := null;
  v_previous_product text := null;
  v_time_remaining_before double precision;
  v_time_before_product double precision;
  v_changeover_downtime double precision;
  v_teff_source text;
  v_formula text;
  v_next_hour integer;
  v_next_role text;
begin
  select work_date into v_work_date
  from public.import_items
  where id = p_import_item_id;

  select count(*) into v_operator_count
  from public.import_item_rows
  where import_item_id = p_import_item_id
    and employee_id is not null;

  if v_operator_count < 1 then
    return;
  end if;

  for r in
    select
      h.id,
      h.hour,
      h.product_code,
      h.role,
      h.actual_output,
      h.availability_pct,
      h.raw_data,
      lead(h.hour) over(order by h.hour,h.id) as next_hour,
      lead(h.product_code) over(order by h.hour,h.id) as next_product_code,
      lead(h.role) over(order by h.hour,h.id) as next_role
    from public.import_item_hourly h
    where h.import_item_id = p_import_item_id
      and not(
        coalesce(h.actual_output,0)=0
        and coalesce(h.norm_per_hour,0)=0
        and nullif(trim(coalesce(h.product_code,'')),'') is null
      )
    order by h.hour,h.id
  loop
    -- Resolve canonical Product Profile norm and capacity.
    v_norm := null;
    v_capacity := null;
    select
      case
        when upper(coalesce(r.role,''))='TUP'
             and lower(regexp_replace(coalesce(pp.tup_subassy,''),'\\s+','','g'))=lower(regexp_replace(coalesce(r.product_code,''),'\\s+','','g'))
          then pp.t_norm_per_hour
        else pp.h_norm_per_hour
      end,
      case
        when upper(coalesce(r.role,''))='TUP'
             and lower(regexp_replace(coalesce(pp.tup_subassy,''),'\\s+','','g'))=lower(regexp_replace(coalesce(r.product_code,''),'\\s+','','g'))
          then pp.t_capacity
        else pp.h_capacity
      end
    into v_norm,v_capacity
    from public.product_profiles pp
    where (
      lower(regexp_replace(coalesce(pp.ha_subassy,''),'\\s+','','g'))=lower(regexp_replace(coalesce(r.product_code,''),'\\s+','','g'))
      or lower(regexp_replace(coalesce(pp.tup_subassy,''),'\\s+','','g'))=lower(regexp_replace(coalesce(r.product_code,''),'\\s+','','g'))
    )
      and (v_work_date is null or pp.valid_from is null or pp.valid_from<=v_work_date)
      and (v_work_date is null or pp.valid_to is null or pp.valid_to>=v_work_date)
    order by pp.valid_to is null desc,pp.valid_from desc nulls last,pp.version_no desc nulls last
    limit 1;

    if v_norm is null or v_norm<=0 or v_capacity is null or v_capacity<=0 then
      continue;
    end if;

    -- Reset the chained clock whenever the hour or workplace/role changes.
    v_is_first_in_hour := v_previous_hour is distinct from r.hour
      or upper(coalesce(v_previous_role,'')) <> upper(coalesce(r.role,''));
    if v_is_first_in_hour then
      v_hour_minutes_used := 0;
    end if;

    v_changed := v_previous_product is not null
      and lower(regexp_replace(coalesce(r.product_code,''),'\\s+','','g'))<>v_previous_product
      and upper(coalesce(r.role,''))=coalesce(v_previous_role,'')
      and v_previous_hour = r.hour;

    -- A product is considered finished in this hour only when the next row is
    -- another product in the same hour and same role/workplace.
    v_product_finished := r.next_hour = r.hour
      and r.next_product_code is not null
      and lower(regexp_replace(coalesce(r.next_product_code,''),'\\s+','','g'))<>lower(regexp_replace(coalesce(r.product_code,''),'\\s+','','g'))
      and upper(coalesce(r.next_role,''))=upper(coalesce(r.role,''));

    v_ocr_norm := coalesce(
      nullif(trim(coalesce(r.raw_data->>'ocr_norm_per_hour','')),'')::double precision,
      nullif(trim(coalesce(r.raw_data->>'norm_per_hour','')),'')::double precision
    );

    v_downtime_minutes := coalesce(
      nullif(trim(coalesce(r.raw_data->>'downtime_minutes','')),'')::double precision,
      nullif(trim(coalesce(r.raw_data->>'downtime_min','')),'')::double precision,
      nullif(trim(coalesce(r.raw_data->>'odstavka_minutes','')),'')::double precision,
      nullif(trim(coalesce(r.raw_data->>'odstavka_min','')),'')::double precision
    );
    v_downtime_minutes := greatest(0,least(60,coalesce(v_downtime_minutes,0)));

    v_downtime_before := case
      when lower(coalesce(r.raw_data->>'downtime_before_production','')) in('true','1','ano','yes') then true
      when lower(coalesce(r.raw_data->>'downtime_before_production','')) in('false','0','ne','no') then false
      else null
    end;

    v_reason := nullif(trim(coalesce(
      r.raw_data->>'downtime_reason',
      r.raw_data->>'reason',
      r.raw_data->>'odstavka_reason',
      r.raw_data->>'odstavky_reason',
      r.raw_data->>'duvod_odstavky',
      r.raw_data->>'důvod_odstávky',''
    )),'');
    v_changeover := lower(coalesce(v_reason,'')) like '%změna produktu%'
      or lower(coalesce(v_reason,'')) like '%zmena produktu%';

    v_relevant := v_downtime_minutes>0
      and (
        (v_downtime_before=true and v_is_first_in_hour)
        or (v_changed and v_changeover)
      );

    v_norm_100 := case
      when v_ocr_norm is not null and v_ocr_norm>0
           and r.availability_pct is not null and r.availability_pct>0
        then v_ocr_norm/(r.availability_pct/100.0)
      else null
    end;

    -- For a multi-product hour, the first product's TEFF is reconstructed from
    -- its expected hourly/OCR norm. Following products consume the remainder.
    if v_product_finished and v_ocr_norm is not null and v_ocr_norm>0 then
      v_time_remaining_before := greatest(0,60-v_hour_minutes_used);
      v_teff := least(v_time_remaining_before,(v_ocr_norm/v_norm)*60.0);
      v_teff := greatest(0,v_teff);
      v_teff_source := 'EXPECTED_NORM_FIRST_PRODUCT';
      v_formula := 'TEFF = (OCR/expected hourly norm / Product Profile norm) x 60';
      v_mode := 'TEFF';
      v_minutes := v_teff;

    elsif not v_is_first_in_hour and v_previous_hour = r.hour and v_previous_role is not distinct from upper(coalesce(r.role,'')) then
      -- This is a following product in the same hour. Its TEFF is the remainder
      -- after all previous product TEFF values and any relevant changeover
      -- downtime immediately before this product.
      v_time_remaining_before := greatest(0,60-v_hour_minutes_used);
      v_changeover_downtime := case when v_changed and v_changeover then v_downtime_minutes else 0 end;
      v_teff := greatest(0,least(v_time_remaining_before,v_time_remaining_before-v_changeover_downtime));
      v_teff_source := case when v_changeover_downtime>0 then 'HOURLY_REMAINDER_MINUS_CHANGEOVER' else 'HOURLY_REMAINDER' end;
      v_formula := 'TEFF = 60 - previous TEFF total - changeover downtime';
      v_mode := 'TEFF';
      v_minutes := v_teff;
      v_relevant := v_changeover_downtime>0;

    elsif v_relevant then
      v_mode := 'TEFF';
      v_minutes := least(60.0,greatest(0,60.0-v_downtime_minutes));
      v_teff := v_minutes;
      v_teff_source := 'RELEVANT_DOWNTIME';
      v_formula := 'TEFF = 60 - relevant downtime';

    else
      v_mode := 'CLASSIC_AVAILABILITY';
      v_minutes := 60.0;
      v_teff := null;
      v_teff_source := 'CLASSIC_FULL_HOUR';
      v_formula := 'Classic full hour';
    end if;

    -- Never allow chained time to exceed the 60-minute clock hour.
    v_minutes := least(60.0,greatest(0,v_minutes));
    v_time_before_product := v_hour_minutes_used;
    v_hour_minutes_used := least(60.0,v_hour_minutes_used+v_minutes);

    v_staffing_ratio := v_operator_count::double precision/v_capacity;
    v_perf := case
      when r.actual_output is not null and v_staffing_ratio>0 and v_minutes>0
        then r.actual_output/(v_norm*v_minutes/60.0*v_staffing_ratio)*100.0
      else null
    end;

    v_oee := case
      when v_perf is null then null
      when v_mode='TEFF' then v_perf
      when r.availability_pct is not null then v_perf*r.availability_pct/100.0
      else null
    end;

    update public.import_item_hourly
    set norm_per_hour=v_norm,
        capacity=v_capacity,
        operator_count=v_operator_count,
        actual_minutes=v_minutes,
        performance_pct=v_perf,
        actual_oee_pct=v_oee,
        raw_data=coalesce(raw_data,'{}'::jsonb)||jsonb_build_object(
          'calculation',coalesce(raw_data->'calculation','{}'::jsonb)||jsonb_build_object(
            'model_version','2.01-AUTO-staffing-kpi-v10',
            'calculation_mode',v_mode,
            'ocr_norm',v_ocr_norm,
            'product_profile_norm',v_norm,
            'norm_at_100_availability',v_norm_100,
            'effective_time_minutes',v_teff,
            'productive_minutes',v_minutes,
            'time_before_product_minutes',v_time_before_product,
            'hour_minutes_used_after',v_hour_minutes_used,
            'downtime_minutes',v_downtime_minutes,
            'downtime_before_production',v_downtime_before,
            'downtime_reason',v_reason,
            'downtime_relevant',v_relevant,
            'first_productive_row_in_hour',v_is_first_in_hour,
            'product_changed',v_changed,
            'product_finished',v_product_finished,
            'staffing_ratio',v_staffing_ratio,
            'teff_source',v_teff_source,
            'teff_formula',v_formula,
            'changeover_downtime_minutes',case when v_changed and v_changeover then v_downtime_minutes else 0 end,
            'shift_boundary_rule','canonical clock-time model; first row does not imply TEFF',
            'time_chain_rule','TEFF1 from expected norm; following TEFF = remaining hour - relevant changeover downtime',
            'performance_formula','actual / (Product Profile norm x time x staffing) x 100',
            'oee_formula',case when v_mode='TEFF' then 'OEE = Performance' else 'OEE = Performance x Availability / 100' end
          )
        )
    where id=r.id;

    if v_perf is not null then
      v_perf_total:=v_perf_total+v_perf*v_minutes;
      v_perf_weight:=v_perf_weight+v_minutes;
    end if;
    if r.availability_pct is not null then
      v_avail_total:=v_avail_total+r.availability_pct*v_minutes;
      v_avail_weight:=v_avail_weight+v_minutes;
    end if;
    if v_oee is not null then
      v_oee_total:=v_oee_total+v_oee*v_minutes;
      v_oee_weight:=v_oee_weight+v_minutes;
    end if;

    v_previous_hour:=r.hour;
    v_previous_product:=lower(regexp_replace(coalesce(r.product_code,''),'\\s+','','g'));
    v_previous_role:=upper(coalesce(r.role,''));
  end loop;

  v_shift_perf:=case when v_perf_weight>0 then v_perf_total/v_perf_weight else null end;
  v_shift_avail:=case when v_avail_weight>0 then v_avail_total/v_avail_weight else null end;
  v_shift_oee:=case when v_oee_weight>0 then v_oee_total/v_oee_weight else null end;

  perform set_config('app.verze_2_01_auto_system_kpi_recalc','on',true);
  update public.import_item_rows
  set performance=v_shift_perf,
      available_time=v_shift_avail,
      oee=v_shift_oee
  where import_item_id=p_import_item_id
    and daily_record_id is null;
  perform set_config('app.verze_2_01_auto_system_kpi_recalc','off',true);

  update public.import_items
  set ocr_data=jsonb_set(
    jsonb_set(
      jsonb_set(
        jsonb_set(coalesce(ocr_data,'{}'::jsonb),'{actual_shift_performance_pct}',to_jsonb(v_shift_perf),true),
        '{actual_shift_availability_pct}',to_jsonb(v_shift_avail),true),
      '{actual_shift_oee_pct}',to_jsonb(v_shift_oee),true),
    '{kpi_model_version}',to_jsonb('2.01-AUTO-staffing-kpi-v10'::text),true)
  where id=p_import_item_id;
end;
$$;

grant execute on function public.recalculate_import_item_kpis(uuid) to authenticated;
