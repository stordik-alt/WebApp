# Verze 2.0 AUTO — canonical KPI cleanup verification

## Purpose

The runtime now uses the explicit four-argument `auto_shift_productive_minutes` function. The legacy three-argument overload is removed by migration `20260914183500_verze_2_0_auto_kpi_canonical_cleanup.sql`.

## Canonical shift clock

- Ranní: 06:00–14:00, break 10:40–11:10
- Odpolední: 14:00–22:00, break 18:00–18:30
- Noční: 22:00–06:00, break 02:00–02:30
- Setup: 7 min at shift start
- Cleanup: 5 min at shift end
- Full productive shift: 438 min

## Canonical KPI formulas

Performance = (actual output / (norm per hour × productive minutes / 60)) × 100

OEE = (Performance × Availability × (capacity / operator count)) / 100

Shift aggregates are productive-minute weighted separately for Performance, Availability and OEE.

## Required SQL verification after migration

1. Confirm only one function exists:

```sql
select oid, proname, pg_get_function_identity_arguments(oid) as args
from pg_proc
where proname = 'auto_shift_productive_minutes'
order by oid;
```

Expected: exactly one row with `text, integer, text, boolean`.

2. Confirm the KPI trigger:

```sql
select tgname, tgenabled
from pg_trigger
where tgname = 'trg_import_items_recalculate_kpis';
```

Expected: one enabled trigger.

3. Re-test cutoff with the four explicit arguments:

```sql
select
  public.auto_shift_productive_minutes('ranni'::text, 10, '10:35'::text, true) as "10:35",
  public.auto_shift_productive_minutes('ranni'::text, 10, '10:45'::text, true) as "10:45",
  public.auto_shift_productive_minutes('ranni'::text, 11, '11:05'::text, true) as "11:05",
  public.auto_shift_productive_minutes('ranni'::text, 11, '11:15'::text, true) as "11:15";
```

Expected: 35, 40, 0, 5.

4. Run one real `VALIDATING` import through the application and verify that `import_item_hourly.performance_pct`, `import_item_hourly.actual_oee_pct`, `import_item_rows.performance`, `import_item_rows.available_time`, `import_item_rows.oee`, and the three `actual_shift_*` values in `import_items.ocr_data` agree with the canonical formulas.
