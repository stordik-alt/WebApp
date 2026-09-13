-- Globální hudba na pozadí aplikace
-- Skladba se ukládá do veřejného Supabase Storage bucketu background-music.
-- Soubor používaný aplikací má pevnou cestu: background-music/walk.mp3

insert into storage.buckets (id, name, public)
values ('background-music', 'background-music', true)
on conflict (id) do nothing;

-- Veřejné čtení skladby pro přehrávání všemi přihlášenými uživateli.
drop policy if exists "Background music public read" on storage.objects;
create policy "Background music public read"
on storage.objects
for select
to public
using (bucket_id = 'background-music');

-- Pouze administrátor může globální skladbu nahrát / nahradit / smazat.
drop policy if exists "Background music admin insert" on storage.objects;
create policy "Background music admin insert"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'background-music'
  and public.has_role(auth.uid(), 'admin'::public.app_role)
);

drop policy if exists "Background music admin update" on storage.objects;
create policy "Background music admin update"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'background-music'
  and public.has_role(auth.uid(), 'admin'::public.app_role)
)
with check (
  bucket_id = 'background-music'
  and public.has_role(auth.uid(), 'admin'::public.app_role)
);

drop policy if exists "Background music admin delete" on storage.objects;
create policy "Background music admin delete"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'background-music'
  and public.has_role(auth.uid(), 'admin'::public.app_role)
);
