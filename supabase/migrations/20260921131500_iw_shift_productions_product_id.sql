begin;

alter table public.iw_shift_productions
  add column if not exists product_id uuid null references public.products(id);

create index if not exists iw_shift_productions_product_idx
  on public.iw_shift_productions (product_id);

commit;
