-- Feature idea #2: HA->TUP flow dashboard. The linkage/capping work from
-- earlier this session already writes a full audit trail into every capped
-- TUP hour's raw_data.calculation.ha_tup_linkage - this just aggregates
-- that per (work_date, shift, HA product, TUP product) so an admin can see
-- which HA lines are actually feeding which TUP lines, how much of the
-- HA's output each TUP was allocated (1.0 for an exclusive pairing, 0.5 for
-- a confirmed 2-way split per Problem 6), and how often the cap actually
-- bound (a signal of real supply pressure, not just a theoretical pairing).
create or replace function public.ha_tup_linkage_report(
  p_work_date_from date default null,
  p_work_date_to date default null
)
returns table (
  work_date date,
  shift text,
  tup_product_code text,
  ha_product_code text,
  linked_ha_import_item_id uuid,
  allocation_fraction numeric,
  hours_linked integer,
  hours_capped integer,
  tup_actual_output numeric,
  ha_available_output numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select
    i.work_date,
    i.shift,
    h.product_code as tup_product_code,
    (h.raw_data -> 'calculation' -> 'ha_tup_linkage' ->> 'ha_product_code') as ha_product_code,
    nullif(h.raw_data -> 'calculation' -> 'ha_tup_linkage' ->> 'linked_ha_import_item_id', '')::uuid as linked_ha_import_item_id,
    avg(nullif(h.raw_data -> 'calculation' -> 'ha_tup_linkage' ->> 'allocation_fraction', '')::numeric) as allocation_fraction,
    count(*)::integer as hours_linked,
    count(*) filter (where (h.raw_data -> 'calculation' -> 'ha_tup_linkage' ->> 'capped')::boolean)::integer as hours_capped,
    sum(coalesce(h.actual_output, 0)) as tup_actual_output,
    max(nullif(h.raw_data -> 'calculation' -> 'ha_tup_linkage' ->> 'ha_cumulative_available', '')::numeric) as ha_available_output
  from public.import_item_hourly h
  join public.import_items i on i.id = h.import_item_id
  where h.raw_data -> 'calculation' -> 'ha_tup_linkage' is not null
    and i.status in ('AUTO_APPROVED', 'APPROVED')
    and (p_work_date_from is null or i.work_date >= p_work_date_from)
    and (p_work_date_to is null or i.work_date <= p_work_date_to)
  group by i.work_date, i.shift, h.product_code, 4, 5
  order by i.work_date desc, i.shift, tup_product_code;
$$;

grant execute on function public.ha_tup_linkage_report(date, date) to authenticated;
