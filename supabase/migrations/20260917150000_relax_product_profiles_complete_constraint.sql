-- Master Prompt Problem 7, continued: the actual blocker for TUP-only (or
-- HA-only) profiles isn't just resolve_product_profile()'s completeness
-- calculation (fixed separately) - it's this table's own CHECK constraint,
-- which required an active (valid_to is null) profile to always have BOTH
-- ha_subassy and tup_subassy with full valid norm/capacity. That made it
-- structurally impossible to even INSERT or UPDATE a genuinely one-sided
-- active profile, regardless of any application-level fix.
--
-- Replaced with the same "at least one side present, and each present side
-- must be fully valid" rule used by resolve_product_profile(), so the
-- database and the resolver agree on what "complete" means. A profile with
-- neither side, or with a side that's partially filled in (code without a
-- matching norm/capacity), is still rejected.
alter table public.product_profiles
  drop constraint if exists product_profiles_active_complete_check;

alter table public.product_profiles
  add constraint product_profiles_active_complete_check
  check (
    valid_to is not null
    or (
      (
        nullif(trim(coalesce(ha_subassy, '')), '') is not null
        or nullif(trim(coalesce(tup_subassy, '')), '') is not null
      )
      and (
        nullif(trim(coalesce(ha_subassy, '')), '') is null
        or (h_capacity is not null and h_capacity >= 1 and h_norm_per_hour is not null and h_norm_per_hour > 0)
      )
      and (
        nullif(trim(coalesce(tup_subassy, '')), '') is null
        or (t_capacity is not null and t_capacity >= 1 and t_norm_per_hour is not null and t_norm_per_hour > 0)
      )
    )
  ) not valid;
