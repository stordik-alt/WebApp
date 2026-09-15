-- Verze 2.01 AUTO V9
-- Shift-boundary correction: TEFF is never selected merely because a row is
-- the first productive row. Shift start/end are governed by the existing
-- canonical clock-time model (Ranní 06:00, Odpolední 14:00, Noční 22:00).
-- Product-finish TEFF from V8 remains unchanged.

create or replace function public.recalculate_import_item_kpis(p_import_item_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare
 v_operator_count integer; v_work_date date; v_perf_weight double precision:=0; v_avail_weight double precision:=0; v_oee_weight double precision:=0;
 v_perf_total double precision:=0; v_avail_total double precision:=0; v_oee_total double precision:=0; v_shift_perf double precision; v_shift_avail double precision; v_shift_oee double precision;
 r record; v_minutes double precision; v_norm double precision; v_ocr_norm double precision; v_norm_100 double precision; v_capacity double precision; v_teff double precision; v_perf double precision; v_oee double precision; v_staffing_ratio double precision;
 v_downtime_minutes double precision; v_downtime_before boolean; v_reason text; v_changeover boolean; v_first boolean:=false; v_is_first boolean; v_previous_product text:=null; v_previous_role text:=null; v_changed boolean; v_relevant boolean; v_mode text; v_product_finished boolean;
begin
 select work_date into v_work_date from public.import_items where id=p_import_item_id;
 select count(*) into v_operator_count from public.import_item_rows where import_item_id=p_import_item_id and employee_id is not null;
 if v_operator_count<1 then return; end if;
 for r in
  select h.id,h.hour,h.product_code,h.role,h.actual_output,h.availability_pct,h.raw_data,
         lead(h.product_code) over(order by h.hour,h.id) as next_product_code,
         lead(h.role) over(order by h.hour,h.id) as next_role
  from public.import_item_hourly h
  where h.import_item_id=p_import_item_id
    and not(coalesce(h.actual_output,0)=0 and coalesce(h.norm_per_hour,0)=0 and nullif(trim(coalesce(h.product_code,'')),'') is null)
  order by h.hour,h.id
 loop
  select case when upper(coalesce(r.role,''))='TUP' and lower(regexp_replace(coalesce(pp.tup_subassy,''),'\s+','','g'))=lower(regexp_replace(coalesce(r.product_code,''),'\s+','','g')) then pp.t_norm_per_hour else pp.h_norm_per_hour end,
         case when upper(coalesce(r.role,''))='TUP' and lower(regexp_replace(coalesce(pp.tup_subassy,''),'\s+','','g'))=lower(regexp_replace(coalesce(r.product_code,''),'\s+','','g')) then pp.t_capacity else pp.h_capacity end
  into v_norm,v_capacity
  from public.product_profiles pp
  where (lower(regexp_replace(coalesce(pp.ha_subassy,''),'\s+','','g'))=lower(regexp_replace(coalesce(r.product_code,''),'\s+','','g')) or lower(regexp_replace(coalesce(pp.tup_subassy,''),'\s+','','g'))=lower(regexp_replace(coalesce(r.product_code,''),'\s+','','g')))
    and (v_work_date is null or pp.valid_from is null or pp.valid_from<=v_work_date)
    and (v_work_date is null or pp.valid_to is null or pp.valid_to>=v_work_date)
  order by pp.valid_to is null desc,pp.valid_from desc nulls last,pp.version_no desc nulls last limit 1;
  if v_norm is null or v_norm<=0 or v_capacity is null or v_capacity<=0 then continue; end if;
  v_is_first:=not v_first; v_first:=true;
  v_changed:=v_previous_product is not null and lower(regexp_replace(coalesce(r.product_code,''),'\s+','','g'))<>v_previous_product and upper(coalesce(r.role,''))=coalesce(v_previous_role,'');
  v_product_finished:=r.next_product_code is not null
    and lower(regexp_replace(coalesce(r.next_product_code,''),'\s+','','g'))<>lower(regexp_replace(coalesce(r.product_code,''),'\s+','','g'))
    and upper(coalesce(r.next_role,''))=upper(coalesce(r.role,''));
  v_ocr_norm:=coalesce(nullif(trim(coalesce(r.raw_data->>'ocr_norm_per_hour','')),'')::double precision,nullif(trim(coalesce(r.raw_data->>'norm_per_hour','')),'')::double precision);
  v_downtime_minutes:=coalesce(nullif(trim(coalesce(r.raw_data->>'downtime_minutes','')),'')::double precision,nullif(trim(coalesce(r.raw_data->>'downtime_min','')),'')::double precision,nullif(trim(coalesce(r.raw_data->>'odstavka_minutes','')),'')::double precision,nullif(trim(coalesce(r.raw_data->>'odstavka_min','')),'')::double precision);
  v_downtime_before:=case when lower(coalesce(r.raw_data->>'downtime_before_production','')) in('true','1','ano','yes') then true when lower(coalesce(r.raw_data->>'downtime_before_production','')) in('false','0','ne','no') then false else null end;
  v_reason:=nullif(trim(coalesce(r.raw_data->>'downtime_reason',r.raw_data->>'reason',r.raw_data->>'odstavka_reason',r.raw_data->>'odstavky_reason',r.raw_data->>'duvod_odstavky',r.raw_data->>'důvod_odstávky','')),'');
  v_changeover:=lower(coalesce(v_reason,'')) like '%změna produktu%' or lower(coalesce(v_reason,'')) like '%zmena produktu%';
  v_relevant:=coalesce(v_downtime_minutes,0)>0 and ((v_downtime_before=true and (v_is_first or v_changed)) or (v_changed and v_changeover));
  v_norm_100:=case when v_ocr_norm is not null and v_ocr_norm>0 and r.availability_pct is not null and r.availability_pct>0 then v_ocr_norm/(r.availability_pct/100.0) else null end;
  v_teff:=case when v_product_finished and v_ocr_norm is not null and v_ocr_norm>0 then (v_ocr_norm/v_norm)*60.0 when v_norm_100 is not null then(v_norm_100/v_norm)*60.0 else null end;

  -- IMPORTANT: first productive row is NOT a TEFF trigger. The existing
  -- canonical shift-clock model defines the shift boundaries. A TEFF mode is
  -- selected here only by a documented relevant downtime/product change or by
  -- the product-finish rule from V8.
  if v_product_finished and v_ocr_norm is not null and v_ocr_norm>0 then
    v_mode:='TEFF'; v_minutes:=least(60.0,greatest(0,v_teff));
  elsif v_relevant then
    v_mode:='TEFF'; v_minutes:=least(60.0,greatest(0,60.0-coalesce(v_downtime_minutes,0)));
  else
    v_mode:='CLASSIC_AVAILABILITY'; v_minutes:=60.0;
  end if;

  v_staffing_ratio:=v_operator_count::double precision/v_capacity;
  v_perf:=case when r.actual_output is not null and v_staffing_ratio>0 then r.actual_output/(v_norm*v_minutes/60.0*v_staffing_ratio)*100.0 else null end;
  v_oee:=case when v_perf is null then null when v_mode='TEFF' then v_perf when r.availability_pct is not null then v_perf*r.availability_pct/100.0 else null end;
  update public.import_item_hourly set norm_per_hour=v_norm,capacity=v_capacity,operator_count=v_operator_count,actual_minutes=v_minutes,performance_pct=v_perf,actual_oee_pct=v_oee,raw_data=coalesce(raw_data,'{}'::jsonb)||jsonb_build_object('calculation',jsonb_build_object('model_version','2.01-AUTO-staffing-kpi-v9','calculation_mode',v_mode,'ocr_norm',v_ocr_norm,'product_profile_norm',v_norm,'norm_at_100_availability',v_norm_100,'effective_time_minutes',v_teff,'productive_minutes',v_minutes,'downtime_minutes',v_downtime_minutes,'downtime_before_production',v_downtime_before,'downtime_reason',v_reason,'downtime_relevant',v_relevant,'first_productive_row',v_is_first,'product_changed',v_changed,'product_finished',v_product_finished,'staffing_ratio',v_staffing_ratio,'shift_boundary_rule','canonical clock-time model; first row does not imply TEFF','performance_formula','actual / (Product Profile norm x time x staffing) x 100','oee_formula',case when v_mode='TEFF' then 'OEE = Performance' else 'OEE = Performance x Availability / 100' end)) where id=r.id;
  if v_perf is not null then v_perf_total:=v_perf_total+v_perf*v_minutes;v_perf_weight:=v_perf_weight+v_minutes;end if;
  if r.availability_pct is not null then v_avail_total:=v_avail_total+r.availability_pct*v_minutes;v_avail_weight:=v_avail_weight+v_minutes;end if;
  if v_oee is not null then v_oee_total:=v_oee_total+v_oee*v_minutes;v_oee_weight:=v_oee_weight+v_minutes;end if;
  v_previous_product:=lower(regexp_replace(coalesce(r.product_code,''),'\s+','','g'));v_previous_role:=upper(coalesce(r.role,''));
 end loop;
 v_shift_perf:=case when v_perf_weight>0 then v_perf_total/v_perf_weight else null end;v_shift_avail:=case when v_avail_weight>0 then v_avail_total/v_avail_weight else null end;v_shift_oee:=case when v_oee_weight>0 then v_oee_total/v_oee_weight else null end;
 perform set_config('app.verze_2_01_auto_system_kpi_recalc','on',true);update public.import_item_rows set performance=v_shift_perf,available_time=v_shift_avail,oee=v_shift_oee where import_item_id=p_import_item_id and daily_record_id is null;perform set_config('app.verze_2_01_auto_system_kpi_recalc','off',true);
 update public.import_items set ocr_data=jsonb_set(jsonb_set(jsonb_set(jsonb_set(coalesce(ocr_data,'{}'::jsonb),'{actual_shift_performance_pct}',to_jsonb(v_shift_perf),true),'{actual_shift_availability_pct}',to_jsonb(v_shift_avail),true),'{actual_shift_oee_pct}',to_jsonb(v_shift_oee),true),'{kpi_model_version}',to_jsonb('2.01-AUTO-staffing-kpi-v9'::text),true) where id=p_import_item_id;
end;$$;
grant execute on function public.recalculate_import_item_kpis(uuid) to authenticated;
