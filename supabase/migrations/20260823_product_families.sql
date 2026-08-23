BEGIN;

CREATE TABLE IF NOT EXISTS public.product_families (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  h_product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  t_product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_families_h_t_different CHECK (
    h_product_id IS NULL OR t_product_id IS NULL OR h_product_id <> t_product_id
  )
);

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS family_id uuid REFERENCES public.product_families(id) ON DELETE SET NULL;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS variant_type text;

ALTER TABLE public.products
  DROP CONSTRAINT IF EXISTS products_variant_type_check;

ALTER TABLE public.products
  ADD CONSTRAINT products_variant_type_check
  CHECK (variant_type IS NULL OR variant_type IN ('H','T'));

CREATE UNIQUE INDEX IF NOT EXISTS ux_product_families_h_product
  ON public.product_families(h_product_id)
  WHERE h_product_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_product_families_t_product
  ON public.product_families(t_product_id)
  WHERE t_product_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_products_family_id
  ON public.products(family_id);

CREATE INDEX IF NOT EXISTS idx_products_variant_type
  ON public.products(variant_type);

ALTER TABLE public.product_families ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read product families" ON public.product_families;
CREATE POLICY "Authenticated users can read product families"
ON public.product_families FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Admins can insert product families" ON public.product_families;
DROP POLICY IF EXISTS "Authenticated users can insert product families" ON public.product_families;
CREATE POLICY "Authenticated users can insert product families"
ON public.product_families FOR INSERT TO authenticated
WITH CHECK (true);

DROP POLICY IF EXISTS "Admins can update product families" ON public.product_families;
DROP POLICY IF EXISTS "Authenticated users can update product families" ON public.product_families;
CREATE POLICY "Authenticated users can update product families"
ON public.product_families FOR UPDATE TO authenticated
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "Admins can delete product families" ON public.product_families;
DROP POLICY IF EXISTS "Authenticated users can delete product families" ON public.product_families;
CREATE POLICY "Authenticated users can delete product families"
ON public.product_families FOR DELETE TO authenticated
USING (true);

COMMIT;
