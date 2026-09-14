-- Verze 2.0 AUTO
-- Fix: productive-minute clipping must use interval intersections only.
-- Exact HH:00 = 0 minutes; breaks/setup/cleanup must never be subtracted twice.
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

    -- By default the complete hour is considered. For the last screenshot hour,
    -- clip the interval to the actual screenshot timestamp.
    v_effective_end := LEAST(v_hour_end, v_shift_end);

    IF p_is_last_hour AND p_screenshot_time IS NOT NULL THEN
        IF trim(p_screenshot_time) ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN
            v_cutoff := split_part(trim(p_screenshot_time), ':', 1)::integer * 60
                     + split_part(trim(p_screenshot_time), ':', 2)::integer;

            IF v_shift = 'nocni' AND v_cutoff < 22 * 60 THEN
                v_cutoff := v_cutoff + 24 * 60;
            END IF;

            v_effective_end := LEAST(v_effective_end, v_cutoff);
        END IF;
    END IF;

    -- Exact HH:00 (and any earlier timestamp) means zero elapsed time.
    v_elapsed := GREATEST(0, v_effective_end - v_hour_start);
    IF v_elapsed <= 0 THEN
        RETURN 0;
    END IF;

    -- Start with the actual elapsed interval and subtract only the portions
    -- that intersect scheduled non-productive intervals. This prevents double
    -- subtraction when a screenshot clips an hour containing a break/setup/cleanup.
    v_minutes := v_elapsed;

    -- Scheduled break overlap.
    v_break_overlap := GREATEST(
        0,
        LEAST(v_effective_end, v_break_end)
        - GREATEST(v_hour_start, v_break_start)
    );
    v_minutes := v_minutes - v_break_overlap;

    -- 7-minute setup at shift start.
    v_setup_overlap := GREATEST(
        0,
        LEAST(v_effective_end, v_shift_start + 7)
        - GREATEST(v_hour_start, v_shift_start)
    );
    v_minutes := v_minutes - v_setup_overlap;

    -- 5-minute cleanup at shift end.
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
IS 'Verze 2.0 AUTO canonical productive-minute calculation using interval intersections; exact HH:00 screenshot cutoff is 0 minutes.';
