-- Přidat isTemporary do employees
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS is_temporary boolean NOT NULL DEFAULT false;

-- Vytvořit view pro denní data s výpomocí (coworkers)
CREATE OR REPLACE VIEW public.daily_records_with_help AS
SELECT 
  dr.*,
  json_agg(
    json_build_object(
      'id', c.id,
      'full_name', c.full_name,
      'is_temporary', c.is_temporary
    )
  ) FILTER (WHERE c.id IS NOT NULL) AS coworkers
FROM daily_records dr
LEFT JOIN daily_record_coworkers dc ON dr.id = dc.record_id
LEFT JOIN employees c ON dc.coworker_id = c.id
GROUP BY dr.id;

-- Přidat index pro efektivní hledání po datumu a směně
CREATE INDEX IF NOT EXISTS daily_records_date_shift_idx ON public.daily_records (work_date, shift, line);
