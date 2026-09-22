begin;

create or replace function public.sync_workplace_to_iw_workstation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.iw_workstations
  set code = new.code,
      workplace_id = new.id,
      area = new.area,
      group_name = coalesce(nullif(new.line_name, ''), new.workplace_name),
      display_name = new.workplace_name,
      updated_at = now()
  where workplace_id = new.id;

  if not found then
    update public.iw_workstations
    set workplace_id = new.id,
        area = new.area,
        group_name = coalesce(nullif(new.line_name, ''), new.workplace_name),
        display_name = new.workplace_name,
        updated_at = now()
    where code = new.code and workplace_id is null;
  end if;

  if not exists (select 1 from public.iw_workstations where workplace_id = new.id) then
    insert into public.iw_workstations
      (code, workplace_id, area, group_name, display_name, sort_order,
       requires_ha_qual, requires_tup_qual, is_secondary, active, note)
    values
      (new.code, new.id, new.area,
       coalesce(nullif(new.line_name, ''), new.workplace_name),
       new.workplace_name, 0,
       new.area in ('HA', 'BOTH'),
       new.area in ('TUP', 'BOTH'),
       false, true, null)
    on conflict (code) do update
      set workplace_id = excluded.workplace_id,
          area = excluded.area,
          group_name = excluded.group_name,
          display_name = excluded.display_name,
          active = true,
          updated_at = now();
  end if;

  return new;
end;
$$;

drop trigger if exists sync_workplace_to_iw_workstation on public.workplaces;
create trigger sync_workplace_to_iw_workstation
after insert or update of code, line_name, workplace_name, area
on public.workplaces
for each row execute function public.sync_workplace_to_iw_workstation();

do $$
declare w record;
begin
  for w in select id, code, line_name, workplace_name, area from public.workplaces loop
    update public.iw_workstations
    set workplace_id = w.id, area = w.area,
        group_name = coalesce(nullif(w.line_name, ''), w.workplace_name),
        display_name = w.workplace_name, active = true, updated_at = now()
    where workplace_id = w.id;

    if not found then
      update public.iw_workstations
      set workplace_id = w.id, area = w.area,
          group_name = coalesce(nullif(w.line_name, ''), w.workplace_name),
          display_name = w.workplace_name, active = true, updated_at = now()
      where code = w.code and workplace_id is null;
    end if;

    if not exists (select 1 from public.iw_workstations where workplace_id = w.id) then
      insert into public.iw_workstations
        (code, workplace_id, area, group_name, display_name, sort_order,
         requires_ha_qual, requires_tup_qual, is_secondary, active, note)
      values
        (w.code, w.id, w.area,
         coalesce(nullif(w.line_name, ''), w.workplace_name),
         w.workplace_name, 0,
         w.area in ('HA', 'BOTH'), w.area in ('TUP', 'BOTH'),
         false, true, null);
    end if;
  end loop;
end $$;

commit;