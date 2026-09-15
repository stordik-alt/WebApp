-- Verze 2.01 AUTO: robust system KPI recalculation guard.
-- The trigger cannot identify recalculate_import_item_kpis() from NEW.raw_data,
-- so a transaction-local GUC explicitly marks the protected system write.

create or replace function public.prevent_manual_import_kpi_edit()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare item_status text; is_system_recalc boolean;
begin
  select status into item_status from public.import_items where id = new.import_item_id;
  is_system_recalc := coalesce(current_setting('app.verze_2_01_auto_system_kpi_recalc', true), '') = 'on';
  if tg_op = 'UPDATE'
     and item_status in ('PENDING_APPROVAL','AUTO_APPROVED','APPROVED')
     and not is_system_recalc
     and (old.oee is distinct from new.oee or old.performance is distinct from new.performance or old.available_time is distinct from new.available_time) then
    raise exception 'Výkon, Dostupnost a OEE jsou v importu 2.0 AUTO pouze systémově vypočtené hodnoty.';
  end if;
  return new;
end; $$;

drop trigger if exists trg_import_item_rows_kpi_integrity on public.import_item_rows;
create trigger trg_import_item_rows_kpi_integrity before update on public.import_item_rows for each row execute function public.prevent_manual_import_kpi_edit();
grant execute on function public.prevent_manual_import_kpi_edit() to authenticated;

-- Replace the canonical function with the approved staffing model and mark its KPI write.
create or replace function public.recalculate_import_item_kpis(p_import_item_id uuid)
returns void language plpgsql security definer set search_path = public
as $$
declare
  v_operator_count integer; v_perf_weight double precision:=0; v_avail_weight double precision:=0; v_oee_weight double precision:=0;
  v_perf_total double precision:=0; v_avail_total double precision:=0; v_oee_total double precision:=0;
  v_shift_perf double precision; v_shift_avail double precision; v_shift_oee double precision;
  r record; v_minutes double precision; v_availability_minutes double precision; v_norm double precision; v_ocr_norm double precision;
  v_norm_100 double precision; v_capacity double precision; v_teff double precision; v_perf double precision; v_oee double precision;
  v_downtime_minutes double precision; v_downtime_before_production boolean; v_first_productive boolean:=false; v_is_first_productive boolean;
  v_previous_product text:=null; v_product_changed boolean;
