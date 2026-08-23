-- Fix RLS politik pro product_families tabulku - verze 2
-- Úplné přepsání politik s kontrolou RLS stavu

BEGIN;

-- Zkontrolovat a vypnout RLS pokud je zapnutý
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_tables
    WHERE tablename = 'product_families'
    AND schemaname = 'public'
    AND relrowsecurity
  ) THEN
    ALTER TABLE public.product_families DISABLE ROW LEVEL SECURITY;
  END IF;
END $$;

-- Odstranit VŠECNY existující politiky
DROP POLICY IF EXISTS "Authenticated users can read product families" ON public.product_families;
DROP POLICY IF EXISTS "Admins can insert product families" ON public.product_families;
DROP POLICY IF EXISTS "Authenticated users can insert product families" ON public.product_families;
DROP POLICY IF EXISTS "Admins can update product families" ON public.product_families;
DROP POLICY IF EXISTS "Authenticated users can update product families" ON public.product_families;
DROP POLICY IF EXISTS "Admins can delete product families" ON public.product_families;
DROP POLICY IF EXISTS "Authenticated users can delete product families" ON public.product_families;

-- Zapnout RLS znovu
ALTER TABLE public.product_families ENABLE ROW LEVEL SECURITY;

-- Vytvořit NOVÉ politiky - vše pro authenticated uživatele
CREATE POLICY "All authenticated can read product families"
ON public.product_families FOR SELECT TO authenticated USING (true);

CREATE POLICY "All authenticated can insert product families"
ON public.product_families FOR INSERT TO authenticated
WITH CHECK (true);

CREATE POLICY "All authenticated can update product families"
ON public.product_families FOR UPDATE TO authenticated
USING (true)
WITH CHECK (true);

CREATE POLICY "All authenticated can delete product families"
ON public.product_families FOR DELETE TO authenticated
USING (true);

COMMIT;
