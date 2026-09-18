-- Master Prompt sections 13-14: a read-only data-integrity audit mechanism.
-- Each check below encodes an invariant this session actually found broken
-- once (V4014's false-VALID status, the confirm-conflict UPSERT-vs-INSERT
-- bug) or a class of corruption the data model must never allow (a
-- daily_records row without a real product, two daily_records rows for the
-- same natural key, an import stuck mid-pipeline). Running this regularly
-- turns "we happened to notice a bad row" into "the system tells us".
--
-- Never mutates data - every check is a plain SELECT. Gated behind the admin
-- role like the other admin-only RPCs in this schema (approve_import_item,
-- historical_recompute_apply, ...).
create or replace function public.run_data_integrity_audit()
 returns table(check_name text, severity text, violation_count integer, sample_ids uuid[])
 language plpgsql
 stable
 set search_path to 'public'
as $function$
begin
  if not public.has_role(auth.uid(), 'admin') then
    raise exception 'Audit integrity dat je povolen pouze správci.' using errcode = '42501';
  end if;

  -- The exact V4014 bug class: an import_items row claiming its Product
  -- Profile is VALID while having no matching products row, which the fix in
  -- resolvedProfileStatus()/aggregateProfileStatus() must never produce
  -- again.
  return query
  select 'V4014_FALSE_VALID_PROFILE'::text, 'critical'::text, count(*)::integer,
    coalesce(array_agg(id order by created_at desc) filter (where id is not null), '{}')
  from public.import_items
  where product_profile_status = 'VALID' and product_id is null;

  -- daily_records is the ground truth for reporting/statistics - a row
  -- without a real product breaks every downstream aggregate silently.
  return query
  select 'DAILY_RECORD_ORPHAN_PRODUCT'::text, 'critical'::text, count(*)::integer,
    coalesce(array_agg(dr.id order by dr.work_date desc) filter (where dr.id is not null), '{}')
  from public.daily_records dr
  where dr.product_id is not null
    and not exists (select 1 from public.products p where p.id = dr.product_id);

  -- The natural key daily_records_employee_id_work_date_shift_line_product_id_key
  -- is what the confirm-conflict fix (20260919091000) relies on being
  -- unenforceable-to-violate - if this ever returns >0 the constraint itself
  -- has been weakened or bypassed by a direct write.
  return query
  select 'DUPLICATE_DAILY_RECORD_NATURAL_KEY'::text, 'critical'::text, count(*)::integer,
    coalesce(array_agg(min_id), '{}')
  from (
    select (array_agg(id order by id))[1] as min_id
    from public.daily_records
    where product_id is not null
    group by employee_id, work_date, shift, line, product_id
    having count(*) > 1
  ) dupes;

  -- An "approved" record with no KPI is a record that will silently read as
  -- zero/blank everywhere it's aggregated instead of failing loudly.
  return query
  select 'APPROVED_RECORD_MISSING_KPI'::text, 'warning'::text, count(*)::integer,
    coalesce(array_agg(id order by work_date desc) filter (where id is not null), '{}')
  from public.daily_records
  where approval_status = 'approved' and (oee is null or performance is null or available_time is null);

  -- Repeat of the class of bug fixed earlier this session (OCR fetch()
  -- without a timeout leaving an item stuck in PROCESSING/VALIDATING
  -- forever) - this check is what would have caught it automatically
  -- instead of a user reporting "stuck import" again.
  return query
  select 'STUCK_IMPORT'::text, 'warning'::text, count(*)::integer,
    coalesce(array_agg(id order by updated_at) filter (where id is not null), '{}')
  from public.import_items
  where status in ('PROCESSING', 'VALIDATING') and updated_at < now() - interval '30 minutes';

  -- Two simultaneously "current" (valid_to is null) profiles for the exact
  -- same (ha_subassy, tup_subassy) pair - i.e. the same profile_key - would
  -- make resolve_product_profile()'s choice ambiguous by construction. NOT
  -- the same thing as one HA code legitimately feeding several different
  -- TUP products (that's the normal HA->TUP allocation this system is built
  -- around, and a real live-data check confirmed it's common - grouping by
  -- ha_subassy alone would flag dozens of false positives). Already
  -- structurally prevented by the product_profiles_active_ha_tup_unique_idx
  -- partial unique index, so this check is pure defense-in-depth against
  -- that constraint ever being weakened or bypassed - same reasoning as
  -- DUPLICATE_DAILY_RECORD_NATURAL_KEY above.
  return query
  select 'OVERLAPPING_ACTIVE_PROFILE_KEY'::text, 'critical'::text, count(*)::integer,
    coalesce(array_agg(min_id), '{}')
  from (
    select (array_agg(id order by id))[1] as min_id
    from public.product_profiles
    where valid_to is null and profile_key is not null
    group by profile_key
    having count(*) > 1
  ) dupes;

  -- conflict_daily_record_ids is read directly by the admin conflict-
  -- comparison UI (Master Prompt sections 8-10) - a dangling id would render
  -- as a silently empty comparison card instead of a clear error.
  return query
  select 'DANGLING_CONFLICT_REFERENCE'::text, 'warning'::text, count(*)::integer,
    coalesce(array_agg(ii.id order by ii.created_at desc) filter (where ii.id is not null), '{}')
  from public.import_items ii
  where ii.conflict_daily_record_ids is not null
    and array_length(ii.conflict_daily_record_ids, 1) > 0
    and exists (
      select 1 from unnest(ii.conflict_daily_record_ids) as conflict_id
      where not exists (select 1 from public.daily_records dr where dr.id = conflict_id)
    );

  -- reimport_of_id (Master Prompt section 7) is meant to point at the
  -- rejected original it replaced - if the original isn't REJECTED, the
  -- reimport lineage is inconsistent with what actually happened.
  return query
  select 'REIMPORT_OF_NOT_REJECTED'::text, 'warning'::text, count(*)::integer,
    coalesce(array_agg(ii.id order by ii.created_at desc) filter (where ii.id is not null), '{}')
  from public.import_items ii
  join public.import_items orig on orig.id = ii.reimport_of_id
  where orig.status <> 'REJECTED';

  -- Not a defect by itself, but an import sitting in PENDING_APPROVAL for a
  -- week means either nobody looked at it or it's stuck behind a blocker
  -- nobody can clear - worth a human's attention either way.
  return query
  select 'PENDING_APPROVAL_STALE'::text, 'info'::text, count(*)::integer,
    coalesce(array_agg(id order by created_at) filter (where id is not null), '{}')
  from public.import_items
  where status = 'PENDING_APPROVAL' and created_at < now() - interval '7 days';
end;
$function$;
