-- Verze 2.0 AUTO
-- Repair profiles that were previously valid for imported records but were closed
-- without an active replacement for the same HA/TUP code.
-- This restores the Product Profile used by the import pipeline without changing
-- profiles that already have an active successor.

UPDATE public.product_profiles pp
SET valid_to = NULL
WHERE pp.valid_to IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM public.import_items i
    WHERE i.product_profile_status = 'VALID'
      AND i.product_code IS NOT NULL
      AND (
        lower(regexp_replace(coalesce(pp.ha_subassy, ''), '\\s+', '', 'g')) = lower(regexp_replace(i.product_code, '\\s+', '', 'g'))
        OR lower(regexp_replace(coalesce(pp.tup_subassy, ''), '\\s+', '', 'g')) = lower(regexp_replace(i.product_code, '\\s+', '', 'g'))
      )
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.product_profiles active
    WHERE active.valid_to IS NULL
      AND active.id <> pp.id
      AND (
        lower(regexp_replace(coalesce(active.ha_subassy, ''), '\\s+', '', 'g')) = lower(regexp_replace(coalesce(pp.ha_subassy, ''), '\\s+', '', 'g'))
        OR lower(regexp_replace(coalesce(active.tup_subassy, ''), '\\s+', '', 'g')) = lower(regexp_replace(coalesce(pp.tup_subassy, ''), '\\s+', '', 'g'))
        OR lower(regexp_replace(coalesce(active.ha_subassy, ''), '\\s+', '', 'g')) = lower(regexp_replace(coalesce(pp.tup_subassy, ''), '\\s+', '', 'g'))
        OR lower(regexp_replace(coalesce(active.tup_subassy, ''), '\\s+', '', 'g')) = lower(regexp_replace(coalesce(pp.ha_subassy, ''), '\\s+', '', 'g'))
      )
  );
