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

-- Add approval columns for approval workflow
ALTER TABLE public.product_relationships
  ADD COLUMN IF NOT EXISTS approval_status text NOT NULL DEFAULT 'approved';

ALTER TABLE public.product_relationships
  ADD COLUMN IF NOT EXISTS submitted_by uuid;

ALTER TABLE public.product_relationships
  ADD COLUMN IF NOT EXISTS approved_by uuid;

ALTER TABLE public.product_relationships
  ADD COLUMN IF NOT EXISTS approved_at timestamptz;

ALTER TABLE public.product_relationships
  ADD COLUMN IF NOT EXISTS rejection_reason text;

-- RLS Policies
DROP POLICY IF EXISTS "Authenticated users can read product relationships"
    ON public.product_relationships;

CREATE POLICY "Authenticated users can read product relationships"
    ON public.product_relationships
    FOR SELECT
    TO authenticated
    USING (true);

DROP POLICY IF EXISTS "Admins can insert product relationships"
    ON public.product_relationships;
DROP POLICY IF EXISTS "Authenticated users can insert product relationships"
    ON public.product_relationships;

CREATE POLICY "Authenticated users can insert product relationships"
    ON public.product_relationships
    FOR INSERT
    TO authenticated
    WITH CHECK (true);

DROP POLICY IF EXISTS "Admins can update product relationships"
    ON public.product_relationships;
DROP POLICY IF EXISTS "Authenticated users can update product relationships"
    ON public.product_relationships;

CREATE POLICY "Authenticated users can update product relationships"
    ON public.product_relationships
    FOR UPDATE
    TO authenticated
    USING (true)
    WITH CHECK (true);

DROP POLICY IF EXISTS "Admins can delete product relationships"
    ON public.product_relationships;
DROP POLICY IF EXISTS "Authenticated users can delete product relationships"
    ON public.product_relationships;

CREATE POLICY "Authenticated users can delete product relationships"
    ON public.product_relationships
    FOR DELETE
    TO authenticated
    USING (true);

-- Approval audit trigger
DROP TRIGGER IF EXISTS approval_audit_product_relationships ON public.product_relationships;

CREATE OR REPLACE FUNCTION public.log_product_relationships_approval()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.approval_status IS DISTINCT FROM OLD.approval_status
     AND NEW.approval_status IN ('approved', 'rejected') THEN
    INSERT INTO public.approval_audit_log (
      table_name,
      record_id,
      old_status,
      new_status,
      reason,
      changed_by,
      changed_at
    )
    VALUES (
      'product_relationships',
      NEW.id,
      OLD.approval_status,
      NEW.approval_status,
      CASE
        WHEN NEW.approval_status = 'rejected' THEN NEW.rejection_reason
        ELSE NULL
      END,
      COALESCE(NEW.approved_by, auth.uid()),
      COALESCE(NEW.approved_at, now())
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER approval_audit_product_relationships
AFTER UPDATE OF approval_status ON public.product_relationships
FOR EACH ROW EXECUTE FUNCTION public.log_product_relationships_approval();

COMMIT;
