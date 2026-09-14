-- Verze 2.0 AUTO
-- Fix: exact HH:00 screenshot timestamp means zero elapsed time in the current hour.
-- Scope: only the canonical 4-argument function.

CREATE OR REPLACE FUNCTION public.auto_shift_productive_minutes(
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
    v_start integer;
    v_end integer;
    v_break_start integer;
    v_break_end integer;
    v_minutes integer;
    v_cutoff integer;
    v_t text;
BEGIN
    -- Exact productive-minute boundaries for the three shifts.
    CASE lower(trim(p_shift))
        WHEN 'ranni' THEN
            v_start := 6;
            v_end := 14;
            v_break_start := 10 * 60 + 40;
            v_break_end := 11 * 60 + 10;
        WHEN 'odpoledni' THEN
            v_start := 14;
            v_end := 22;
            v_break_start := 18 * 60;
            v_break_end := 18 * 60 + 30;
        WHEN 'nocni' THEN
            v_start := 22;
            v_end := 30;
            v_break_start := 26 * 60;
            v_break_end := 26 * 60 + 30;
        ELSE
            RETURN 0;
    END CASE;

    IF p_hour < v_start OR p_hour >= v_end THEN
        RETURN 0;
    END IF;

    -- Base productive minutes in the hour, respecting breaks.
    v_start := p_hour * 60;
    v_end := v_start + 60;
    v_minutes := GREATEST(
        0,
        LEAST(v_end, CASE lower(trim(p_shift))
            WHEN 'ranni' THEN 14 * 60
            WHEN 'odpoledni' THEN 22 * 60
            WHEN 'nocni' THEN 30 * 60
        END) - GREATEST(v_start, CASE lower(trim(p_shift))
            WHEN 'ranni' THEN 6 * 60
            WHEN 'odpoledni' THEN 14 * 60
            WHEN 'nocni' THEN 22 * 60
        END)
    );

    -- Remove the break overlap.
    v_break_start := CASE lower(trim(p_shift))
        WHEN 'ranni' THEN 10 * 60 + 40
        WHEN 'odpoledni' THEN 18 * 60
        WHEN 'nocni' THEN 26 * 60
    END;
    v_break_end := v_break_start + 30;
    v_minutes := v_minutes - GREATEST(
        0,
        LEAST(p_hour * 60 + 60, v_break_end) - GREATEST(p_hour * 60, v_break_start)
    );

    -- 7 minutes setup at the beginning of the shift and 5 minutes cleanup at the end.
    IF p_hour = CASE lower(trim(p_shift))
        WHEN 'ranni' THEN 6
        WHEN 'odpoledni' THEN 14
        WHEN 'nocni' THEN 22
    END THEN
        v_minutes := GREATEST(0, v_minutes - 7);
    END IF;

    IF p_hour = CASE lower(trim(p_shift))
        WHEN 'ranni' THEN 13
        WHEN 'odpoledni' THEN 21
        WHEN 'nocni' THEN 29
    END THEN
        v_minutes := GREATEST(0, v_minutes - 5);
    END IF;

    -- Only the last/current hour is clipped to the screenshot time.
    -- HH:00 is deliberately 0 minutes, not a full previous hour.
    IF p_is_last_hour AND p_screenshot_time IS NOT NULL THEN
        v_t := trim(p_screenshot_time);
        IF v_t ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN
            v_cutoff := split_part(v_t, ':', 1)::integer * 60
                     + split_part(v_t, ':', 2)::integer;

            -- For night shift, 00:xx-05:xx belongs to the following shift-day.
            IF lower(trim(p_shift)) = 'nocni' AND v_cutoff < 22 * 60 THEN
                v_cutoff := v_cutoff + 24 * 60;
            END IF;

            v_minutes := LEAST(
                v_minutes,
                GREATEST(0, v_cutoff - p_hour * 60)
            );

            -- Re-apply break overlap to the clipped interval.
            v_minutes := GREATEST(
                0,
                v_minutes - GREATEST(
                    0,
                    LEAST(p_hour * 60 + LEAST(60, GREATEST(0, v_cutoff - p_hour * 60)), v_break_end)
                    - GREATEST(p_hour * 60, v_break_start)
                )
            );
        END IF;
    END IF;

    RETURN GREATEST(0, v_minutes);
END;
$$;

COMMENT ON FUNCTION public.auto_shift_productive_minutes(text, integer, text, boolean)
IS 'Verze 2.0 AUTO canonical productive-minute calculation; exact HH:00 screenshot cutoff is 0 minutes.';
