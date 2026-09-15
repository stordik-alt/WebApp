-- Verze 2.01 AUTO – repair hourly multi-product synchronization and trigger calls.
-- Fixes the PostgreSQL trigger syntax and avoids an invalid ON CONFLICT target
-- for the expression-based unique index used by import_item_hourly.

-- The old 2.0 constraint allowed only one product per clock hour.
alter table public.import_item_hourly
drop constraint if exists import_item_hourly_unique_hour;

-- A clock hour may contain multiple products. Uniqueness is per import/hour/product.
create unique index if not exists idx_import_item_hourly_unique_product_hour
on public.import_item_hourly (import_item_id, hour, coalesce(product_code, ''));

-- Rebuild the OCR -> hourly synchronisation function.
create or replace function public.sync_import_item_hourly_from_ocr(p_import_item_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_data jsonb;
begin
  select coalesce(ocr_data -> 'hourly_metrics', '[]'::jsonb)
    into v_data
  from public.import_items
  where id = p_import_item_id;

  if jsonb_typeof(v_data) <> 'array' then
    return;
  end if;

  insert into public.import_item_hourly (
    import_item_id,
    hour,
    product_code,
    role,
    actual_output,
    performance_pct,
    availability_pct,
    norm_per_hour,
    capacity,
    operator_count,
    actual_oee_pct,
    raw_data
  )
  select
    p_import_item_id,
    round(nullif(x ->> 'hour', '')::numeric)::integer,
    nullif(trim(x ->> 'product_code'), ''),
    case
      when nullif(trim(x ->> 'product_code'), '') ~* '^H_' then 'HA'
      when nullif(trim(x ->> 'product_code'), '') ~* '^T_' then 'TUP'
      else null
    end,
    nullif(x ->> 'actual_output', '')::numeric,
    nullif(x ->> 'performance_pct', '')::numeric,
    nullif(x ->> 'availability_pct', '')::numeric,
    null,
    null,
    null,
    nullif(x ->> 'actual_oee_pct', '')::numeric,
    x
  from jsonb_array_elements(v_data) as e(x)
  where nullif(x ->> 'hour', '') ~ '^\\d+(\\.\\d+)?$'
    and nullif(trim(x ->> 'product_code'), '') is not null
  on conflict do nothing;
end;
$$;

grant execute on function public.sync_import_item_hourly_from_ocr(uuid)
to authenticated;

-- PostgreSQL trigger functions receive NEW automatically. The wrapper therefore
-- calls the UUID worker with NEW.id and returns NEW.
create or replace function public.trg_sync_import_item_hourly_from_ocr_2_01()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.sync_import_item_hourly_from_ocr(new.id);
  return new;
end;
$$;

grant execute on function public.trg_sync_import_item_hourly_from_ocr_2_01()
to authenticated;

drop trigger if exists zy_import_items_sync_ocr_hourly_2_01
on public.import_items;

create trigger zy_import_items_sync_ocr_hourly_2_01
after update on public.import_items
for each row
when (
  new.status = 'VALIDATING'
  and old.status is distinct from new.status
)
execute function public.trg_sync_import_item_hourly_from_ocr_2_01();

-- Repair the reconstruction trigger in the same way.
create or replace function public.trg_reconstruct_import_item_hourly_2_01()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.reconstruct_import_item_hourly(new.id);
  return new;
end;
$$;

grant execute on function public.trg_reconstruct_import_item_hourly_2_01()
to authenticated;

drop trigger if exists zz_import_items_reconstruct_2_01
on public.import_items;

create trigger zz_import_items_reconstruct_2_01
after update on public.import_items
for each row
when (
  new.status = 'VALIDATING'
  and old.status is distinct from new.status
)
execute function public.trg_reconstruct_import_item_hourly_2_01();
