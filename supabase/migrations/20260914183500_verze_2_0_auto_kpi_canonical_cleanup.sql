-- Verze 2.0 AUTO: canonical KPI cleanup
-- Final runtime path: the 4-argument shift clock is authoritative.
-- This migration is intentionally additive and repairs the already-created
-- functions without touching main or historical migrations.

DROP TRIGGER IF EXISTS trg_import_items_recalculate_kpis ON public.import_items;

CREATE OR REPLACE FUNCTION public.recalculate_import_item_kpis(p_import_item_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item public.import_items%rowtype;
  v_operator_count integer;
  v_perf_weight numeric := 0;
  v_avail_weight numeric := 0;
  v_oee_weight numeric := 0;
  v_perf_total numeric := 0;
  v_avail_total numeric := 0;
  v_oee_total numeric := 0;
  v_shift_perf numeric;
  v_shift_avail numeric;
  v_shift_oee numeric;
  v_screenshot_time text;
  v_hour_count integer;
  r record;
  v_minutes numeric;
  v_norm numeric;
  v_capacity numeric;
  v_perf numeric;
  v_oee numeric;
BEGIN
  SELECT * INTO v_item
  FROM public.import_items
  WHERE id = p_import_item_id;

  IF NOT FOUND THEN RETURN; END IF;

  SELECT count(*) INTO v_operator_count
  FROM public.import_item_rows
  WHERE import_item_id = p_import_item_id
    AND employee_id IS NOT NULL;

  v_operator_count := greatest(coalesce(v_operator_count, 0), 1);
  v_screenshot_time := nullif(trim(v_item.ocr_data ->> 'screenshot_time'), '');

  SELECT count(*) INTO v_hour_count
  FROM public.import_item_hourly
  WHERE import_item_id = p_import_item_id;

  FOR r IN
    SELECT h.id, h.hour, h.product_code, h.role, h.actual_output, h.availability_pct,
           row_number() OVER (
             ORDER BY CASE
               WHEN lower(trim(coalesce(v_item.shift, ''))) LIKE 'ra%' AND h.hour >= 6 THEN h.hour - 6
               WHEN lower(trim(coalesce(v_item.shift, ''))) LIKE 'od%' AND h.hour >= 14 THEN h.hour - 14
               WHEN lower(trim(coalesce(v_item.shift, ''))) LIKE 'no%' AND h.hour >= 22 THEN h.hour - 22
               WHEN lower(trim(coalesce(v_item.shift, ''))) LIKE 'no%' THEN h.hour + 2
               ELSE h.hour
             END, h.id
           ) AS rn
    FROM public.import_item_hourly h
    WHERE h.import_item_id = p_import_item_id
    ORDER BY CASE
      WHEN lower(trim(coalesce(v_item.shift, ''))) LIKE 'ra%' AND h.hour >= 6 THEN h.hour - 6
      WHEN lower(trim(coalesce(v_item.shift, ''))) LIKE 'od%' AND h.hour >= 14 THEN h.hour - 14
      WHEN lower(trim(coalesce(v_item.shift, ''))) LIKE 'no%' AND h.hour >= 22 THEN h.hour - 22
      WHEN lower(trim(coalesce(v_item.shift, ''))) LIKE 'no%' THEN h.hour + 2
      ELSE h.hour
    END, h.id
  LOOP
    v_minutes := public.auto_shift_productive_minutes(
      v_item.shift,
      r.hour,
      v_screenshot_time,
      (r.rn = v_hour_count)
    );

    v_norm := NULL;
    v_capacity := NULL;

    SELECT
      CASE
        WHEN upper(trim(coalesce(r.role, ''))) = 'HA'
          AND lower(regexp_replace(coalesce(pp.ha_subassy, ''), '\s+', '', 'g')) = lower(regexp_replace(coalesce(r.product_code, ''), '\s+', '', 'g'))
          THEN pp.h_norm_per_hour
        WHEN upper(trim(coalesce(r.role, ''))) = 'TUP'
          AND lower(regexp_replace(coalesce(pp.tup_subassy, ''), '\s+', '', 'g')) = lower(regexp_replace(coalesce(r.product_code, ''), '\s+', '', 'g'))
          THEN pp.t_norm_per_hour
        WHEN lower(regexp_replace(coalesce(pp.ha_subassy, ''), '\s+', '', 'g')) = lower(regexp_replace(coalesce(r.product_code, ''), '\s+', '', 'g'))
          AND lower(regexp_replace(coalesce(pp.tup_subassy, ''), '\s+', '', 'g')) <> lower(regexp_replace(coalesce(r.product_code, ''), '\s+', '', 'g'))
          THEN pp.h_norm_per_hour
        WHEN lower(regexp_replace(coalesce(pp.tup_subassy, ''), '\s+', '', 'g')) = lower(regexp_replace(coalesce(r.product_code, ''), '\s+', '', 'g'))
          AND lower(regexp_replace(coalesce(pp.ha_subassy, ''), '\s+', '', 'g')) <> lower(regexp_replace(coalesce(r.product_code, ''), '\s+', '', 'g'))
          THEN pp.t_norm_per_hour
        ELSE NULL
      END,
      CASE
        WHEN upper(trim(coalesce(r.role, ''))) = 'HA'
          AND lower(regexp_replace(coalesce(pp.ha_subassy, ''), '\s+', '', 'g')) = lower(regexp_replace(coalesce(r.product_code, ''), '\s+', '', 'g'))
          THEN pp.h_capacity
        WHEN upper(trim(coalesce(r.role, ''))) = 'TUP'
          AND lower(regexp_replace(coalesce(pp.tup_subassy, ''), '\s+', '', 'g')) = lower(regexp_replace(coalesce(r.product_code, ''), '\s+', '', 'g'))
          THEN pp.t_capacity
        WHEN lower(regexp_replace(coalesce(pp.ha_subassy, ''), '\s+', '', 'g')) = lower(regexp_replace(coalesce(r.product_code, ''), '\s+', '', 'g'))
          AND lower(regexp_replace(coalesce(pp.tup_subassy, ''), '\s+', '', 'g')) <> lower(regexp_replace(coalesce(r.product_code, ''), '\s+', '', 'g'))
          THEN pp.h_capacity
        WHEN lower(regexp_replace(coalesce(pp.tup_subassy, ''), '\s+', '', 'g')) = lower(regexp_replace(coalesce(r.product_code, ''), '\s+', '', 'g'))
          AND lower(regexp_replace(coalesce(pp.ha_subassy, ''), '\s+', '', 'g')) <> lower(regexp_replace(coalesce(r.product_code, ''), '\s+', '', 'g'))
          THEN pp.t_capacity
        ELSE NULL
      END
    INTO v_norm, v_capacity
    FROM public.product_profiles pp
    WHERE pp.valid_from <= coalesce(v_item.work_date, current_date)
      AND (pp.valid_to IS NULL OR pp.valid_to >= coalesce(v_item.work_date, current_date))
      AND (
        lower(regexp_replace(coalesce(pp.ha_subassy, ''), '\s+', '', 'g')) = lower(regexp_replace(coalesce(r.product_code, ''), '\s+', '', 'g'))
        OR lower(regexp_replace(coalesce(pp.tup_subassy, ''), '\s+', '', 'g')) = lower(regexp_replace(coalesce(r.product_code, ''), '\s+', '', 'g'))
      )
    ORDER BY pp.valid_to IS NULL DESC, pp.valid_from DESC NULLS LAST, pp.version_no DESC NULLS LAST
    LIMIT 1;

    v_perf := CASE
      WHEN r.actual_output IS NOT NULL AND v_norm IS NOT NULL AND v_norm > 0 AND v_minutes > 0
      THEN (r.actual_output / (v_norm * v_minutes / 60.0)) * 100.0
      ELSE NULL
    END;

    v_oee := CASE
      WHEN v_perf IS NOT NULL AND r.availability_pct IS NOT NULL
       AND v_capacity IS NOT NULL AND v_capacity > 0 AND v_operator_count > 0
      THEN v_perf * r.availability_pct * (v_capacity / v_operator_count::numeric) / 100.0
      ELSE NULL
    END;

    UPDATE public.import_item_hourly
    SET norm_per_hour = v_norm,
        capacity = v_capacity,
        operator_count = v_operator_count,
        performance_pct = v_perf,
        actual_oee_pct = v_oee,
        raw_data = coalesce(raw_data, '{}'::jsonb) || jsonb_build_object(
          'calculation', jsonb_build_object(
            'model_version', '2.0-AUTO-shift-time-v1',
            'productive_minutes', v_minutes,
            'effective_norm', CASE WHEN v_norm IS NOT NULL THEN v_norm * v_minutes / 60.0 ELSE NULL END,
            'performance_formula', '(Reálný výstup / (norma × produktivní minuty / 60)) × 100',
            'oee_formula', '(Výkon × Dostupnost × (kapacita / počet operátorů)) / 100',
            'actual_output', r.actual_output,
            'norm_per_hour', v_norm,
            'availability_pct', r.availability_pct,
            'capacity', v_capacity,
            'operator_count', v_operator_count,
            'calculated_performance_pct', v_perf,
            'calculated_oee_pct', v_oee
          )
        )
    WHERE id = r.id;

    IF v_minutes > 0 THEN
      IF v_perf IS NOT NULL THEN
        v_perf_total := v_perf_total + v_perf * v_minutes;
        v_perf_weight := v_perf_weight + v_minutes;
      END IF;
      IF r.availability_pct IS NOT NULL THEN
        v_avail_total := v_avail_total + r.availability_pct * v_minutes;
        v_avail_weight := v_avail_weight + v_minutes;
      END IF;
      IF v_oee IS NOT NULL THEN
        v_oee_total := v_oee_total + v_oee * v_minutes;
        v_oee_weight := v_oee_weight + v_minutes;
      END IF;
    END IF;
  END LOOP;

  v_shift_perf := CASE WHEN v_perf_weight > 0 THEN v_perf_total / v_perf_weight ELSE NULL END;
  v_shift_avail := CASE WHEN v_avail_weight > 0 THEN v_avail_total / v_avail_weight ELSE NULL END;
  v_shift_oee := CASE WHEN v_oee_weight > 0 THEN v_oee_total / v_oee_weight ELSE NULL END;

  UPDATE public.import_item_rows
  SET performance = v_shift_perf,
      available_time = v_shift_avail,
      oee = v_shift_oee,
      raw_data = coalesce(raw_data, '{}'::jsonb) || jsonb_build_object(
        'performance', v_shift_perf,
        'available_time', v_shift_avail,
        'oee', v_shift_oee,
        'kpi_model_version', '2.0-AUTO-shift-time-v1'
      )
  WHERE import_item_id = p_import_item_id
    AND daily_record_id IS NULL;

  UPDATE public.import_items
  SET ocr_data = coalesce(ocr_data, '{}'::jsonb)
    || jsonb_build_object(
      'actual_shift_performance_pct', v_shift_perf,
      'actual_shift_availability_pct', v_shift_avail,
      'actual_shift_oee_pct', v_shift_oee,
      'productive_minutes', COALESCE(v_perf_weight, 0),
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
  IF NEW.status = 'VALIDATING' AND OLD.status IS DISTINCT FROM NEW.status THEN
    PERFORM public.recalculate_import_item_kpis(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_import_items_recalculate_kpis
AFTER UPDATE ON public.import_items
FOR EACH ROW
EXECUTE FUNCTION public.recalculate_import_item_kpis_on_validating();

GRANT EXECUTE ON FUNCTION public.recalculate_import_item_kpis(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.recalculate_import_item_kpis_on_validating() TO authenticated;

-- Remove the legacy 3-argument overload only after every canonical runtime
-- function has been rewritten to call the explicit 4-argument clock.
DROP FUNCTION IF EXISTS public.auto_shift_productive_minutes(text, integer, text);

COMMENT ON FUNCTION public.auto_shift_productive_minutes(text, integer, text, boolean)
IS '2.0 AUTO canonical shift clock: Ranní 06:00-14:00, Odpolední 14:00-22:00, Noční 22:00-06:00; setup 7m, break 30m, cleanup 5m; optional screenshot cutoff on last visible hour.';
