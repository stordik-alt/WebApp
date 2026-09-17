-- Verze 2.01 AUTO V17.1
-- Fix current DB helper signature: (shift, hour, screenshot_time, is_last_hour).
-- Scope: Verze-2.01-Auto only.

CREATE OR REPLACE FUNCTION public.recalculate_import_item_kpis(p_import_item_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_item public.import_items%rowtype;
  v_operator_count integer;
  v_perf_weight double precision := 0; v_avail_weight double precision := 0; v_oee_weight double precision := 0;
  v_perf_total double precision := 0; v_avail_total double precision := 0; v_oee_total double precision := 0;
  v_shift_perf double precision; v_shift_avail double precision; v_shift_oee double precision;
  r record; v_minutes double precision; v_scheduled_minutes double precision; v_norm double precision; v_ocr_norm double precision;
  v_capacity double precision; v_perf double precision; v_oee double precision; v_staffing_ratio double precision;
  v_downtime_minutes double precision; v_downtime_before boolean; v_reason text; v_changeover boolean;
  v_first boolean := false; v_is_first boolean; v_changed boolean; v_relevant boolean; v_mode text;
  v_product_finished boolean; v_same_hour boolean; v_next_same_role boolean; v_multi_product_hour boolean;
  v_remaining_minutes double precision; v_is_last_hour boolean;
BEGIN
  SELECT * INTO v_item FROM public.import_items WHERE id=p_import_item_id;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT count(*) INTO v_operator_count FROM public.import_item_rows
  WHERE import_item_id=p_import_item_id AND employee_id IS NOT NULL;
  IF v_operator_count<1 THEN RETURN; END IF;

  FOR r IN
    SELECT h.id,h.hour,h.product_code,h.role,h.actual_output,h.availability_pct,h.raw_data,
      lag(h.product_code) OVER (ORDER BY h.hour,h.id) AS previous_product_code,
      lag(h.role) OVER (ORDER BY h.hour,h.id) AS previous_role,
      lag(h.hour) OVER (ORDER BY h.hour,h.id) AS previous_hour,
      lead(h.product_code) OVER (ORDER BY h.hour,h.id) AS next_product_code,
      lead(h.role) OVER (ORDER BY h.hour,h.id) AS next_role,
      lead(h.hour) OVER (ORDER BY h.hour,h.id) AS next_hour
    FROM public.import_item_hourly h
    WHERE h.import_item_id=p_import_item_id
      AND NOT (coalesce(h.actual_output,0)=0 AND coalesce(h.norm_per_hour,0)=0 AND nullif(trim(coalesce(h.product_code,'')),'') IS NULL)
    ORDER BY h.hour,h.id
  LOOP
    SELECT CASE WHEN upper(coalesce(r.role,''))='TUP' AND lower(regexp_replace(coalesce(pp.tup_subassy,''),'\s+','','g'))=lower(regexp_replace(coalesce(r.product_code,''),'\s+','','g')) THEN pp.t_norm_per_hour ELSE pp.h_norm_per_hour END,
           CASE WHEN upper(coalesce(r.role,''))='TUP' AND lower(regexp_replace(coalesce(pp.tup_subassy,''),'\s+','','g'))=lower(regexp_replace(coalesce(r.product_code,''),'\s+','','g')) THEN pp.t_capacity ELSE pp.h_capacity END
    INTO v_norm,v_capacity FROM public.product_profiles pp
    WHERE (lower(regexp_replace(coalesce(pp.ha_subassy,''),'\s+','','g'))=lower(regexp_replace(coalesce(r.product_code,''),'\s+','','g')) OR lower(regexp_replace(coalesce(pp.tup_subassy,''),'\s+','','g'))=lower(regexp_replace(coalesce(r.product_code,''),'\s+','','g')))
      AND (v_item.work_date IS NULL OR pp.valid_from IS NULL OR pp.valid_from<=v_item.work_date)
      AND (v_item.work_date IS NULL OR pp.valid_to IS NULL OR pp.valid_to>=v_item.work_date)
    ORDER BY pp.valid_to IS NULL DESC,pp.valid_from DESC NULLS LAST,pp.version_no DESC NULLS LAST LIMIT 1;
    IF v_norm IS NULL OR v_norm<=0 OR v_capacity IS NULL OR v_capacity<=0 THEN CONTINUE; END IF;

    v_is_first:=NOT v_first; v_first:=true;
    v_same_hour:=r.previous_hour IS NOT NULL AND r.previous_hour=r.hour;
    v_next_same_role:=r.next_hour IS NOT NULL AND r.next_hour=r.hour AND upper(coalesce(r.next_role,''))=upper(coalesce(r.role,''));
    v_changed:=v_same_hour AND upper(coalesce(r.role,''))=upper(coalesce(r.previous_role,'')) AND lower(regexp_replace(coalesce(r.product_code,''),'\s+','','g'))<>lower(regexp_replace(coalesce(r.previous_product_code,''),'\s+','','g'));
    v_product_finished:=v_next_same_role AND lower(regexp_replace(coalesce(r.next_product_code,''),'\s+','','g'))<>lower(regexp_replace(coalesce(r.product_code,''),'\s+','','g'));
    v_multi_product_hour:=v_changed OR v_product_finished;

    v_ocr_norm:=coalesce(nullif(trim(coalesce(r.raw_data->>'ocr_norm_per_hour','')),'')::double precision,nullif(trim(coalesce(r.raw_data->>'norm_per_hour','')),'')::double precision);
    v_downtime_minutes:=coalesce(nullif(trim(coalesce(r.raw_data->>'downtime_minutes','')),'')::double precision,nullif(trim(coalesce(r.raw_data->>'downtime_min','')),'')::double precision,nullif(trim(coalesce(r.raw_data->>'odstavka_minutes','')),'')::double precision,nullif(trim(coalesce(r.raw_data->>'odstavka_min','')),'')::double precision,0);
    v_downtime_before:=CASE WHEN lower(coalesce(r.raw_data->>'downtime_before_production','')) IN ('true','1','ano','yes') THEN true WHEN lower(coalesce(r.raw_data->>'downtime_before_production','')) IN ('false','0','ne','no') THEN false ELSE NULL END;
    v_reason:=nullif(trim(coalesce(r.raw_data->>'downtime_reason',r.raw_data->>'reason',r.raw_data->>'odstavka_reason',r.raw_data->>'odstavky_reason',r.raw_data->>'duvod_odstavky',r.raw_data->>'důvod_odstávky','')),'');
    v_changeover:=lower(coalesce(v_reason,'')) LIKE '%změna produktu%' OR lower(coalesce(v_reason,'')) LIKE '%zmena produktu%';

    v_is_last_hour:=false;
    IF nullif(trim(coalesce(v_item.ocr_data->>'screenshot_time','')),'') IS NOT NULL THEN
      v_is_last_hour := r.next_hour IS NULL;
    END IF;
    v_scheduled_minutes:=public.auto_shift_productive_minutes(v_item.shift,r.hour,v_item.ocr_data->>'screenshot_time',v_is_last_hour)::double precision;

    v_relevant:=coalesce(v_downtime_minutes,0)>0 AND ((v_downtime_before=true AND (v_is_first OR v_changed)) OR (v_changed AND v_changeover));
    IF v_product_finished THEN v_relevant:=false; END IF;

    IF v_multi_product_hour AND v_is_first AND v_ocr_norm IS NOT NULL AND v_ocr_norm>0 AND v_scheduled_minutes>0 THEN
      v_mode:='TEFF';
      v_minutes:=LEAST(v_scheduled_minutes,GREATEST(0,(v_ocr_norm/v_norm)*v_scheduled_minutes));
    ELSIF v_multi_product_hour AND v_changed AND v_scheduled_minutes>0 THEN
      v_mode:='TEFF';
      SELECT GREATEST(0,v_scheduled_minutes-coalesce(sum(coalesce(x.actual_minutes,0)),0)) INTO v_remaining_minutes
      FROM public.import_item_hourly x WHERE x.import_item_id=p_import_item_id AND x.hour=r.hour AND x.id<>r.id;
      IF v_changeover THEN v_remaining_minutes:=GREATEST(0,v_remaining_minutes-coalesce(v_downtime_minutes,0)); END IF;
      v_minutes:=LEAST(v_scheduled_minutes,v_remaining_minutes);
    ELSIF v_relevant THEN
      v_mode:='TEFF'; v_minutes:=GREATEST(0,v_scheduled_minutes-coalesce(v_downtime_minutes,0));
    ELSE
      v_mode:='CLASSIC_AVAILABILITY'; v_minutes:=v_scheduled_minutes;
    END IF;

    v_staffing_ratio:=v_operator_count::double precision/v_capacity;
    v_perf:=CASE WHEN r.actual_output IS NOT NULL AND v_staffing_ratio>0 AND v_minutes>0 THEN r.actual_output/(v_norm*v_minutes/60.0*v_staffing_ratio)*100.0 ELSE NULL END;
    v_oee:=CASE WHEN v_perf IS NULL THEN NULL WHEN v_mode='TEFF' THEN v_perf WHEN r.availability_pct IS NOT NULL THEN v_perf*r.availability_pct/100.0 ELSE NULL END;

    UPDATE public.import_item_hourly SET norm_per_hour=v_norm,capacity=v_capacity,operator_count=v_operator_count,actual_minutes=v_minutes,performance_pct=v_perf,actual_oee_pct=v_oee,
      raw_data=coalesce(raw_data,'{}'::jsonb)||jsonb_build_object('calculation',coalesce(raw_data->'calculation','{}'::jsonb)||jsonb_build_object(
        'model_version','2.01-AUTO-staffing-kpi-v17.1','calculation_mode',v_mode,'ocr_norm',v_ocr_norm,'product_profile_norm',v_norm,
        'scheduled_productive_minutes',v_scheduled_minutes,'effective_time_minutes',CASE WHEN v_mode='TEFF' THEN v_minutes ELSE NULL END,'productive_minutes',v_minutes,
        'downtime_minutes',v_downtime_minutes,'downtime_before_production',v_downtime_before,'downtime_reason',v_reason,'downtime_relevant',v_relevant,
        'fixed_break_excluded',true,'first_productive_row',v_is_first,'product_changed',v_changed,'multi_product_product_hour',v_multi_product_hour,'product_finished',v_product_finished,'staffing_ratio',v_staffing_ratio,
        'last_hour_from_header',v_is_last_hour));

    IF v_perf IS NOT NULL THEN v_perf_total:=v_perf_total+v_perf*v_minutes; v_perf_weight:=v_perf_weight+v_minutes; END IF;
    IF r.availability_pct IS NOT NULL THEN v_avail_total:=v_avail_total+r.availability_pct*v_minutes; v_avail_weight:=v_avail_weight+v_minutes; END IF;
    IF v_oee IS NOT NULL THEN v_oee_total:=v_oee_total+v_oee*v_minutes; v_oee_weight:=v_oee_weight+v_minutes; END IF;
  END LOOP;

  v_shift_perf:=CASE WHEN v_perf_weight>0 THEN v_perf_total/v_perf_weight ELSE NULL END;
  v_shift_avail:=CASE WHEN v_avail_weight>0 THEN v_avail_total/v_avail_weight ELSE NULL END;
  v_shift_oee:=CASE WHEN v_oee_weight>0 THEN v_oee_total/v_oee_weight ELSE NULL END;
  PERFORM set_config('app.verze_2_01_auto_system_kpi_recalc','on',true);
  UPDATE public.import_item_rows SET performance=v_shift_perf,available_time=v_shift_avail,oee=v_shift_oee,
    raw_data=coalesce(raw_data,'{}'::jsonb)||jsonb_build_object('performance',v_shift_perf,'available_time',v_shift_avail,'oee',v_shift_oee,'kpi_model_version','2.01-AUTO-staffing-kpi-v17.1')
  WHERE import_item_id=p_import_item_id AND daily_record_id IS NULL;
  PERFORM set_config('app.verze_2_01_auto_system_kpi_recalc','off',true);
  UPDATE public.import_items SET ocr_data=jsonb_set(jsonb_set(jsonb_set(jsonb_set(coalesce(ocr_data,'{}'::jsonb),'{actual_shift_performance_pct}',to_jsonb(v_shift_perf),true),'{actual_shift_availability_pct}',to_jsonb(v_shift_avail),true),'{actual_shift_oee_pct}',to_jsonb(v_shift_oee),true),'{kpi_model_version}',to_jsonb('2.01-AUTO-staffing-kpi-v17.1'::text),true) WHERE id=p_import_item_id;
END; $$;

grant execute on function public.recalculate_import_item_kpis(uuid) to authenticated;
