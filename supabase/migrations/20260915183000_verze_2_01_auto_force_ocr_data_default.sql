-- Verze 2.01 AUTO: harden import_items OCR staging against clients
-- that explicitly send ocr_data = null.
-- The column has a DEFAULT, but a supplied JSON null bypasses the default.
-- Normalize that value before any other import_items BEFORE trigger runs.

create or replace function public.ensure_import_item_ocr_data()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.ocr_data is null then
    new.ocr_data := '{}'::jsonb;
  end if;
  return new;
end;
$$;

drop trigger if exists aaa_import_items_ensure_ocr_data on public.import_items;
create trigger aaa_import_items_ensure_ocr_data
before insert or update of ocr_data
on public.import_items
for each row
execute function public.ensure_import_item_ocr_data();
