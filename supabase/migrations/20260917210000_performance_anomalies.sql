-- Feature idea #6: flag statistically implausible or unusually deviant
-- production records for manual review. Today's approval blockers only
-- check for MISSING data (a null field), never for a value that's PRESENT
-- but implausible - an OCR misread that turns "60" into "600" produces a
-- 1000% performance that sails straight through every existing check.
--
-- Two independent triggers, either one flags a record. Checked against
-- live data before finalizing the thresholds: OEE here is Výkon × Dostupnost
-- × (kapacita Product Profile / skutečný počet operátorů) - a staffing-ratio
-- multiplier that legitimately pushes OEE above 100% whenever fewer
-- operators are present than the profile's design capacity (confirmed live:
-- 11 of 40 real records, 27%, already sit above 100% OEE with none of them
-- looking like errors). A flat "OEE > 100 = anomaly" rule would have been
-- almost entirely false positives, so OEE has no fixed ceiling here - only
-- a floor (negative is never valid) and comparison against the employee's
-- own history.
--   1) Hard implausibility: performance far above what's realistically
--      achievable, a negative OEE, or an availability value outside its
--      valid 0-100 range (availability, unlike OEE, IS clamped to [0,100]
--      by reconstruct_import_item_hourly, so anything outside that range
--      can only be a data error, never a real shift result).
--   2) Deviation from the employee's own recent history: compares both
--      performance and OEE against that employee's own average over their
--      last 20 prior shifts (excluding the record itself), so what counts
--      as "unusual" is relative to each individual worker/role rather than
--      one global threshold that would either miss quieter deviations or
--      flag normal variation for consistently high (or understaffed)
--      performers.
drop function if exists public.detect_performance_anomalies(date, date, numeric);

create or replace function public.detect_performance_anomalies(
  p_work_date_from date default null,
  p_work_date_to date default null,
  p_deviation_threshold numeric default 30
)
returns table (
  record_id uuid,
  employee_id uuid,
  employee_name text,
  work_date date,
  shift text,
  line text,
  product text,
  performance numeric,
  oee numeric,
  available_time numeric,
  employee_avg_performance numeric,
  employee_avg_oee numeric,
  reason text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    d.id, d.employee_id, e.full_name, d.work_date, d.shift, d.line, d.product,
    d.performance, d.oee, d.available_time,
    hist.avg_perf, hist.avg_oee,
    case
      when d.performance > 200 then 'Výkon nad 200 %'
      when d.oee is not null and d.oee < 0 then 'OEE je záporné'
      when d.available_time is not null and (d.available_time > 100 or d.available_time < 0) then 'Dostupnost mimo platný rozsah 0-100 %'
      when hist.avg_perf is not null and abs(d.performance - hist.avg_perf) > p_deviation_threshold then 'Výrazná odchylka výkonu od vlastního průměru (posledních 20 směn)'
      when hist.avg_oee is not null and d.oee is not null and abs(d.oee - hist.avg_oee) > p_deviation_threshold then 'Výrazná odchylka OEE od vlastního průměru (posledních 20 směn)'
      else null
    end as reason
  from public.daily_records d
  join public.employees e on e.id = d.employee_id
  cross join lateral (
    select avg(recent.performance) as avg_perf, avg(recent.oee) as avg_oee
    from (
      select d2.performance, d2.oee
      from public.daily_records d2
      where d2.employee_id = d.employee_id
        and d2.id <> d.id
        and d2.performance is not null
        and d2.work_date < d.work_date
      order by d2.work_date desc
      limit 20
    ) recent
  ) hist
  where d.performance is not null
    and (p_work_date_from is null or d.work_date >= p_work_date_from)
    and (p_work_date_to is null or d.work_date <= p_work_date_to)
    and (
      d.performance > 200
      or (d.oee is not null and d.oee < 0)
      or (d.available_time is not null and (d.available_time > 100 or d.available_time < 0))
      or (hist.avg_perf is not null and abs(d.performance - hist.avg_perf) > p_deviation_threshold)
      or (hist.avg_oee is not null and d.oee is not null and abs(d.oee - hist.avg_oee) > p_deviation_threshold)
    )
  order by d.work_date desc;
$$;

grant execute on function public.detect_performance_anomalies(date, date, numeric) to authenticated;
