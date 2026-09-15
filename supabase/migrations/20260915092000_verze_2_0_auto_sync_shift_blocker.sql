-- Verze 2.0 AUTO: keep the persisted shift and pending_reasons in sync.
-- OCR imports can be inserted directly as PENDING_APPROVAL, so an UPDATE-only
-- resolver is too late. For screenshots, the clock hour is authoritative:
-- 00:00-05:59 = Noční, 06:00-13:59 = Ranní, 14:00-21:59 = Odpolední,
-- 22:00-23:59 = Noční.

create or replace function public.auto_resolve_import_shift_from_clock(
  p_shift text,
  p_screenshot_time text
)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v_hour integer;
  v_shift text := lower(trim(coalesce(p_shift, '')));
begin
  if p_screenshot_time is not null
     and p_screenshot_time ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$' then
    v_hour := split_part(p_screenshot_time, ':', 1)::integer;
    if v_hour < 6 or v_hour >= 22 then return 'Noční'; end if;
    if v_hour < 14 then return 'Ranní'; end if;
    return 'Odpolední';
  end if;

  if v_shift like 'ra%' then return 'Ranní'; end if;
  if v_shift like 'od%' then return 'Odpolední'; end if;
  if v_shift like 'no%' or v_shift like 'night%' then return 'Noční'; end if;
  return null;
end;
$$;

grant execute on function public.auto_resolve_import_shift_from_clock(text, text) to authenticated;

create or replace function public.trg_import_items_sync_shift_from_clock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shift text;
begin
  if pg_trigger_depth() > 1 then
    return new;
  end if;

  v_shift := public.auto_resolve_import_shift_from_clock(
    new.shift,
    nullif(trim(coalesce(new.ocr_data ->> 'screenshot_time', '')), '')
  );

  if v_shift is not null then
    new.shift := v_shift;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_import_items_sync_shift_from_clock on public.import_items;
create trigger trg_import_items_sync_shift_from_clock
before insert or update on public.import_items
for each row
execute function public.trg_import_items_sync_shift_from_clock();

-- Rebuild only the stale shift blocker for already persisted imports.
-- Do not touch other blockers or KPI values here.
update public.import_items i
set pending_reasons = (
  select coalesce(jsonb_agg(reason order by reason), '[]'::jsonb)
  from (
    select distinct jsonb_array_elements_text(coalesce(i.pending_reasons, '[]'::jsonb)) reason
    where reason <> 'MISSING_SHIFT'
    union
    select 'MISSING_SHIFT'
    where i.shift is null or btrim(i.shift) = ''
  ) x
)
where i.status = 'PENDING_APPROVAL';
