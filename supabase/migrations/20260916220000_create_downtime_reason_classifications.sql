-- Editable list of downtime reasons and their Ovlivnitelná/Neovlivnitelná
-- (controllable/uncontrollable) classification, replacing the hardcoded
-- keyword regex in reconstruct_import_item_hourly (V19). Exact OCR wording
-- of a downtime reason is not reliable, so matching is fuzzy: both the
-- stored reason_text and the incoming OCR text are diacritic-stripped and
-- lowercased, and a row matches if its normalized text is a substring of
-- the normalized OCR text.
create table if not exists public.downtime_reason_classifications (
  id uuid primary key default gen_random_uuid(),
  reason_text text not null,
  category text not null check (category in ('controllable', 'uncontrollable')),
  note text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.normalize_downtime_reason(p_text text)
returns text
language sql
immutable
as $$
  select lower(translate(
    coalesce(p_text, ''),
    'ěščřžýáíéůúňťďóĚŠČŘŽÝÁÍÉŮÚŇŤĎÓ',
    'escrzyaieuuntdoESCRZYAIEUUNTDO'
  ));
$$;

create unique index if not exists downtime_reason_classifications_normalized_idx
  on public.downtime_reason_classifications (public.normalize_downtime_reason(reason_text));

create or replace function public.classify_downtime_reason(p_reason text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select drc.category
      from public.downtime_reason_classifications drc
      where drc.active
        and public.normalize_downtime_reason(p_reason) like '%' || public.normalize_downtime_reason(drc.reason_text) || '%'
        and public.normalize_downtime_reason(drc.reason_text) <> ''
      order by length(drc.reason_text) desc
      limit 1
    ),
    case when coalesce(trim(p_reason), '') = '' then 'none' else 'unclassified' end
  );
$$;

grant execute on function public.classify_downtime_reason(text) to authenticated;

alter table public.downtime_reason_classifications enable row level security;

drop policy if exists downtime_reason_classifications_select on public.downtime_reason_classifications;
create policy downtime_reason_classifications_select
  on public.downtime_reason_classifications for select to authenticated using (true);

drop policy if exists downtime_reason_classifications_insert_admin on public.downtime_reason_classifications;
create policy downtime_reason_classifications_insert_admin
  on public.downtime_reason_classifications for insert to authenticated
  with check (public.has_role(auth.uid(), 'admin'::public.app_role));

drop policy if exists downtime_reason_classifications_update_admin on public.downtime_reason_classifications;
create policy downtime_reason_classifications_update_admin
  on public.downtime_reason_classifications for update to authenticated
  using (public.has_role(auth.uid(), 'admin'::public.app_role))
  with check (public.has_role(auth.uid(), 'admin'::public.app_role));

drop policy if exists downtime_reason_classifications_delete_admin on public.downtime_reason_classifications;
create policy downtime_reason_classifications_delete_admin
  on public.downtime_reason_classifications for delete to authenticated
  using (public.has_role(auth.uid(), 'admin'::public.app_role));

drop trigger if exists downtime_reason_classifications_updated_at on public.downtime_reason_classifications;
create trigger downtime_reason_classifications_updated_at
  before update on public.downtime_reason_classifications
  for each row execute function public.set_updated_at();

insert into public.downtime_reason_classifications (reason_text, category, note) values
  ('Porucha vlny', 'uncontrollable', 'Porucha výrobního zařízení'),
  ('Porucha/čištění zařízení', 'uncontrollable', 'Porucha nebo čištění stroje'),
  ('Změna výroby', 'uncontrollable', 'Přechod na jiný produkt'),
  ('Změna produktu', 'uncontrollable', 'Přechod na jiný produkt'),
  ('Nedostatek rámečků', 'uncontrollable', 'Chybí vstupní materiál / rámečky'),
  ('Manipulace s krabicemi nebo vozíky', 'uncontrollable', 'Logistická manipulace'),
  ('Doplňování materiálu', 'uncontrollable', 'Doplnění vstupního materiálu'),
  ('WC', 'controllable', 'Osobní přestávka'),
  ('Pití', 'controllable', 'Osobní přestávka')
on conflict (public.normalize_downtime_reason(reason_text)) do nothing;
