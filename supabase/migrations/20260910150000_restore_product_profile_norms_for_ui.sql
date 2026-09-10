begin;

-- Product Profiles are the source of truth for imported H_/T_ norms.
-- Older imports can leave the norm in product_profiles without a matching
-- visible product_norms row, which makes the Product ID editor show "–".
-- Materialize only missing active rows so existing norm history is preserved.

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
  f.h_product_id,
  'HA',
  pp.h_norm_per_hour,
  current_date,
  null,
  'product_profile',
  true,
  'Norma obnovená z Product Profile po importu',
  false,
  'approved'
from public.product_profiles pp
join public.product_families f on f.id = pp.id
where f.h_product_id is not null
  and pp.h_norm_per_hour is not null
  and pp.h_norm_per_hour > 0
  and not exists (
    select 1
    from public.product_norms pn
    where pn.product_id = f.h_product_id
      and pn.operation = 'HA'
      and pn.valid_from <= current_date
      and (pn.valid_to is null or pn.valid_to >= current_date)
  );

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
  f.t_product_id,
  'TUP',
  pp.t_norm_per_hour,
  current_date,
  null,
  'product_profile',
  true,
  'Norma obnovená z Product Profile po importu',
  false,
  'approved'
from public.product_profiles pp
join public.product_families f on f.id = pp.id
where f.t_product_id is not null
  and pp.t_norm_per_hour is not null
  and pp.t_norm_per_hour > 0
  and not exists (
    select 1
    from public.product_norms pn
    where pn.product_id = f.t_product_id
      and pn.operation = 'TUP'
      and pn.valid_from <= current_date
      and (pn.valid_to is null or pn.valid_to >= current_date)
  );

-- Standalone imported Product IDs use the profile row itself as the key.
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
  p.id,
  'HA',
  pp.h_norm_per_hour,
  current_date,
  null,
  'product_profile',
  true,
  'Norma obnovená z Product Profile po importu',
  false,
  'approved'
from public.product_profiles pp
join public.products p on p.id = pp.id
where p.family_id is null
  and coalesce(p.variant_type, 'H') <> 'T'
  and pp.h_norm_per_hour is not null
  and pp.h_norm_per_hour > 0
  and not exists (
    select 1
    from public.product_norms pn
    where pn.product_id = p.id
      and pn.operation = 'HA'
      and pn.valid_from <= current_date
      and (pn.valid_to is null or pn.valid_to >= current_date)
  );

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
  p.id,
  'TUP',
  pp.t_norm_per_hour,
  current_date,
  null,
  'product_profile',
  true,
  'Norma obnovená z Product Profile po importu',
  false,
  'approved'
from public.product_profiles pp
join public.products p on p.id = pp.id
where p.family_id is null
  and p.variant_type = 'T'
  and pp.t_norm_per_hour is not null
  and pp.t_norm_per_hour > 0
  and not exists (
    select 1
    from public.product_norms pn
    where pn.product_id = p.id
      and pn.operation = 'TUP'
      and pn.valid_from <= current_date
      and (pn.valid_to is null or pn.valid_to >= current_date)
  );

notify pgrst, 'reload schema';

commit;
