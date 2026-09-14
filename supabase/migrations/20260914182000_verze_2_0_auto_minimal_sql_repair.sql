-- Verze 2.0 AUTO: minimal SQL repair
-- Creates the missing KPI trigger path without requiring a large pasted SQL block.

CREATE OR REPLACE FUNCTION public.recalculate_import_item_kpis(p_import_item_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_shift text;
  v_operator_count integer;
  v_perf_total numeric := 0;
  v_avail_total numeric := 0;
  v_oee_total numeric := 0;
  v_weight numeric := 0;
  r record;
  v_minutes numeric;
  v_norm numeric;
  v_capacity numeric;
  v_perf numeric;
  v_oee numeric;
BEGIN
  SELECT lower(trim(coalesce(shift, '')))
    INTO v_shift
  FROM public.import_items
  WHERE id = p_import_item_id;

  IF NOT FOUND THEN RETURN; END IF;

  SELECT count(*)
    INTO v_operator_count
  FROM public.import_item_rows
  WHERE import_item_id = p_import_item_id
    AND employee_id IS NOT NULL;

  v_operator_count := greatest(coalesce(v_operator_count, 1), 1);

  FOR r IN
    SELECT id, hour, product_code, role, actual_output, availability_pct
    FROM public.import_item_hourly
    WHERE import_item_id = p_import_item_id
    ORDER BY id
  LOOP
    v_minutes := public.auto_shift_productive_minutes(v_shift, r.hour, NULL);

    SELECT
      CASE
        WHEN upper(coalesce(r.role, '')) = 'TUP'
          AND lower(regexp_replace(coalesce(pp.tup_subassy,''), '\s+', '', 'g')) = lower(regexp_replace(coalesce(r.product_code,''), '\s+', '', 'g'))
          THEN pp.t_norm_per_hour
        ELSE pp.h_norm_per_hour
      END,
      CASE
        WHEN upper(coalesce(r.role, '')) = 'TUP'
          AND lower(regexp_replace(coalesce(pp.tup_subassy,''), '\s+', '', 'g')) = lower(regexp_replace(coalesce(r.product_code,''), '\s+', '', 'g'))
          THEN pp.t_capacity
        ELSE pp.h_capacity
      END
    INTO v_norm, v_capacity
    FROM public.product_profiles pp
    WHERE lower(regexp_replace(coalesce(pp.ha_subassy,''), '\s+', '', 'g')) = lower(regexp_replace(coalesce(r.product_code,''), '\s+', '', 'g'))
       OR lower(regexp_replace(coalesce(pp.tup_subassy,''), '\s+', '', 'g')) = lower(regexp_replace(coalesce(r.product_code,''), '\s+', '', 'g'))
    ORDER BY pp.valid_to IS NULL DESC, pp.valid_from DESC NULLS LAST, pp.version_no DESC NULLS LAST
    LIMIT 1;

    v_perf := CASE
      WHEN r.actual_output IS NOT NULL AND v_norm IS NOT NULL AND v_norm > 0 AND v_minutes > 0
      THEN r.actual_output / (v_norm * v_minutes / 60.0) * 100.0
      ELSE NULL
    END;

    v_oee := CASE
      WHEN v_perf IS NOT NULL AND r.availability_pct IS NOT NULL
       AND v_capacity IS NOT NULL AND v_capacity > 0
      THEN v_perf * r.availability_pct * (v_capacity / v_operator_count::numeric) / 100.0
      ELSE NULL
    END;

    UPDATE public.import_item_hourly
    SET norm_per_hour = v_norm,
        capacity = v_capacity,
        operator_count = v_operator_count,
        performance_pct = v_perf,
        actual_oee_pct = v_oee
    WHERE id = r.id;

    IF v_minutes > 0 THEN
      IF v_perf IS NOT NULL THEN v_perf_total := v_perf_total + v_perf * v_minutes; END IF;
      IF r.availability_pct IS NOT NULL THEN v_avail_total := v_avail_total + r.availability_pct * v_minutes; END IF;
      IF v_oee IS NOT NULL THEN v_oee_total := v_oee_total + v_oee * v_minutes; END IF;
      v_weight := v_weight + v_minutes;
    END IF;
  END LOOP;

  UPDATE public.import_item_rows
  SET performance = CASE WHEN v_weight > 0 THEN v_perf_total / v_weight ELSE NULL END,
      available_time = CASE WHEN v_weight > 0 THEN v_avail_total / v_weight ELSE NULL END,
      oee = CASE WHEN v_weight > 0 THEN v_oee_total / v_weight ELSE NULL END
  WHERE import_item_id = p_import_item_id
    AND daily_record_id IS NULL;

  UPDATE public.import_items
  SET ocr_data = coalesce(ocr_data, '{}'::jsonb)
    || jsonb_build_object(
      'actual_shift_performance_pct', CASE WHEN v_weight > 0 THEN v_perf_total / v_weight ELSE NULL END,
      'actual_shift_availability_pct', CASE WHEN v_weight > 0 THEN v_avail_total / v_weight ELSE NULL END,
      'actual_shift_oee_pct', CASE WHEN v_weight > 0 THEN v_oee_total / v_weight ELSE NULL END,
      'productive_minutes', v_weight,
      'kpi_model_version', '2.0-AUTO-shift-time-v1'
    )
  WHERE id = p_import_item_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.recalculate_import_item_kpis_on_validating()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'VALIDATING'
     AND OLD.status IS DISTINCT FROM NEW.status THEN
    PERFORM public.recalculate_import_item_kpis(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_import_items_recalculate_kpis ON public.import_items;

CREATE TRIGGER trg_import_items_recalculate_kpis
AFTER UPDATE ON public.import_items
FOR EACH ROW
EXECUTE FUNCTION public.recalculate_import_item_kpis_on_validating();

GRANT EXECUTE ON FUNCTION public.recalculate_import_item_kpis(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.recalculate_import_item_kpis_on_validating() TO authenticated;
