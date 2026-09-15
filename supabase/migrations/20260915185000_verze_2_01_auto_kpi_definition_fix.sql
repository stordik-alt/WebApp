-- Verze 2.01 AUTO: definitive KPI definition.
-- Quality is NOT part of OEE.
-- Staffing capacity/operator count is NOT part of OEE or expected output.
-- Expected output is based on Product Profile norm and reconstructed productive minutes.

create or replace function public.fix_verze_2_01_auto_kpi_definition()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expected numeric;
  v_perf numeric;
  v_avail numeric;
begin
  v_perf := new.performance_pct;
  v_avail := new.availability_pct;

  if v_perf is not null and v_avail is not null then
    new.actual_oee_pct := v_perf * v_avail / 100.0;
  end if;

  if new.raw_data is null then
    new.raw_data := '{}'::jsonb;
  end if;

  if (new.raw_data -> 'calculation') is not null then
    v_expected := nullif(new.raw_data -> 'calculation' ->> 'reconstructed_effective_norm', '')::numeric;
    if v_expected is not null then
      new.raw_data := jsonb_set(
        new.raw_data,
        '{calculation,expected_output_at_current_staffing}',
        to_jsonb(v_expected),
        true
      );
      new.raw_data := jsonb_set(
        new.raw_data,
        '{calculation,expected_output}',
        to_jsonb(v_expected),
        true
      );
    end if;
    new.raw_data := jsonb_set(
      new.raw_data,
      '{calculation,oee_formula}',
      to_jsonb('(Výkon × Dostupnost) / 100'::text),
      true
    );
    new.raw_data := jsonb_set(
      new.raw_data,
      '{calculation,quality_in_oee}',
      to_jsonb(false),
      true
    );
    new.raw_data := jsonb_set(
      new.raw_data,
      '{calculation,staffing_factor_in_oee}',
      to_jsonb(false),
      true
    );
    new.raw_data := jsonb_set(
      new.raw_data,
      '{calculation,staffing_factor_in_expected}',
      to_jsonb(false),
      true
    );
  end if;

  return new;
end;
$$;

drop trigger if exists aaa_verze_2_01_auto_kpi_definition on public.import_item_hourly;
create trigger aaa_verze_2_01_auto_kpi_definition
before insert or update of performance_pct, availability_pct, actual_oee_pct, raw_data
on public.import_item_hourly
for each row
execute function public.fix_verze_2_01_auto_kpi_definition();

-- Recalculate OEE on already imported hourly rows without touching the stored
-- capacity/operator values used for display.
update public.import_item_hourly
set actual_oee_pct = performance_pct * availability_pct / 100.0
where performance_pct is not null
  and availability_pct is not null;
