begin;

-- 2.0 AUTO: one HA subassembly may legitimately be used by multiple
-- Product Profiles with different TUP subassemblies.
-- Therefore HA alone is NOT a unique Product Profile key.
-- The active-profile uniqueness boundary is the complete HA/TUP pair.
-- Historical versions remain allowed.
create unique index if not exists product_profiles_active_ha_tup_unique_idx
  on public.product_profiles (
    lower(regexp_replace(coalesce(ha_subassy, ''), '\\s+', '', 'g')),
    lower(regexp_replace(coalesce(tup_subassy, ''), '\\s+', '', 'g'))
  )
  where valid_to is null;

comment on index public.product_profiles_active_ha_tup_unique_idx is
  '2.0 AUTO: HA subassembly may be shared by multiple profiles; only the active HA+TUP pair must be unique.';

commit;
