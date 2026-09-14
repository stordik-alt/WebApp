-- Verze 2.0 AUTO
-- KPI source of truth: 3. OCR sekvence / import_item_hourly.
-- Pred AUTO schvalenim vzdy propiseme vypocitany vykon, dostupnost a OEE
-- do VSECH zamestnaneckych staging radku. Tyto hodnoty nejsou OCR vstupem
-- ze sekvence 2 a nesmi zustat prazdne jen u jednoho radku.

create or replace function public.auto_approve_import_item(p_import_item_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_item public.import_items%rowtype;
  v_hour_count integer := 0;
  v_performance numeric;
  v_availability numeric;
  v_shift_oee numeric;
  v_now timestamptz := now();
  v_legacy jsonb;
begin
  select * into v_item
  from public.import_items
  where id = p_import_item_id
    and status = 'VALIDATING'
  for update;

  if not found then
    raise exception 'AUTO import není ve stavu VALIDATING nebo neexistuje.' using errcode = 'P0002';
  end if;

  -- KPI se berou výhradně z hodinové sekvence uložené v import_item_hourly.
  select count(*) into v_hour_count
  from public.import_item_hourly
  where import_item_id = v_item.id;

  if v_hour_count > 0 then
    select avg(performance_pct) filter (
      where performance_pct is not null
        and isfinite(performance_pct::double precision)
    ) into v_performance
    from public.import_item_hourly
    where import_item_id = v_item.id;

    select avg(availability_pct) filter (
      where availability_pct is not null
        and isfinite(availability_pct::double precision)
    ) into v_availability
    from public.import_item_hourly
    where import_item_id = v_item.id;

    begin
      v_shift_oee := nullif(trim(v_item.ocr_data ->> 'actual_shift_oee_pct'), '')::numeric;
      if v_shift_oee is not null and not isfinite(v_shift_oee::double precision) then
        v_shift_oee := null;
      end if;
    exception when others then
      v_shift_oee := null;
    end;
  end if;

  -- Vypočtené KPI musí být shodné pro každý zaměstnanecký záznam z daného
  -- screenshotu. Nepřebíráme hodnoty z OCR zaměstnanecké sekvence.
  if v_performance is not null and v_availability is not null and v_shift_oee is not null then
    update public.import_item_rows
    set performance = v_performance,
        available_time = v_availability,
        oee = v_shift_oee,
        raw_data = jsonb_set(
          jsonb_set(
            jsonb_set(coalesce(raw_data, '{}'::jsonb), '{performance}', to_jsonb(v_performance), true),
            '{available_time}', to_jsonb(v_availability), true
          ),
          '{oee}', to_jsonb(v_shift_oee), true
        ),
        updated_at = v_now
    where import_item_id = v_item.id
      and daily_record_id is null;
  end if;

  -- Kanonické validační a atomické vytvoření daily_records zůstává v již
  -- hardened legacy workeru. Ten nyní dostane kompletní KPI u každého řádku.
  v_legacy := public.auto_approve_import_item_legacy(v_item.id);
  return v_legacy;
end;
$$;

grant execute on function public.auto_approve_import_item(uuid) to authenticated;
