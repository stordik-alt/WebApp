-- Verze 2.0 AUTO: přesné hranice směn.
-- Směny na sebe navazují bez mezery:
-- Ranní    06:00–14:00
-- Odpolední 14:00–22:00
-- Noční    22:00–06:00 (následující den)
--
-- Přestávky jsou samostatné a nemění hranice směn.
-- Příprava linky 7 min je na začátku každé směny,
-- úklid 5 min je na jejím konci.

CREATE OR REPLACE FUNCTION public.auto_shift_productive_minutes(
  p_shift text,
  p_hour integer,
  p_screenshot_time text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_shift text := lower(trim(coalesce(p_shift, '')));
  v_hour integer := ((coalesce(p_hour, 0) % 24) + 24) % 24;
  v_shift_start integer;
  v_rel_start integer;
  v_rel_end integer;
  v_cutoff integer := NULL;
  v_work_start constant integer := 7;
  v_work_end constant integer := 475; -- 480 - 5 min úklid
  v_pause_start integer;
  v_pause_end integer;
  v_productive integer;
  v_h integer;
  v_m integer;
BEGIN
  -- Směna je určena explicitně. Při chybějícím názvu ji určíme podle hodiny.
  IF v_shift LIKE 'ra%' OR v_shift IN ('r', '1') THEN
    v_shift_start := 360; -- 06:00
    v_pause_start := 280; -- 10:40, relativně k 06:00
    v_pause_end := 310;   -- 11:10
  ELSIF v_shift LIKE 'od%' OR v_shift IN ('o', '2') THEN
    v_shift_start := 840; -- 14:00
    v_pause_start := 240; -- 18:00
    v_pause_end := 270;   -- 18:30
  ELSIF v_shift LIKE 'no%' OR v_shift IN ('n', '3') THEN
    v_shift_start := 1320; -- 22:00
    v_pause_start := 240;  -- 02:00
    v_pause_end := 270;    -- 02:30
  ELSE
    IF v_hour >= 6 AND v_hour < 14 THEN
      v_shift_start := 360;
      v_pause_start := 280;
      v_pause_end := 310;
    ELSIF v_hour >= 14 AND v_hour < 22 THEN
      v_shift_start := 840;
      v_pause_start := 240;
      v_pause_end := 270;
    ELSE
      v_shift_start := 1320;
      v_pause_start := 240;
      v_pause_end := 270;
    END IF;
  END IF;

  -- Relativní minuta v rámci směny. U noční směny 00:00–06:00
  -- správně pokračuje po půlnoci.
  v_rel_start := ((v_hour * 60 - v_shift_start) + 1440) % 1440;
  v_rel_end := v_rel_start + 60;

  IF p_screenshot_time IS NOT NULL AND p_screenshot_time ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$' THEN
    v_h := split_part(p_screenshot_time, ':', 1)::integer;
    v_m := split_part(p_screenshot_time, ':', 2)::integer;
    v_cutoff := ((v_h * 60 + v_m - v_shift_start) + 1440) % 1440;
    IF v_cutoff < v_rel_start THEN
      RETURN 0;
    END IF;
    IF v_cutoff < v_rel_end THEN
      v_rel_end := v_cutoff;
    END IF;
  END IF;

  -- 7 min příprava + 30 min přestávka + 5 min úklid.
  v_productive := GREATEST(
    0,
    LEAST(v_rel_end, v_work_end) - GREATEST(v_rel_start, v_work_start)
  );
  v_productive := v_productive - GREATEST(
    0,
    LEAST(v_rel_end, v_pause_end) - GREATEST(v_rel_start, v_pause_start)
  );

  RETURN GREATEST(0, LEAST(60, v_productive));
END;
$$;

COMMENT ON FUNCTION public.auto_shift_productive_minutes(text, integer, text)
IS 'Verze 2.0 AUTO: přesné navazující směny Ranní 06:00-14:00, Odpolední 14:00-22:00, Noční 22:00-06:00; 7 min příprava, směnová 30 min přestávka, 5 min úklid.';
