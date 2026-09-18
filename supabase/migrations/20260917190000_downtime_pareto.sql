-- Feature idea #1: Pareto analysis of downtime reasons. The data
-- (downtime_reason/downtime_minutes on every hourly row, plus the existing
-- downtime_reason_classifications catalog) already exists; this just
-- aggregates it. Reuses classify_downtime_reason()'s own fuzzy matching so
-- the grouping stays consistent with whatever an admin has classified in
-- /odstavky, and groups by the CATALOG's canonical reason_text when a match
-- is found (so OCR spelling variance of the same reason doesn't fragment
-- into separate Pareto buckets), falling back to the raw OCR text only for
-- reasons nobody has classified yet.
create or replace function public.downtime_pareto(
  p_work_date_from date default null,
  p_work_date_to date default null
)
returns table (
  reason_label text,
  category text,
  total_minutes numeric,
  occurrences integer
)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(
      (
        select drc.reason_text
        from public.downtime_reason_classifications drc
        where drc.active
          and public.normalize_downtime_reason(h.raw_data ->> 'downtime_reason') like '%' || public.normalize_downtime_reason(drc.reason_text) || '%'
          and public.normalize_downtime_reason(drc.reason_text) <> ''
        order by length(drc.reason_text) desc
        limit 1
      ),
      -- Unclassified OCR reasons sometimes carry a trailing parenthetical
      -- timestamp (e.g. "Neznámý důvod odstávky (22:07)") that varies per
      -- occurrence - stripped here so the same underlying reason groups
      -- into one Pareto bucket instead of fragmenting by timestamp.
      nullif(trim(both ' ,' from regexp_replace(regexp_replace(coalesce(h.raw_data ->> 'downtime_reason', ''), '\s*\([^)]*\)\s*', ' ', 'g'), '\s+', ' ', 'g')), ''),
      'Nezadáno'
    ) as reason_label,
    public.classify_downtime_reason(h.raw_data ->> 'downtime_reason') as category,
    sum(nullif(trim(h.raw_data ->> 'downtime_minutes'), '')::numeric) as total_minutes,
    count(*)::integer as occurrences
  from public.import_item_hourly h
  join public.import_items i on i.id = h.import_item_id
  where i.status in ('AUTO_APPROVED', 'APPROVED')
    and (p_work_date_from is null or i.work_date >= p_work_date_from)
    and (p_work_date_to is null or i.work_date <= p_work_date_to)
    and nullif(trim(h.raw_data ->> 'downtime_minutes'), '') is not null
    and (h.raw_data ->> 'downtime_minutes')::numeric > 0
  group by 1, 2
  order by total_minutes desc nulls last;
$$;

grant execute on function public.downtime_pareto(date, date) to authenticated;
