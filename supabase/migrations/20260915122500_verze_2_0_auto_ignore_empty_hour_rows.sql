-- Verze 2.0/2.01 AUTO: do not persist the completely empty opening row
-- from the production screenshot (e.g. hour 6 with 0/0 and no product).
-- A genuinely productive row is preserved even when its output is temporarily 0
-- as long as a product is identified.

create or replace function public.auto_ignore_empty_import_hourly_row()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(new.actual_output, 0) = 0
     and nullif(trim(coalesce(new.product_code, '')), '') is null
     and coalesce(new.norm_per_hour, 0) = 0 then
    return null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_import_item_hourly_ignore_empty on public.import_item_hourly;
create trigger trg_import_item_hourly_ignore_empty
before insert or update on public.import_item_hourly
for each row
execute function public.auto_ignore_empty_import_hourly_row();

grant execute on function public.auto_ignore_empty_import_hourly_row() to authenticated;

delete from public.import_item_hourly
where coalesce(actual_output, 0) = 0
  and nullif(trim(coalesce(product_code, '')), '') is null
  and coalesce(norm_per_hour, 0) = 0;
