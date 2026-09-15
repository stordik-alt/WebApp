-- Verze 2.0 AUTO: OCR norma is display/input noise, never the source of truth.
-- The canonical norm comes from product_norms for the matched product/operation,
-- with Product Profile as a fallback. This prevents OCR from turning e.g. 85
-- into the operational norm when master data says otherwise.

create or replace function public.auto_canonicalize_import_norm()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_product public.products%rowtype;
  v_norm numeric;
  v_operation text;
  v_code text;
  v_profile_norm numeric;
  v_ocr jsonb;
begin
  v_code := nullif(trim(coalesce(new.product_code, '')), '');

  if new.product_id is not null then
    select * into v_product
    from public.products p
    where p.id = new.product_id
    limit 1;
  elsif v_code is not null then
    select * into v_product
    from public.products p
    where lower(regexp_replace(trim(coalesce(p.code, '')), '\s+', '', 'g')) =
          lower(regexp_replace(v_code, '\s+', '', 'g'))
    limit 1;
  end if;

  if v_product.id is null then
    return new;
  end if;

  v_operation := case
    when upper(coalesce(v_product.variant_type, '')) = 'T' then 'TUP'
    when upper(coalesce(v_product.variant_type, '')) = 'H' then 'HA'
    when upper(left(coalesce(v_product.code, ''), 2)) = 'T_' then 'TUP'
    when upper(left(coalesce(v_product.code, ''), 2)) = 'H_' then 'HA'
    else null
  end;

  if v_operation is null then
    return new;
  end if;

  -- Prefer the operational norm table. It is the canonical master source.
  select pn.norm_per_hour
    into v_norm
  from public.product_norms pn
  where pn.product_id = v_product.id
    and upper(coalesce(pn.operation, '')) = v_operation
    and pn.norm_per_hour is not null
    and pn.norm_per_hour > 0
    and pn.valid_from <= coalesce(new.work_date, current_date)
    and (pn.valid_to is null or pn.valid_to >= coalesce(new.work_date, current_date))
  order by pn.valid_to is null desc, pn.valid_from desc, pn.created_at desc
  limit 1;

  -- Fallback to the matched Product Profile when product_norms has no valid row.
  if v_norm is null then
    select case when v_operation = 'HA' then pp.h_norm_per_hour else pp.t_norm_per_hour end
      into v_profile_norm
    from public.product_profiles pp
    where (
      lower(regexp_replace(coalesce(pp.ha_subassy, ''), '\s+', '', 'g')) = lower(regexp_replace(v_product.code, '\s+', '', 'g'))
      or lower(regexp_replace(coalesce(pp.tup_subassy, ''), '\s+', '', 'g')) = lower(regexp_replace(v_product.code, '\s+', '', 'g'))
    )
      and pp.valid_from <= coalesce(new.work_date, current_date)
      and (pp.valid_to is null or pp.valid_to >= coalesce(new.work_date, current_date))
      and case when v_operation = 'HA' then pp.h_norm_per_hour else pp.t_norm_per_hour end > 0
    order by pp.valid_to is null desc, pp.valid_from desc, pp.version_no desc
    limit 1;
    v_norm := v_profile_norm;
  end if;

  if v_norm is null then
    return new;
  end if;

  new.norm_per_hour := v_norm;

  -- Keep the OCR payload auditable, but expose the canonical norm in the field
  -- consumed by the application. Preserve the original OCR value separately.
  if new.ocr_data is not null and jsonb_typeof(new.ocr_data) = 'object' then
    v_ocr := new.ocr_data;
    if v_ocr ? 'norm_per_hour' and not (v_ocr ? 'ocr_norm_per_hour') then
      v_ocr := jsonb_set(v_ocr, '{ocr_norm_per_hour}', v_ocr->'norm_per_hour', true);
    end if;
    v_ocr := jsonb_set(v_ocr, '{norm_per_hour}', to_jsonb(v_norm), true);
    new.ocr_data := v_ocr;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_import_items_canonicalize_ocr_norm on public.import_items;
create trigger trg_import_items_canonicalize_ocr_norm
before insert or update of product_id, product_code, work_date, ocr_data, norm_per_hour
on public.import_items
for each row
execute function public.auto_canonicalize_import_norm();

-- Repair already persisted imports. The trigger preserves the original OCR norm
-- under ocr_norm_per_hour the first time it is encountered.
update public.import_items i
set norm_per_hour = i.norm_per_hour
where i.product_code is not null;