begin
  select count(*) into v_operator_count from public.import_item_rows where import_item_id=p_import_item_id and employee_id is not null;
  if v_operator_count<1 then return; end if;

  for r in select h.id,h.hour,h.product_code,h.role,h.actual_output,h.availability_pct,h.raw_data from public.import_item_hourly h where h.import_item_id=p_import_item_id and not(coalesce(h.actual_output,0)=0 and coalesce(h.norm_per_hour,0)=0 and nullif(trim(coalesce(h.product_code,'')),'') is null) order by h.hour,h.id loop
    if coalesce(r.actual_output,0)<=0 then continue; end if;
    v_is_first_productive:=not v_first_productive; v_first_productive:=true;
    v_product_changed:=v_previous_product is not null and lower(regexp_replace(coalesce(r.product_code,''),'\s+','','g'))<>v_previous_product;

    select case
      when upper(coalesce(r.role,''))='HA' and lower(regexp_replace(coalesce(pp.ha_subassy,''),'\s+','','g'))=lower(regexp_replace(coalesce(r.product_code,''),'\s+','','g')) then pp.h_norm_per_hour
      when upper(coalesce(r.role,''))='TUP' and lower(regexp_replace(coalesce(pp.tup_subassy,''),'\s+','','g'))=lower(regexp_replace(coalesce(r.product_code,''),'\s+','','g')) then pp.t_norm_per_hour
      when lower(regexp_replace(coalesce(pp.ha_subassy,''),'\s+','','g'))=lower(regexp_replace(coalesce(r.product_code,''),'\s+','','g')) then pp.h_norm_per_hour
      when lower(regexp_replace(coalesce(pp.tup_subassy,''),'\s+','','g'))=lower(regexp_replace(coalesce(r.product_code,''),'\s+','','g')) then pp.t_norm_per_hour end,
      case
      when upper(coalesce(r.role,''))='HA' and lower(regexp_replace(coalesce(pp.ha_subassy,''),'\s+','','g'))=lower(regexp_replace(coalesce(r.product_code,''),'\s+','','g')) then pp.h_capacity
      when upper(coalesce(r.role,''))='TUP' and lower(regexp_replace(coalesce(pp.tup_subassy,''),'\s+','','g'))=lower(regexp_replace(coalesce(r.product_code,''),'\s+','','g')) then pp.t_capacity
      when lower(regexp_replace(coalesce(pp.ha_subassy,''),'\s+','','g'))=lower(regexp_replace(coalesce(r.product_code,''),'\s+','','g')) then pp.h_capacity
      when lower(regexp_replace(coalesce(pp.tup_subassy,''),'\s+','','g'))=lower(regexp_replace(coalesce(r.product_code,''),'\s+','','g')) then pp.t_capacity end
    into v_norm,v_capacity from public.product_profiles pp
    where lower(regexp_replace(coalesce(pp.ha_subassy,''),'\s+','','g'))=lower(regexp_replace(coalesce(r.product_code,''),'\s+','','g')) or lower(regexp_replace(coalesce(pp.tup_subassy,''),'\s+','','g'))=lower(regexp_replace(coalesce(r.product_code,''),'\s+','','g'))
    order by pp.valid_to is null desc,pp.valid_from desc nulls last,pp.version_no desc nulls last limit 1;
    if v_norm is null or v_norm<=0 then continue; end if;

    v_ocr_norm:=coalesce(nullif(trim(coalesce(r.raw_data->>'ocr_norm_per_hour','')),'')::double precision,nullif(trim(coalesce(r.raw_data->>'norm_per_hour','')),'')::double precision);
    v_downtime_minutes:=coalesce(nullif(trim(coalesce(r.raw_data->>'downtime_minutes','')),'')::double precision,nullif(trim(coalesce(r.raw_data->>'downtime_min','')),'')::double precision,nullif(trim(coalesce(r.raw_data->>'odstavka_minutes','')),'')::double precision,nullif(trim(coalesce(r.raw_data->>'odstavka_min','')),'')::double precision);
    v_downtime_before_production:=case when lower(coalesce(r.raw_data->>'downtime_before_production','')) in('true','1','ano','yes') then true when lower(coalesce(r.raw_data->>'downtime_before_production','')) in('false','0','ne','no') then false else null end;
    v_norm_100:=case when v_ocr_norm is not null and v_ocr_norm>0 and r.availability_pct is not null and r.availability_pct>0 then v_ocr_norm/(r.availability_pct/100.0) else null end;
    v_teff:=case when v_norm_100 is not null and v_norm>0 then(v_norm_100/v_norm)*60.0 else null end;
    v_availability_minutes:=60.0*greatest(0,least(100,coalesce(r.availability_pct,100)))/100.0; v_minutes:=v_availability_minutes;
    if v_is_first_productive and coalesce(v_downtime_minutes,0)<=0 and v_teff is not null and v_teff>0 then v_minutes:=least(60.0,v_teff);
    elsif coalesce(v_downtime_minutes,0)>0 and(coalesce(v_downtime_before_production,false) or v_product_changed) then v_minutes:=least(v_availability_minutes,greatest(0,60.0-v_downtime_minutes)); end if;
    if v_minutes<=0 then continue; end if;

    v_perf:=case when r.actual_output is not null and v_norm>0 and v_capacity>0 and v_operator_count>0 then r.actual_output/(v_norm*v_minutes/60.0*(v_operator_count::double precision/v_capacity))*100.0 else null end;
    v_oee:=case when v_perf is not null and r.availability_pct is not null and v_capacity>0 and v_operator_count>0 then v_perf*r.availability_pct*(v_operator_count::double precision/v_capacity)/100.0 else null end;

    update public.import_item_hourly set norm_per_hour=v_norm,capacity=v_capacity,operator_count=v_operator_count,actual_minutes=v_minutes,performance_pct=v_perf,actual_oee_pct=v_oee,
      raw_data=coalesce(raw_data,'{}'::jsonb)||jsonb_build_object('calculation',jsonb_build_object('model_version','2.01-AUTO-staffing-kpi-v3','ocr_norm',v_ocr_norm,'norm_at_100_availability',v_norm_100,'effective_time_minutes',v_teff,'productive_minutes',v_minutes,'downtime_minutes',v_downtime_minutes,'downtime_before_production',v_downtime_before_production,'first_productive_row',v_is_first_productive,'product_changed',v_product_changed,'performance_formula','Reálný výstup / (norma × teff × operátoři/kapacita) × 100','oee_formula','Performance × Dostupnost × (operátoři/kapacita) / 100','calculated_performance_pct',v_perf,'calculated_oee_pct',v_oee)) where id=r.id;
    if v_perf is not null then v_perf_total:=v_perf_total+v_perf*v_minutes;v_perf_weight:=v_perf_weight+v_minutes;end if;
    if r.availability_pct is not null then v_avail_total:=v_avail_total+r.availability_pct*v_minutes;v_avail_weight:=v_avail_weight+v_minutes;end if;
    if v_oee is not null then v_oee_total:=v_oee_total+v_oee*v_minutes;v_oee_weight:=v_oee_weight+v_minutes;end if;
    v_previous_product:=lower(regexp_replace(coalesce(r.product_code,''),'\s+','','g'));
  end loop;

  v_shift_perf:=case when v_perf_weight>0 then v_perf_total/v_perf_weight else null end;
  v_shift_avail:=case when v_avail_weight>0 then v_avail_total/v_avail_weight else null end;
  v_shift_oee:=case when v_oee_weight>0 then v_oee_total/v_oee_weight else null end;
  perform set_config('app.verze_2_01_auto_system_kpi_recalc','on',true);
  update public.import_item_rows set performance=v_shift_perf,available_time=v_shift_avail,oee=v_shift_oee where import_item_id=p_import_item_id and daily_record_id is null;
  perform set_config('app.verze_2_01_auto_system_kpi_recalc','off',true);
  update public.import_items set ocr_data=jsonb_set(jsonb_set(jsonb_set(jsonb_set(coalesce(ocr_data,'{}'::jsonb),'{actual_shift_performance_pct}',to_jsonb(v_shift_perf),true),'{actual_shift_availability_pct}',to_jsonb(v_shift_avail),true),'{actual_shift_oee_pct}',to_jsonb(v_shift_oee),true),'{kpi_model_version}',to_jsonb('2.01-AUTO-staffing-kpi-v3'::text),true) where id=p_import_item_id;
end; $$;

grant execute on function public.recalculate_import_item_kpis(uuid) to authenticated;

do $$ declare r record; begin for r in select distinct i.id from public.import_items i join public.import_item_hourly h on h.import_item_id=i.id where i.status in('VALIDATING','PENDING_APPROVAL','AUTO_APPROVED','APPROVED','REJECTED') loop perform public.recalculate_import_item_kpis(r.id); end loop; end $$;
