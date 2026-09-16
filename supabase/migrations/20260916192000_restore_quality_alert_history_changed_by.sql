-- quality_alert_history originally had changed_by/changed_by_email (20260817142152) but they
-- are missing from the live database, so QualityAlertDialog's insert into this table always
-- fails with "column does not exist" whenever a quality alert is resolved.
alter table public.quality_alert_history
  add column if not exists changed_by uuid,
  add column if not exists changed_by_email text;
