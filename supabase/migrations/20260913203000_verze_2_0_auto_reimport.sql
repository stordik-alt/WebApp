-- Verze 2.0 AUTO
-- Umožní znovu importovat stejný screenshot po zamítnutí nebo technické chybě.
-- Historie importu zůstává zachována; source_hash už není globálně UNIQUE.

DO $$
DECLARE
  v_constraint text;
BEGIN
  SELECT c.conname
    INTO v_constraint
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  WHERE n.nspname = 'public'
    AND t.relname = 'import_items'
    AND c.contype = 'u'
    AND pg_get_constraintdef(c.oid) ILIKE '%(source_hash)%'
  LIMIT 1;

  IF v_constraint IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.import_items DROP CONSTRAINT %I', v_constraint);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS import_items_source_hash_idx
  ON public.import_items(source_hash);

COMMENT ON INDEX public.import_items_source_hash_idx IS
  'Hash pro detekci opakovaného importu; více historických pokusů stejného screenshotu je povoleno.';
