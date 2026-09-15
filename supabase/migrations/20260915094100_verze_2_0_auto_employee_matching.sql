-- Verze 2.0 AUTO
-- Robust employee matching for OCR rows.
-- Exact full-name matches and safe initial+surname matches are accepted only when unique.
-- Existing manual assignments are never overwritten.

create or replace function public.auto_match_import_item_employees(p_import_item_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_employee_id uuid;
  v_candidate_count integer;
  v_ocr text;
  v_norm text;
  v_surname text;
  v_initial text;
begin
  for r in
    select id, ocr_employee_name
    from public.import_item_rows
    where import_item_id = p_import_item_id
      and employee_id is null
      and nullif(trim(ocr_employee_name), '') is not null
  loop
    v_ocr := trim(r.ocr_employee_name);
    v_norm := regexp_replace(
      translate(lower(v_ocr), 'áčďéěíňóřšťúůýž', 'acdeeinorstuuyz'),
      '[^a-z0-9]+', '', 'g'
    );

    select count(*) into v_candidate_count
    from public.employees e
    where e.active
      and regexp_replace(
        translate(lower(trim(e.full_name)), 'áčďéěíňóřšťúůýž', 'acdeeinorstuuyz'),
        '[^a-z0-9]+', '', 'g'
      ) = v_norm;

    if v_candidate_count = 1 then
      select e.id into v_employee_id
      from public.employees e
      where e.active
        and regexp_replace(
          translate(lower(trim(e.full_name)), 'áčďéěíňóřšťúůýž', 'acdeeinorstuuyz'),
          '[^a-z0-9]+', '', 'g'
        ) = v_norm
      limit 1;
    else
      v_surname := regexp_replace(
        translate(lower(trim(split_part(v_ocr, ' ', array_length(regexp_split_to_array(v_ocr, '\s+'), 1)))), 'áčďéěíňóřšťúůýž', 'acdeeinorstuuyz'),
        '[^a-z0-9]+', '', 'g'
      );
      v_initial := left(
        regexp_replace(
          translate(lower(trim(split_part(v_ocr, ' ', 1))), 'áčďéěíňóřšťúůýž', 'acdeeinorstuuyz'),
          '[^a-z0-9]+', '', 'g'
        ),
        1
      );

      if length(v_initial) = 1 and length(v_surname) > 1 then
        select count(*) into v_candidate_count
        from public.employees e
        where e.active
          and regexp_replace(
            translate(lower(trim(split_part(e.full_name, ' ', array_length(regexp_split_to_array(e.full_name, '\s+'), 1)))), 'áčďéěíňóřšťúůýž', 'acdeeinorstuuyz'),
            '[^a-z0-9]+', '', 'g'
          ) = v_surname
          and left(
            regexp_replace(
              translate(lower(trim(split_part(e.full_name, ' ', 1))), 'áčďéěíňóřšťúůýž', 'acdeeinorstuuyz'),
              '[^a-z0-9]+', '', 'g'
            ),
            1
          ) = v_initial;

        if v_candidate_count = 1 then
          select e.id into v_employee_id
          from public.employees e
          where e.active
            and regexp_replace(
              translate(lower(trim(split_part(e.full_name, ' ', array_length(regexp_split_to_array(e.full_name, '\s+'), 1)))), 'áčďéěíňóřšťúůýž', 'acdeeinorstuuyz'),
              '[^a-z0-9]+', '', 'g'
            ) = v_surname
            and left(
              regexp_replace(
                translate(lower(trim(split_part(e.full_name, ' ', 1))), 'áčďéěíňóřšťúůýž', 'acdeeinorstuuyz'),
                '[^a-z0-9]+', '', 'g'
              ),
              1
            ) = v_initial
          limit 1;
        end if;
      end if;
    end if;

    if v_employee_id is not null then
      update public.import_item_rows
      set employee_id = v_employee_id,
          match_status = case when v_candidate_count = 1 and v_norm = regexp_replace(translate(lower(trim((select e.full_name from public.employees e where e.id = v_employee_id))), 'áčďéěíňóřšťúůýž', 'acdeeinorstuuyz'), '[^a-z0-9]+', '', 'g') then 'EXACT' else 'MATCHED' end,
          validation_status = 'VALID'
      where id = r.id;
    end if;

    v_employee_id := null;
  end loop;
end;
$$;

grant execute on function public.auto_match_import_item_employees(uuid) to authenticated;

create or replace function public.auto_match_import_item_employees_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if pg_trigger_depth() > 1 then
    return new;
  end if;
  perform public.auto_match_import_item_employees(new.id);
  return new;
end;
$$;

grant execute on function public.auto_match_import_item_employees_trigger() to authenticated;

drop trigger if exists trg_import_items_auto_match_employees on public.import_items;
create trigger trg_import_items_auto_match_employees
after update on public.import_items
for each row
when (new.status = 'VALIDATING')
execute function public.auto_match_import_item_employees_trigger();

-- Backfill current imports. Only previously unassigned rows are changed.
do $$
declare
  r record;
begin
  for r in
    select id
    from public.import_items
    where status in ('VALIDATING','PENDING_APPROVAL','AUTO_APPROVED','APPROVED')
  loop
    perform public.auto_match_import_item_employees(r.id);
  end loop;
end $$;

-- Recalculate canonical KPI after the backfill so operator_count/OEE reflect the
-- actual number of uniquely matched employees.
do $$
declare
  r record;
begin
  for r in
    select distinct import_item_id as id
    from public.import_item_rows
    where employee_id is not null
      and import_item_id in (
        select id from public.import_items
        where status in ('VALIDATING','PENDING_APPROVAL','AUTO_APPROVED','APPROVED')
      )
  loop
    perform public.recalculate_import_item_kpis(r.id);
  end loop;
end $$;

-- Remove the stale employee blocker when every OCR employee row is now assigned.
update public.import_items i
set pending_reasons = coalesce((
  select jsonb_agg(reason order by ord)
  from jsonb_array_elements_text(coalesce(i.pending_reasons, '[]'::jsonb)) with ordinality as x(reason, ord)
  where reason <> 'EMPLOYEE_UNMATCHED'
), '[]'::jsonb)
where i.status = 'PENDING_APPROVAL'
  and exists (select 1 from public.import_item_rows r where r.import_item_id = i.id)
  and not exists (select 1 from public.import_item_rows r where r.import_item_id = i.id and r.employee_id is null)
  and i.pending_reasons @> '["EMPLOYEE_UNMATCHED"]'::jsonb;
