begin;

-- 2.0 AUTO: OCR frequently reads the workstation/line label from the
-- screenshot header as Product ID (for example "041.01 - HandAssy").
-- The authoritative Product ID is the product column in hourly metrics.
-- Never replace an already valid product. If the header value is not a
-- product in master data, resolve it from the first valid hourly product.
create or replace function public.normalize_import_item_ocr_product()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_header_product public.products%rowtype;
  v_hourly_product public.products%rowtype;
  v_hourly_code text;
  v_profile public.product_profiles%rowtype;
begin
  -- Do not touch a valid Product ID coming from OCR/admin correction.
  if new.product_code is not null then
    select p.* into v_header_product
    from public.products p
    where lower(regexp_replace(coalesce(p.code, ''), '\\s+', '', 'g')) =
          lower(regexp_replace(new.product_code, '\\s+', '', 'g'))
    limit 1;
  end if;

  if v_header_product.id is null then
    -- Header text is not a Product ID. Resolve the earliest hourly product
    -- that actually exists in master data. This deliberately ignores the
    -- workstation/line label and any other non-product OCR text.
    select h.product_code
      into v_hourly_code
    from public.import_item_hourly h
    join public.products p
      on lower(regexp_replace(coalesce(p.code, ''), '\\s+', '', 'g')) =
         lower(regexp_replace(coalesce(h.product_code, ''), '\\s+', '', 'g'))
    where h.import_item_id = new.id
      and h.product_code is not null
    order by h.hour asc
    limit 1;

    if v_hourly_code is not null then
      select p.* into v_hourly_product
      from public.products p
      where lower(regexp_replace(coalesce(p.code, ''), '\\s+', '', 'g')) =
            lower(regexp_replace(v_hourly_code, '\\s+', '', 'g'))
      limit 1;

      if v_hourly_product.id is not null then
        new.product_code := v_hourly_product.code;
        new.product_id := v_hourly_product.id;
        new.product_name := v_hourly_product.name;
        new.product_match_status := 'EXACT';

        -- Resolve the exact matching Product Profile as well. Never infer a
        -- different family merely because the OCR header was a workstation.
        select pp.* into v_profile
        from public.product_profiles pp
        where pp.valid_to is null
          and (
            lower(regexp_replace(coalesce(pp.ha_subassy, ''), '\\s+', '', 'g')) = lower(regexp_replace(v_hourly_product.code, '\\s+', '', 'g'))
            or lower(regexp_replace(coalesce(pp.tup_subassy, ''), '\\s+', '', 'g')) = lower(regexp_replace(v_hourly_product.code, '\\s+', '', 'g'))
          )
        order by pp.valid_from desc nulls last, pp.version_no desc nulls last
        limit 1;

        new.product_profile_status := case
          when v_profile.id is null then 'MISSING'
          when v_profile.ha_subassy is null or v_profile.tup_subassy is null
            or coalesce(v_profile.h_norm_per_hour, 0) <= 0
            or coalesce(v_profile.h_capacity, 0) < 1
            or coalesce(v_profile.t_norm_per_hour, 0) <= 0
            or coalesce(v_profile.t_capacity, 0) < 1
            then 'INCOMPLETE'
          else 'VALID'
        end;
      end if;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_import_items_normalize_ocr_product on public.import_items;
create trigger trg_import_items_normalize_ocr_product
before insert or update of product_code, product_id, product_name on public.import_items
for each row
execute function public.normalize_import_item_ocr_product();

grant execute on function public.normalize_import_item_ocr_product() to authenticated;

-- Repair already persisted AUTO imports where OCR stored a workstation/line
-- label instead of a real Product ID. Existing valid Product IDs are left
-- untouched. The trigger above performs the same repair for future imports.
with resolved as (
  select i.id as import_item_id,
         p.id as product_id,
         p.code as product_code,
         p.name as product_name,
         row_number() over (partition by i.id order by h.hour asc) as rn
  from public.import_items i
  join public.import_item_hourly h on h.import_item_id = i.id
  join public.products p
    on lower(regexp_replace(coalesce(p.code, ''), '\\s+', '', 'g')) =
       lower(regexp_replace(coalesce(h.product_code, ''), '\\s+', '', 'g'))
  where i.product_id is null
     or not exists (
       select 1 from public.products hp
       where lower(regexp_replace(coalesce(hp.code, ''), '\\s+', '', 'g')) =
             lower(regexp_replace(coalesce(i.product_code, ''), '\\s+', '', 'g'))
     )
), first_resolved as (
  select import_item_id, product_id, product_code, product_name
  from resolved
  where rn = 1
)
update public.import_items i
set product_id = r.product_id,
    product_code = r.product_code,
    product_name = r.product_name,
    product_match_status = 'EXACT'
from first_resolved r
where i.id = r.import_item_id;

commit;
