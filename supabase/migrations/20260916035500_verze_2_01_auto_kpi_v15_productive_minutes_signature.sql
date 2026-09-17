-- Verze 2.01 AUTO V15
-- Compatibility fix for V14: the canonical productive-minute helper uses
-- (text, integer, text, boolean). Keep V14 KPI logic unchanged and adapt
-- the call to the existing 4-argument signature.
-- Scope: Verze-2.01-Auto only. main is intentionally untouched.

CREATE OR REPLACE FUNCTION public.recalculate_import_item_kpis(p_import_item_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_shift text;
    v_screenshot_time text;
    v_previous_hour integer;
    v_previous_product text;
    v_previous_role text;
    v_previous_minutes numeric := 0;
    v_previous_same_hour boolean := false;
    v_previous_multi boolean := false;
    v_previous_actual_minutes numeric := 0;
    v_total_minutes numeric := 0;
    v_total_expected numeric := 0;
    v_total_actual numeric := 0;
    v_total_available numeric := 0;
    v_total_downtime numeric := 0;
    v_total_availability numeric := 0;
    v_total_oee numeric := 0;
    r record;
    v_product_code text;
    v_role text;
    v_norm numeric;
    v_capacity numeric;
    v_operator_count numeric;
    v_staffing numeric;
    v_scheduled_minutes numeric;
    v_effective_minutes numeric;
    v_downtime numeric;
    v_availability numeric;
    v_performance numeric;
    v_oee numeric;
    v_mode text;
    v_product_changed boolean;
    v_product_finished boolean;
    v_same_hour boolean;
    v_next_same_role boolean;
    v_next_product text;
    v_next_hour integer;
    v_multi_product_hour boolean;
    v_downtime_relevant boolean;
    v_first_productive_row boolean := true;
    v_ocr_norm numeric;
    v_changeover_downtime numeric;
    v_remaining_minutes numeric;
    v_is_last_hour boolean;
    v_operator_ids uuid[];
    v_expected numeric;
BEGIN
    SELECT ii.shift, ii.screenshot_time
      INTO v_shift, v_screenshot_time
      FROM public.import_items ii
     WHERE ii.id = p_import_item_id;

    SELECT array_agg(e.employee_id)
      INTO v_operator_ids
      FROM public.import_item_rows e
     WHERE e.import_item_id = p_import_item_id
       AND e.employee_id IS NOT NULL;

    FOR r IN
        SELECT h.*,
               lead(h.hour) OVER (ORDER BY h.hour, h.product_code) AS next_hour,
               lead(h.product_code) OVER (ORDER BY h.hour, h.product_code) AS next_product
          FROM public.import_item_hourly h
         WHERE h.import_item_id = p_import_item_id
           AND NOT (coalesce(h.actual_output,0)=0 AND h.product_code IS NULL)
         ORDER BY h.hour, h.product_code
    LOOP
        v_product_code := nullif(trim(r.product_code), '');
        v_role := coalesce(nullif(trim(r.position_type), ''), 'HA');
        v_norm := coalesce(r.product_profile_norm, r.norm_per_hour, r.ocr_norm, 0);
        v_capacity := coalesce(r.capacity, 0);
        v_operator_count := coalesce(r.operator_count, 0);
        v_staffing := CASE WHEN v_capacity > 0 THEN v_operator_count / v_capacity ELSE 1 END;

        v_same_hour := v_previous_hour IS NOT NULL AND v_previous_hour = r.hour;
        v_product_changed := v_same_hour
          AND coalesce(v_previous_role,'') = coalesce(v_role,'')
          AND coalesce(v_previous_product,'') <> coalesce(v_product_code,'');
        v_next_same_role := r.next_hour = r.hour;
        v_product_finished := v_next_same_role
          AND coalesce(v_next_product,'') <> coalesce(v_product_code,'');
        v_multi_product_hour := v_product_changed OR v_product_finished;
        v_is_last_hour := r.next_hour IS NULL;

        -- V15 fix: call the existing canonical 4-argument helper.
        v_scheduled_minutes := public.auto_shift_productive_minutes(
            v_shift,
            r.hour,
            v_screenshot_time,
            v_is_last_hour
        );

        v_ocr_norm := coalesce(r.ocr_norm, 0);
        v_downtime := coalesce(r.downtime_minutes, 0);
        v_downtime_relevant := coalesce(r.downtime_relevant, false);

        IF v_product_finished THEN
            v_downtime_relevant := false;
        END IF;

        IF v_multi_product_hour AND NOT v_product_changed THEN
            v_effective_minutes := CASE
                WHEN v_norm > 0 THEN (v_ocr_norm / v_norm) * v_scheduled_minutes
                ELSE 0
            END;
            v_effective_minutes := LEAST(v_effective_minutes, v_scheduled_minutes);
            v_mode := 'TEFF';
        ELSIF v_multi_product_hour AND v_product_changed THEN
            v_changeover_downtime := CASE WHEN v_downtime_relevant THEN v_downtime ELSE 0 END;
            v_remaining_minutes := GREATEST(
                0,
                v_scheduled_minutes
                - coalesce(v_previous_actual_minutes,0)
                - v_changeover_downtime
            );
            v_effective_minutes := LEAST(v_remaining_minutes, v_scheduled_minutes);
            v_mode := 'TEFF';
        ELSIF v_downtime_relevant AND v_downtime > 0 THEN
            v_effective_minutes := GREATEST(0, v_scheduled_minutes - v_downtime);
            v_mode := 'TEFF';
        ELSE
            v_effective_minutes := v_scheduled_minutes;
            v_mode := 'CLASSIC_AVAILABILITY';
        END IF;

        v_availability := CASE
            WHEN v_mode = 'TEFF' THEN 100
            ELSE coalesce(r.availability_pct, 100)
        END;

        v_expected := CASE
            WHEN v_norm > 0 THEN v_norm * (v_effective_minutes / 60.0) * v_staffing
            ELSE 0
        END;
        v_performance := CASE
            WHEN v_expected > 0 THEN coalesce(r.actual_output,0) / v_expected * 100
            ELSE NULL
        END;
        v_oee := CASE
            WHEN v_performance IS NULL THEN NULL
            WHEN v_mode = 'TEFF' THEN v_performance
            ELSE v_performance * v_availability / 100.0
        END;

        UPDATE public.import_item_hourly
           SET actual_minutes = v_effective_minutes,
               performance_pct = v_performance,
               actual_oee_pct = v_oee,
               calculation_mode = v_mode,
               effective_time_minutes = CASE WHEN v_mode='TEFF' THEN v_effective_minutes ELSE NULL END,
               productive_minutes = v_scheduled_minutes,
               staffing_ratio = v_staffing,
               model_version = '2.01-AUTO-staffing-kpi-v15',
               downtime_relevant = v_downtime_relevant,
               first_productive_row = v_first_productive_row,
               product_changed = v_product_changed
         WHERE id = r.id;

        IF v_performance IS NOT NULL THEN
            v_total_actual := v_total_actual + coalesce(r.actual_output,0);
            v_total_expected := v_total_expected + v_expected;
            v_total_minutes := v_total_minutes + v_effective_minutes;
            v_total_available := v_total_available + (v_effective_minutes * v_availability / 100.0);
            v_total_downtime := v_total_downtime + CASE WHEN v_downtime_relevant THEN v_downtime ELSE 0 END;
        END IF;

        v_first_productive_row := false;
        v_previous_hour := r.hour;
        v_previous_product := v_product_code;
        v_previous_role := v_role;
        v_previous_actual_minutes := v_effective_minutes;
    END LOOP;

    -- Preserve the existing shift KPI update path where available.
    UPDATE public.import_items
       SET updated_at = now()
     WHERE id = p_import_item_id;
END;
$$;

COMMENT ON FUNCTION public.recalculate_import_item_kpis(uuid)
IS 'Verze 2.01 AUTO V15: KPI recalc using canonical 4-argument productive-minute helper; fixed breaks and TEFF chain.';
