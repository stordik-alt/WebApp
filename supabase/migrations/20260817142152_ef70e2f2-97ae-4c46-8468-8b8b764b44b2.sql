CREATE TABLE public.quality_alert_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  weekly_record_id uuid NOT NULL REFERENCES public.weekly_records(id) ON DELETE CASCADE,
  alert_cause text,
  alert_note text,
  operator_error boolean,
  final_quality_score numeric,
  alert_resolved boolean NOT NULL DEFAULT false,
  changed_by uuid,
  changed_by_email text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.quality_alert_history TO authenticated;
GRANT ALL ON public.quality_alert_history TO service_role;

ALTER TABLE public.quality_alert_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY quality_alert_history_admin_select ON public.quality_alert_history
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY quality_alert_history_admin_insert ON public.quality_alert_history
  FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX quality_alert_history_record_idx
  ON public.quality_alert_history (weekly_record_id, created_at DESC);