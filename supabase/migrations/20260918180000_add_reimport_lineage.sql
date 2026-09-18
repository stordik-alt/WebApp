-- Master Prompt section 7 (Reimport): lineage column so a reimport of a
-- rejected/blocked import can be traced back to the original record it
-- replaced, without ever deleting or overwriting that original.
alter table public.import_items
  add column if not exists reimport_of_id uuid references public.import_items(id);

create index if not exists idx_import_items_reimport_of_id on public.import_items(reimport_of_id) where reimport_of_id is not null;
