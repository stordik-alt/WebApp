CREATE TABLE public.norm_remeasurements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  product_code text NOT NULL,
  trigger_key text NOT NULL UNIQUE,
  shifts jsonb NOT NULL DEFAULT '[]'::jsonb,
  avg_oee numeric,
  current_norm_ha numeric,
  current_norm_tup numeric,
  status text NOT NULL DEFAULT 'pending',
  decided_at timestamptz,
  decided_by text,
  result_norm_ha numeric,
  result_norm_tup numeric,
  result_valid_from date,
  result_note text,
  confirmed_by text,
  result_applied_at timestamptz,
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT norm_remeasurements_status_check CHECK (status IN ('pending','accepted','rejected'))
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.norm_remeasurements TO authenticated;
GRANT ALL ON public.norm_remeasurements TO service_role;

ALTER TABLE public.norm_remeasurements ENABLE ROW LEVEL SECURITY;

CREATE POLICY norm_remeasurements_admin_all ON public.norm_remeasurements
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER norm_remeasurements_updated_at
  BEFORE UPDATE ON public.norm_remeasurements
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();