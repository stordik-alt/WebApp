-- Approval workflow extension: rejection reasons + immutable decision history.
-- Safe to run once; all changes are additive and preserve existing data.

-- Add decision metadata to all approval-enabled tables.
ALTER TABLE public.daily_records
  ADD COLUMN IF NOT EXISTS rejection_reason text;
ALTER TABLE public.shift_evaluations
  ADD COLUMN IF NOT EXISTS rejection_reason text;
ALTER TABLE public.weekly_records
  ADD COLUMN IF NOT EXISTS rejection_reason text;
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS rejection_reason text;
ALTER TABLE public.product_norms
  ADD COLUMN IF NOT EXISTS rejection_reason text;

-- Quality alert history participates in the approval queue in the current app.
ALTER TABLE public.quality_alert_history
  ADD COLUMN IF NOT EXISTS approval_status text NOT NULL DEFAULT 'approved';
ALTER TABLE public.quality_alert_history
  ADD COLUMN IF NOT EXISTS submitted_by uuid;
ALTER TABLE public.quality_alert_history
  ADD COLUMN IF NOT EXISTS approved_by uuid;
ALTER TABLE public.quality_alert_history
  ADD COLUMN IF NOT EXISTS approved_at timestamptz;
ALTER TABLE public.quality_alert_history
  ADD COLUMN IF NOT EXISTS rejection_reason text;

-- Central audit log for approval decisions.
CREATE TABLE IF NOT EXISTS public.approval_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name text NOT NULL,
  record_id uuid NOT NULL,
  old_status text,
  new_status text NOT NULL,
  reason text,
  changed_by uuid,
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS approval_audit_log_record_idx
  ON public.approval_audit_log (table_name, record_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS approval_audit_log_changed_at_idx
  ON public.approval_audit_log (changed_at DESC);

ALTER TABLE public.approval_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS approval_audit_log_admin_select ON public.approval_audit_log;
CREATE POLICY approval_audit_log_admin_select
  ON public.approval_audit_log
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

GRANT SELECT ON public.approval_audit_log TO authenticated;
GRANT ALL ON public.approval_audit_log TO service_role;

-- One trigger function records every transition into approved/rejected.
CREATE OR REPLACE FUNCTION public.log_approval_decision()
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
      TG_TABLE_NAME,
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

-- Attach the audit trigger only to tables that have approval_status.
DROP TRIGGER IF EXISTS approval_audit_daily_records ON public.daily_records;
CREATE TRIGGER approval_audit_daily_records
AFTER UPDATE OF approval_status ON public.daily_records
FOR EACH ROW EXECUTE FUNCTION public.log_approval_decision();

DROP TRIGGER IF EXISTS approval_audit_shift_evaluations ON public.shift_evaluations;
CREATE TRIGGER approval_audit_shift_evaluations
AFTER UPDATE OF approval_status ON public.shift_evaluations
FOR EACH ROW EXECUTE FUNCTION public.log_approval_decision();

DROP TRIGGER IF EXISTS approval_audit_weekly_records ON public.weekly_records;
CREATE TRIGGER approval_audit_weekly_records
AFTER UPDATE OF approval_status ON public.weekly_records
FOR EACH ROW EXECUTE FUNCTION public.log_approval_decision();

DROP TRIGGER IF EXISTS approval_audit_products ON public.products;
CREATE TRIGGER approval_audit_products
AFTER UPDATE OF approval_status ON public.products
FOR EACH ROW EXECUTE FUNCTION public.log_approval_decision();

DROP TRIGGER IF EXISTS approval_audit_product_norms ON public.product_norms;
CREATE TRIGGER approval_audit_product_norms
AFTER UPDATE OF approval_status ON public.product_norms
FOR EACH ROW EXECUTE FUNCTION public.log_approval_decision();

DROP TRIGGER IF EXISTS approval_audit_quality_alert_history ON public.quality_alert_history;
CREATE TRIGGER approval_audit_quality_alert_history
AFTER UPDATE OF approval_status ON public.quality_alert_history
FOR EACH ROW EXECUTE FUNCTION public.log_approval_decision();

NOTIFY pgrst, 'reload schema';
