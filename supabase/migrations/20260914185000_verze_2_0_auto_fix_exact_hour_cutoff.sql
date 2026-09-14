-- Verze 2.0 AUTO
-- Fix: exact HH:00 screenshot timestamp means zero elapsed time in the current hour.
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
    v_minutes numeric;
    v_cutoff integer;
    v_elapsed numeric;
BEGIN
    CASE v_shift
        WHEN 'ranni' THEN
            v_shift_start := 6 * 60;
            v_shift_end := 14 * 60;
            v_break_start := 10 * 60 + 40;
            v_break_end := 11 * 60 + 10;
        WHEN 'odpoledni' THEN
            v_shift_start := 14 * 60;
            v_shift_end := 22 * 60;
            v_break_start := 18 * 60;
            v_break_end := 18 * 60 + 30;
        WHEN 'nocni' THEN
            v_shift_start := 22 * 60;
            v_shift_end := 30 * 60;
            v_break_start := 26 * 60;
            v_break_end := 26 * 60 + 30;
        ELSE
            RETURN 0;
    END CASE;

    -- Normalize night-shift hours 00:00-05:59 to the following shift-day.
    IF v_shift = 'nocni' AND p_hour < 22 THEN
        v_hour_start := p_hour * 60 + 24 * 60;
    ELSE
        v_hour_start := p_hour * 60;
    END IF;
    v_hour_end := v_hour_start + 60;

    IF v_hour_start < v_shift_start OR v_hour_start >= v_shift_end THEN
        RETURN 0;
    END IF;

    -- Base productive minutes in the hour, including exact shift boundaries.
    v_minutes := LEAST(v_hour_end, v_shift_end) - GREATEST(v_hour_start, v_shift_start);

    -- Subtract overlap with the scheduled 30-minute break.
    v_minutes := v_minutes - GREATEST(
        0,
        LEAST(v_hour_end, v_break_end) - GREATEST(v_hour_start, v_break_start)
    );

    -- 7 minutes setup at shift start and 5 minutes cleanup at shift end.
    IF v_hour_start = v_shift_start THEN
        v_minutes := v_minutes - 7;
    END IF;
    IF v_hour_end = v_shift_end THEN
        v_minutes := v_minutes - 5;
    END IF;

    v_minutes := GREATEST(0, v_minutes);

    -- Only the current/last screenshot hour is clipped to the screenshot timestamp.
    -- Exact HH:00 therefore means zero elapsed productive minutes in that hour.
    IF p_is_last_hour AND p_screenshot_time IS NOT NULL THEN
        IF trim(p_screenshot_time) ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN
            v_cutoff := split_part(trim(p_screenshot_time), ':', 1)::integer * 60
                     + split_part(trim(p_screenshot_time), ':', 2)::integer;

            IF v_shift = 'nocni' AND v_cutoff < 22 * 60 THEN
                v_cutoff := v_cutoff + 24 * 60;
            END IF;

            -- If screenshot is exactly at the hour boundary, elapsed = 0.
            v_elapsed := GREATEST(0, LEAST(60, v_cutoff - v_hour_start));
            v_minutes := LEAST(v_minutes, v_elapsed);

            -- Remove break time that falls inside the elapsed interval.
            v_minutes := v_minutes - GREATEST(
                0,
                LEAST(v_hour_start + v_elapsed, v_break_end)
                - GREATEST(v_hour_start, v_break_start)
            );
            v_minutes := GREATEST(0, v_minutes);

            -- Setup/cleanup are already included in the base hour; clip them
            -- proportionally by the elapsed interval where applicable.
            IF v_hour_start = v_shift_start THEN
                v_minutes := GREATEST(0, v_minutes - LEAST(7, v_elapsed));
            END IF;
            IF v_hour_end = v_shift_end AND v_elapsed > 55 THEN
                v_minutes := GREATEST(0, v_minutes - LEAST(5, v_elapsed - 55));
            END IF;
        END IF;
    END IF;

    RETURN GREATEST(0, v_minutes);
END;
$$;

COMMENT ON FUNCTION public.auto_shift_productive_minutes(text, integer, text, boolean)
IS 'Verze 2.0 AUTO canonical productive-minute calculation; exact HH:00 screenshot cutoff is 0 minutes.';
