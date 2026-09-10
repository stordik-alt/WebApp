begin;

-- The previous backfill incorrectly assumed product_profiles.id = product_families.id.
-- They are independent tables, so imported profiles could contain valid norms while
-- product_norms remained empty. Match the imported H_/T_ codes to products.code.
-- Normalization removes spaces, underscores and punctuation differences so OCR/import
-- variants still resolve to the canonical Product ID.

with profile_products as (
  select
    pp.h_norm_per_hour,
    pp.t_norm_per_hour,
    h.id as h_product_id,
    t.id as t_product_id,
    pp.created_at
  from public.product_profiles pp
  left join public.products h
    on regexp_replace(lower(trim(coalesce(h.code, ''))), '[^a-z0-9]', '', 'g') =
       regexp_replace(lower(trim(coalesce(pp.ha_subassy, ''))), '[^a-z0-9]', '', 'g')
  left join public.products t
    on regexp_replace(lower(trim(coalesce(t.code, ''))), '[^a-z0-9]', '', 'g') =
       regexp_replace(lower(trim(coalesce(pp.tup_subassy, ''))), '[^a-z0-9]', '', 'g')
)
insert into public.product_norms (
  product_id,
  operation,
  norm_per_hour,
  valid_from,
  valid_to,
  source,
  confirmed,
  note,
  is_demo,
  approval_status
)
select
  h_product_id,
  'HA',
  h_norm_per_hour,
  coalesce(created_at::date, current_date),
  null,
  'product_profile',
  true,
  'Norma obnovená z importovaného Product Profile',
  false,
  'approved'
from profile_products
where h_product_id is not null
  and h_norm_per_hour is not null
  and h_norm_per_hour > 0
  and not exists (
    select 1
    from public.product_norms pn
    where pn.product_id = profile_products.h_product_id
      and pn.operation = 'HA'
      and pn.valid_from <= current_date
      and (pn.valid_to is null or pn.valid_to >= current_date)
  );

with profile_products as (
  select
    pp.h_norm_per_hour,
    pp.t_norm_per_hour,
    h.id as h_product_id,
    t.id as t_product_id,
    pp.created_at
  from public.product_profiles pp
  left join public.products h
    on regexp_replace(lower(trim(coalesce(h.code, ''))), '[^a-z0-9]', '', 'g') =
       regexp_replace(lower(trim(coalesce(pp.ha_subassy, ''))), '[^a-z0-9]', '', 'g')
  left join public.products t
    on regexp_replace(lower(trim(coalesce(t.code, ''))), '[^a-z0-9]', '', 'g') =
       regexp_replace(lower(trim(coalesce(pp.tup_subassy, ''))), '[^a-z0-9]', '', 'g')
)
insert into public.product_norms (
  product_id,
  operation,
  norm_per_hour,
  valid_from,
  valid_to,
  source,
  confirmed,
  note,
  is_demo,
  approval_status
)
select
  t_product_id,
  'TUP',
  t_norm_per_hour,
  coalesce(created_at::date, current_date),
  null,
  'product_profile',
  true,
  'Norma obnovená z importovaného Product Profile',
  false,
  'approved'
from profile_products
where t_product_id is not null
  and t_norm_per_hour is not null
  and t_norm_per_hour > 0
  and not exists (
    select 1
    from public.product_norms pn
    where pn.product_id = profile_products.t_product_id
      and pn.operation = 'TUP'
      and pn.valid_from <= current_date
      and (pn.valid_to is null or pn.valid_to >= current_date)
  );

notify pgrst, 'reload schema';
commit;
