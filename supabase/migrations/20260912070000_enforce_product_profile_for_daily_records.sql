begin;

-- Product Profiles are the single source of truth for daily production data.
-- A daily record must never be persisted for a product/position that has no
-- current Product Profile containing a valid norm and operator capacity.
create or replace function public.validate_daily_record_product_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_variant text;
  v_has_profile boolean := false;
begin
  select p.code, p.variant_type
    into v_code, v_variant
  from public.products p
  where p.id = new.product_id;

  if v_code is null then
    raise exception 'Daily record cannot be saved: Product ID % does not exist.', new.product_id;
  end if;

  select exists (
    select 1
    from public.product_profiles pp
    where pp.valid_from <= coalesce(new.work_date, current_date)
      and (pp.valid_to is null or pp.valid_to >= coalesce(new.work_date, current_date))
      and (
        (
          (new.position = 'HA' or (new.position is null and v_variant = 'H'))
          and lower(regexp_replace(coalesce(pp.ha_subassy, ''), '\\s+', '', 'g')) = lower(regexp_replace(v_code, '\\s+', '', 'g'))
          and pp.h_norm_per_hour is not null
          and pp.h_norm_per_hour > 0
          and pp.h_capacity is not null
          and pp.h_capacity >= 1
        )
        or
        (
          (new.position = 'TUP' or (new.position is null and v_variant = 'T'))
          and lower(regexp_replace(coalesce(pp.tup_subassy, ''), '\\s+', '', 'g')) = lower(regexp_replace(v_code, '\\s+', '', 'g'))
          and pp.t_norm_per_hour is not null
          and pp.t_norm_per_hour > 0
          and pp.t_capacity is not null
          and pp.t_capacity >= 1
        )
      )
  ) into v_has_profile;

  if not v_has_profile then
    raise exception 'Daily record cannot be saved: Product ID % has no complete Product Profile for position % (norm and capacity are required).', v_code, coalesce(new.position, v_variant);
  end if;

  return new;
end;
$$;

drop trigger if exists trg_validate_daily_record_product_profile on public.daily_records;
create trigger trg_validate_daily_record_product_profile
before insert or update of product_id, position, work_date
on public.daily_records
for each row
execute function public.validate_daily_record_product_profile();

commit;
