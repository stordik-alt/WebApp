-- Verze 2.0 AUTO: resolve OCR shift conflicts from authoritative clock/hour span.
-- OCR can misread the shift label (e.g. "Ranní") while the screenshot/table
-- clearly belongs to a night shift crossing midnight. The canonical KPI model
-- must use the real clock interval, otherwise productive minutes become zero
-- and Performance/OEE remain NULL.

create or replace function public.auto_resolve_import_shift(
  p_shift text,
  p_screenshot_time text,
  p_import_item_id uuid
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shift text := lower(trim(coalesce(p_shift, '')));
  v_time text := nullif(trim(coalesce(p_screenshot_time, '')), '');
  v_hour integer;
  v_min integer;
  v_has_night boolean := false;
  v_has_morning boolean := false;
  v_has_afternoon boolean := false;
begin
  if v_time ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$' then
    v_hour := split_part(v_time, ':', 1)::integer;
    v_min := split_part(v_time, ':', 2)::integer;
  else
    v_hour := null;
    v_min := null;
  end if;

  select
    bool_or(h.hour >= 22 or h.hour <= 5),
    bool_or(h.hour between 6 and 13),
    bool_or(h.hour between 14 and 21)
  into v_has_night, v_has_morning, v_has_afternoon
  from public.import_item_hourly h
  where h.import_item_id = p_import_item_id;

  v_has_night := coalesce(v_has_night, false);
  v_has_morning := coalesce(v_has_morning, false);
  v_has_afternoon := coalesce(v_has_afternoon, false);

  -- A screenshot taken before 06:00 together with 22:00–05:00 hourly rows
  -- is unambiguously a Noční shift crossing midnight.
  if v_hour is not null and v_hour < 6 and v_has_night then
    return 'Noční';
  end if;

  -- A screenshot taken from 06:00–13:59 with morning rows is Ranní.
  if v_hour is not null and v_hour >= 6 and v_hour < 14 and v_has_morning then
    return 'Ranní';
  end if;

  -- A screenshot taken from 14:00–21:59 with afternoon rows is Odpolední.
  if v_hour is not null and v_hour >= 14 and v_hour < 22 and v_has_afternoon then
    return 'Odpolední';
  end if;

  -- If OCR shift is absent/invalid, infer from the hourly span.
  if v_shift not like 'ra%' and v_shift not like 'od%' and v_shift not like 'no%' then
    if v_has_night and not v_has_morning and not v_has_afternoon then
      return 'Noční';
    elsif v_has_morning and not v_has_afternoon and not v_has_night then
      return 'Ranní';
    elsif v_has_afternoon and not v_has_morning and not v_has_night then
      return 'Odpolední';
    end if;
  end if;

  -- Preserve a valid OCR shift when the clock/hour evidence does not conflict.
  if v_shift like 'ra%' then return 'Ranní'; end if;
  if v_shift like 'od%' then return 'Odpolední'; end if;
  if v_shift like 'no%' or v_shift like 'night%' then return 'Noční'; end if;

  return null;
end;
$$;

grant execute on function public.auto_resolve_import_shift(text, text, uuid) to authenticated;

create or replace function public.trg_import_items_resolve_shift()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_resolved text;
begin
  if pg_trigger_depth() > 1 then
    return new;
  end if;

  if new.status in ('VALIDATING', 'PENDING_APPROVAL', 'AUTO_APPROVED', 'APPROVED') then
    v_resolved := public.auto_resolve_import_shift(
      new.shift,
      nullif(trim(coalesce(new.ocr_data ->> 'screenshot_time', '')), ''),
      new.id
    );
    if v_resolved is not null then
      new.shift := v_resolved;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_import_items_resolve_shift on public.import_items;
create trigger trg_import_items_resolve_shift
before update on public.import_items
for each row
execute function public.trg_import_items_resolve_shift();

-- Re-resolve already persisted imports so the canonical KPI trigger can use
-- the corrected shift on the next validation/recalculation.
update public.import_items i
set shift = public.auto_resolve_import_shift(
  i.shift,
  nullif(trim(coalesce(i.ocr_data ->> 'screenshot_time', '')), ''),
  i.id
)
where i.shift is not null
  and exists (
    select 1
    from public.import_item_hourly h
    where h.import_item_id = i.id
  );
