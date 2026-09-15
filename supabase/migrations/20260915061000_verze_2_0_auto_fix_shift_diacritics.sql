-- Verze 2.0 AUTO
-- Fix: shift names are stored with Czech diacritics (Ranní/Odpolední/Noční),
-- while the canonical productive-minute function compared them to ASCII names.
-- This caused every productive-minute calculation to return 0.
-- Scope: only the canonical 4-argument function.

DROP FUNCTION IF EXISTS public.auto_shift_productive_minutes(text, integer, text, boolean);

CREATE FUNCTION public.auto_shift_productive_minutes(
    p_shift text,
    p_hour integer,
    p_screenshot_time text,
    p_is_last_hour boolean
)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    v_shift text := lower(trim(p_shift));
    v_shift_start integer;
    v_shift_end integer;
    v_break_start integer;
    v_break_end integer;
    v_hour_start integer;
    v_hour_end integer;
    v_effective_end integer;
    v_elapsed numeric;
    v_minutes numeric;
    v_cutoff integer;
    v_break_overlap numeric;
    v_setup_overlap numeric;
    v_cleanup_overlap numeric;
BEGIN
    -- Accept both the canonical Czech names and their ASCII variants.
    CASE v_shift
        WHEN 'ranní', 'ranni' THEN
            v_shift_start := 6 * 60;
            v_shift_end := 14 * 60;
            v_break_start := 10 * 60 + 40;
            v_break_end := 11 * 60 + 10;
        WHEN 'odpolední', 'odpoledni' THEN
            v_shift_start := 14 * 60;
            v_shift_end := 22 * 60;
            v_break_start := 18 * 60;
            v_break_end := 18 * 60 + 30;
        WHEN 'noční', 'nocni' THEN
            v_shift_start := 22 * 60;
            v_shift_end := 30 * 60;
            v_break_start := 26 * 60;
            v_break_end := 26 * 60 + 30;
        ELSE
            RETURN 0;
    END CASE;

    IF v_shift IN ('noční', 'nocni') AND p_hour < 22 THEN
        v_hour_start := p_hour * 60 + 24 * 60;
    ELSE
        v_hour_start := p_hour * 60;
    END IF;
    v_hour_end := v_hour_start + 60;

    IF v_hour_start < v_shift_start OR v_hour_start >= v_shift_end THEN
        RETURN 0;
    END IF;

    v_effective_end := LEAST(v_hour_end, v_shift_end);

    IF p_is_last_hour AND p_screenshot_time IS NOT NULL THEN
        IF trim(p_screenshot_time) ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN
            v_cutoff := split_part(trim(p_screenshot_time), ':', 1)::integer * 60
                     + split_part(trim(p_screenshot_time), ':', 2)::integer;

            IF v_shift IN ('noční', 'nocni') AND v_cutoff < 22 * 60 THEN
                v_cutoff := v_cutoff + 24 * 60;
            END IF;

            v_effective_end := LEAST(v_effective_end, v_cutoff);
        END IF;
    END IF;

    v_elapsed := GREATEST(0, v_effective_end - v_hour_start);
    IF v_elapsed <= 0 THEN
        RETURN 0;
    END IF;

    v_minutes := v_elapsed;

    v_break_overlap := GREATEST(
        0,
        LEAST(v_effective_end, v_break_end)
        - GREATEST(v_hour_start, v_break_start)
    );
    v_minutes := v_minutes - v_break_overlap;

    v_setup_overlap := GREATEST(
        0,
        LEAST(v_effective_end, v_shift_start + 7)
        - GREATEST(v_hour_start, v_shift_start)
    );
    v_minutes := v_minutes - v_setup_overlap;

    v_cleanup_overlap := GREATEST(
        0,
        LEAST(v_effective_end, v_shift_end)
        - GREATEST(v_hour_start, v_shift_end - 5)
    );
    v_minutes := v_minutes - v_cleanup_overlap;

    RETURN GREATEST(0, v_minutes);
END;
$$;

COMMENT ON FUNCTION public.auto_shift_productive_minutes(text, integer, text, boolean)
IS 'Verze 2.0 AUTO canonical productive-minute calculation; accepts Czech shift names with diacritics and ASCII variants.';
