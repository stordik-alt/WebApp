-- find_ha_tup_link only considered the single "best-ranked" product_profiles
-- match for a TUP code, but the live data has a real case of two currently-
-- active profiles pairing the same tup_subassy to two differently-spelled
-- ha_subassy codes ("H_R32346264-001" vs "H_32346264-001", both valid_to
-- null). Picking only the top-ranked one silently missed the real HA import
-- (which uses the "R" spelling) whenever the other profile happened to rank
-- higher by valid_from. Now considers every distinct candidate ha_subassy
-- for this tup_code at the work date, and searches for an HA match against
-- any of them - if candidates resolve to more than one distinct HA
-- import_item, that's a genuine AMBIGUOUS case (the underlying profile data
-- itself doesn't uniquely determine the pairing), which is the correct
-- outcome per the "must be evidenced, never assumed" rule - not something to
-- silently paper over by picking one profile arbitrarily.
create or replace function public.find_ha_tup_link(
  p_tup_product_code text,
  p_line text,
  p_work_date date,
  p_shift text
)
returns table (
  ha_import_item_id uuid,
  ha_product_code text,
  match_status text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_ha_codes text[];
  v_tup_line_name text;
  v_ids uuid[];
  v_matched_code text;
begin
  select array_agg(distinct pp.ha_subassy)
  into v_ha_codes
  from public.product_profiles pp
  where public.codes_match(
          lower(regexp_replace(coalesce(pp.tup_subassy, ''), '\s+', '', 'g')),
          lower(regexp_replace(coalesce(p_tup_product_code, ''), '\s+', '', 'g'))
        )
    and pp.ha_subassy is not null
    and pp.valid_from is not null
    and pp.valid_from <= p_work_date
    and (pp.valid_to is null or pp.valid_to >= p_work_date);

  if v_ha_codes is null or array_length(v_ha_codes, 1) = 0 then
    return query select null::uuid, null::text, 'NONE'::text;
    return;
  end if;

  select w.line_name
  into v_tup_line_name
  from public.workplaces w
  where w.source_line = p_line
    and w.area = 'TUP'
  limit 1;

  if v_tup_line_name is null or v_tup_line_name = 'Neurčeno' then
    return query select null::uuid, v_ha_codes[1], 'NONE'::text;
    return;
  end if;

  select array_agg(distinct i.id), min(h.product_code)
  into v_ids, v_matched_code
  from public.import_item_hourly h
  join public.import_items i on i.id = h.import_item_id
  join public.workplaces w2 on w2.source_line = i.line and w2.area = 'HA'
  where w2.line_name = v_tup_line_name
    and i.work_date = p_work_date
    and i.shift = p_shift
    and i.status in ('AUTO_APPROVED', 'APPROVED')
    and exists (
      select 1 from unnest(v_ha_codes) as candidate
      where public.codes_match(
              lower(regexp_replace(coalesce(h.product_code, ''), '\s+', '', 'g')),
              lower(regexp_replace(candidate, '\s+', '', 'g'))
            )
    );

  if v_ids is null or array_length(v_ids, 1) = 0 then
    return query select null::uuid, v_ha_codes[1], 'NONE'::text;
  elsif array_length(v_ids, 1) > 1 then
    return query select null::uuid, v_matched_code, 'AMBIGUOUS'::text;
  else
    return query select v_ids[1], v_matched_code, 'LINKED'::text;
  end if;
end;
$$;
