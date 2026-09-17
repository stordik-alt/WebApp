-- Audit finding: compute_import_item_product_kpis() grouped hourly rows by
-- the RAW LITERAL product_code string, not the resolved product_id. If OCR
-- reads the same physical product with a slightly different spelling across
-- different hours of the same screenshot (e.g. "T_S4966V4014B" in one hour,
-- "T_S4966V4014" in another - both resolving to the same product via
-- resolve_product_profile's suffix fallback), this produced TWO separate
-- KPI rows for what should be one product. auto_approve_import_item_legacy
-- /approve_import_item_legacy would then try to insert two daily_records
-- rows with the same (employee, work_date, shift, line, product_id) key,
-- violating the unique constraint added for multi-product support and
-- crashing the whole approval with a raw DB error.
--
-- Checked live data: no import_item_hourly currently has two literal
-- product_code spellings that resolve to the same product (the real
-- multi-product items all involve genuinely different products), so this
-- was latent, not yet triggered - but the suffix-fallback matching this
-- session introduced makes it a real, reachable case (this is exactly what
-- happened with T_S4966V4014B/T_S4966V4014 during testing), so it's worth
-- fixing proactively rather than waiting for it to crash a real approval.
--
-- Now resolves each row's product first, then groups by the resolved
-- product_id when there is one (falling back to the normalized literal
-- code only for genuinely unresolved codes, so two different unknown codes
-- are never incorrectly merged).
create or replace function public.compute_import_item_product_kpis(p_import_item_id uuid, p_work_date date default current_date)
returns table (
  product_code text,
  product_id uuid,
  product_name text,
  profile_id uuid,
  profile_complete boolean,
  performance numeric,
  availability numeric,
  oee numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r record;
begin
  for r in
    with resolved_hours as (
      select
        h.performance_pct,
        h.availability_pct,
        h.actual_oee_pct,
        coalesce(
          nullif(trim(coalesce(h.raw_data -> 'calculation' ->> 'reconstructed_productive_minutes', '')), '')::double precision,
          0
        ) as minutes,
        h.product_code as raw_code,
        rp.product_id as resolved_product_id,
        rp.product_name as resolved_product_name,
        rp.profile_id as resolved_profile_id,
        rp.profile_complete as resolved_profile_complete,
        coalesce(
          rp.product_id::text,
          'unresolved:' || lower(regexp_replace(coalesce(h.product_code, ''), '\s+', '', 'g'))
        ) as group_key
      from public.import_item_hourly h
      left join lateral public.resolve_product_profile(h.product_code, p_work_date) rp on true
      where h.import_item_id = p_import_item_id
        and nullif(trim(coalesce(h.product_code, '')), '') is not null
    )
    select
      (array_agg(raw_code order by raw_code))[1] as pcode,
      (array_agg(resolved_product_id) filter (where resolved_product_id is not null))[1] as rid,
      (array_agg(resolved_product_name) filter (where resolved_product_name is not null))[1] as rname,
      (array_agg(resolved_profile_id) filter (where resolved_profile_id is not null))[1] as rprofile,
      bool_or(coalesce(resolved_profile_complete, false)) as rcomplete,
      case when sum(minutes) filter (where performance_pct is not null) > 0
        then sum(performance_pct * minutes) filter (where performance_pct is not null) / sum(minutes) filter (where performance_pct is not null)
        else null end as perf,
      case when sum(minutes) filter (where availability_pct is not null) > 0
        then sum(availability_pct * minutes) filter (where availability_pct is not null) / sum(minutes) filter (where availability_pct is not null)
        else null end as avail,
      case when sum(minutes) filter (where actual_oee_pct is not null) > 0
        then sum(actual_oee_pct * minutes) filter (where actual_oee_pct is not null) / sum(minutes) filter (where actual_oee_pct is not null)
        else null end as oee_val
    from resolved_hours
    group by group_key
  loop
    product_code := r.pcode;
    product_id := r.rid;
    product_name := r.rname;
    profile_id := r.rprofile;
    profile_complete := r.rcomplete;
    performance := r.perf;
    availability := r.avail;
    oee := r.oee_val;
    return next;
  end loop;
  return;
end;
$$;
