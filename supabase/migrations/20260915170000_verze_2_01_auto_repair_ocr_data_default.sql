-- Verze 2.01 AUTO: repair import_items.ocr_data persistence.
-- Some existing databases were created before the NOT NULL/default definition
-- was applied. The import must always be able to create its staging row before
-- OCR has completed, so an empty JSON object is the safe initial value.

UPDATE public.import_items
SET ocr_data = '{}'::jsonb
WHERE ocr_data IS NULL;

ALTER TABLE public.import_items
  ALTER COLUMN ocr_data SET DEFAULT '{}'::jsonb;

ALTER TABLE public.import_items
  ALTER COLUMN ocr_data SET NOT NULL;
