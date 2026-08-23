-- Fix RLS politik pro product_families tabulku
-- Povolí všem autentizovaným uživatelům INSERT, UPDATE a DELETE
-- Dříve to bylo omezeno jen na uživatele s rolí 'admin'

BEGIN;

-- Odstranit staré politiky
DROP POLICY IF EXISTS "Admins can insert product families" ON public.product_families;
DROP POLICY IF EXISTS "Authenticated users can insert product families" ON public.product_families;
DROP POLICY IF EXISTS "Admins can update product families" ON public.product_families;
DROP POLICY IF EXISTS "Authenticated users can update product families" ON public.product_families;
DROP POLICY IF EXISTS "Admins can delete product families" ON public.product_families;
DROP POLICY IF EXISTS "Authenticated users can delete product families" ON public.product_families;

-- Nové politiky pro všechny authenticated uživatele
CREATE POLICY "Authenticated users can insert product families"
ON public.product_families FOR INSERT TO authenticated
WITH CHECK (true);

CREATE POLICY "Authenticated users can update product families"
ON public.product_families FOR UPDATE TO authenticated
USING (true)
WITH CHECK (true);

CREATE POLICY "Authenticated users can delete product families"
ON public.product_families FOR DELETE TO authenticated
USING (true);

COMMIT;
