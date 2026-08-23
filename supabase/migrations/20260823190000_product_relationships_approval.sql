-- Add approval_status column to product_relationships table
-- For consistency with other tables (products, daily_records, etc.)

BEGIN;

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

-- Create approval audit trigger for product_relationships
-- (similar to other tables)
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
