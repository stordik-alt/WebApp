-- Product relationships: explicit HA -> TUP mapping.
-- Products keep their own IDs/names; the relationship is never inferred from product code.

BEGIN;

CREATE TABLE IF NOT EXISTS public.product_relationships (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    source_product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    target_product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    relationship_type text NOT NULL DEFAULT 'HA_TO_TUP',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT product_relationships_not_self CHECK (source_product_id <> target_product_id),
    CONSTRAINT product_relationships_type_check CHECK (relationship_type = 'HA_TO_TUP'),
    CONSTRAINT product_relationships_unique UNIQUE (source_product_id, target_product_id, relationship_type)
);

CREATE INDEX IF NOT EXISTS idx_product_relationships_source
    ON public.product_relationships(source_product_id);

CREATE INDEX IF NOT EXISTS idx_product_relationships_target
    ON public.product_relationships(target_product_id);

ALTER TABLE public.product_relationships ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read product relationships"
    ON public.product_relationships;

CREATE POLICY "Authenticated users can read product relationships"
    ON public.product_relationships
    FOR SELECT
    TO authenticated
    USING (true);

DROP POLICY IF EXISTS "Admins can insert product relationships"
    ON public.product_relationships;

CREATE POLICY "Admins can insert product relationships"
    ON public.product_relationships
    FOR INSERT
    TO authenticated
    WITH CHECK (has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins can update product relationships"
    ON public.product_relationships;

CREATE POLICY "Admins can update product relationships"
    ON public.product_relationships
    FOR UPDATE
    TO authenticated
    USING (has_role(auth.uid(), 'admin'))
    WITH CHECK (has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins can delete product relationships"
    ON public.product_relationships;

CREATE POLICY "Admins can delete product relationships"
    ON public.product_relationships
    FOR DELETE
    TO authenticated
    USING (has_role(auth.uid(), 'admin'));

COMMIT;
