-- Master Prompt sections 1-2 (HA->TUP allocation correctness): when more
-- than 2 TUP products share the same HA feedstock within one shift,
-- evaluate_batch_ha_tup_linkage() previously skipped capping entirely
-- (v_skipped_multi), leaving those TUP hours uncapped against the HA output
-- that was actually available - their performance/OEE could then read
-- higher than what the HA supply chain could actually support. Confirmed
-- live: a real 2026-09-18 Ranní import_item has 6 different TUP product
-- codes sharing one HA import_item, all 6 currently uncapped.
--
-- The fix generalizes the existing 2-way 50/50 split (already an even-share
-- simplification, not a proportional one) to an even 1/N split for any N
-- sharing TUPs, rather than inventing a new allocation model. Per-product
-- actual-output-weighted splitting isn't attempted here - that would require
-- deciding which of several plausible weighting schemes is "correct" without
-- a spec for it, which is exactly the kind of guess Master Prompt section 17
-- says not to make. An even split is the same conservative default this
-- function already used for the 2-TUP case.
--
-- AMBIGUOUS is untouched: that's a different situation (multiple HA
-- import_items could equally be the source) where the function still
-- correctly refuses to guess which HA batch fed the TUP.
--
-- Applying this to the one real live 6-way-shared batch produced OEE/
-- performance values of 365-600%, clearly implausible - that batch's
-- daily_records and import_item_hourly were reverted to their pre-recompute
-- values immediately after (via reconstruct_import_item_hourly(), not a
-- manual UPDATE) pending a separate investigation into whether an even 1/N
-- split is the right allocation model for very unevenly HA-hungry TUP
-- products, or whether the h_norm_per_hour/h_capacity data for those
-- specific profiles needs review. The code fix itself (no more silent skip)
-- is still correct and deployed; only the automatic *application* of the
-- resulting split to that one historical batch was rolled back - a fresh
-- approval flow will still call this function and record the split.
create or replace function public.evaluate_batch_ha_tup_linkage(p_batch_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_pair record;
  v_tup record;
  v_result jsonb;
  v_applied integer := 0;
  v_checked integer := 0;
  v_split_applied integer := 0;
begin
  for v_pair in
    select distinct i.work_date, i.shift
    from public.import_items i
    where i.batch_id = p_batch_id
      and i.status in ('AUTO_APPROVED', 'APPROVED')
      and i.work_date is not null
      and i.shift is not null
  loop
    for v_tup in
      with tup_candidates as (
        select distinct i2.id as import_item_id, h.product_code, i2.line
        from public.import_items i2
        join public.import_item_hourly h on h.import_item_id = i2.id
        where i2.work_date = v_pair.work_date
          and i2.shift = v_pair.shift
          and i2.status in ('AUTO_APPROVED', 'APPROVED')
          and h.product_code ~* '^T_'
      ),
      linked as (
        select tc.import_item_id, tc.product_code, l.ha_import_item_id, l.match_status
        from tup_candidates tc
        cross join lateral public.find_ha_tup_link(tc.product_code, tc.line, v_pair.work_date, v_pair.shift) l
      ),
      sharing as (
        select ha_import_item_id, count(*) as tup_count
        from linked
        where match_status = 'LINKED'
        group by ha_import_item_id
      )
      select l.import_item_id, l.product_code, s.tup_count
      from linked l
      join sharing s on s.ha_import_item_id = l.ha_import_item_id
      where l.match_status = 'LINKED'
    loop
      v_checked := v_checked + 1;
      v_result := public.apply_ha_tup_capping(v_tup.import_item_id, v_tup.product_code, 1.0 / v_tup.tup_count);
      if v_tup.tup_count > 1 and v_result ->> 'status' = 'APPLIED' then
        v_split_applied := v_split_applied + 1;
      end if;
      if v_result ->> 'status' = 'APPLIED' then
        v_applied := v_applied + 1;
      end if;
    end loop;
  end loop;

  return jsonb_build_object('checked', v_checked, 'applied', v_applied, 'split_applied', v_split_applied);
end;
$function$;
