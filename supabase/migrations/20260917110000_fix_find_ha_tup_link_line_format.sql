-- import_items.line is inconsistently populated: sometimes the full
-- "041.01 - HandAssy L1/4 HF" workplace string (matching
-- workplaces.source_line exactly), sometimes just the bare line token
-- "L1/4 HF" (which instead matches workplaces.line_name exactly). This is a
-- pre-existing data inconsistency - pracoviste.tsx's own parseImportedLine
-- only recognizes the full "NNN.NN - ..." format too, so bare-line-token
-- items fall through there as well. Rather than silently guess with fuzzy
-- text matching (which risks false positives), widen the join to accept an
-- exact match against EITHER known-good field.
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
  where w.area = 'TUP'
    and (w.source_line = p_line or w.line_name = p_line)
  limit 1;

  if v_tup_line_name is null or v_tup_line_name = 'Neurčeno' then
    return query select null::uuid, v_ha_codes[1], 'NONE'::text;
    return;
  end if;

  select array_agg(distinct i.id), min(h.product_code)
  into v_ids, v_matched_code
  from public.import_item_hourly h
  join public.import_items i on i.id = h.import_item_id
  join public.workplaces w2 on w2.area = 'HA' and (w2.source_line = i.line or w2.line_name = i.line)
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
