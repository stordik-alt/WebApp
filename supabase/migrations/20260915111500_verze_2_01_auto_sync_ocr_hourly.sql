-- Verze 2.01 AUTO – preserve every OCR product/hour pair.
-- The client in older 2.0 code can still persist only the first row for a clock hour.
-- Before reconstruction, recover all remaining product/hour rows from ocr_data.hourly_metrics.

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

  if jsonb_typeof(v_data) <> 'array' then return; end if;

  insert into public.import_item_hourly (
    import_item_id, hour, product_code, role, actual_output,
    performance_pct, availability_pct, norm_per_hour, capacity,
    operator_count, actual_oee_pct, raw_data
  )
  select
    p_import_item_id,
    round(nullif(x ->> 'hour','')::numeric)::integer,
    nullif(trim(x ->> 'product_code'),'') ,
    case
      when nullif(trim(x ->> 'product_code'),'') ~* '^H_' then 'HA'
      when nullif(trim(x ->> 'product_code'),'') ~* '^T_' then 'TUP'
      else null
    end,
    nullif(x ->> 'actual_output','')::numeric,
    nullif(x ->> 'performance_pct','')::numeric,
    nullif(x ->> 'availability_pct','')::numeric,
    null,
    null,
    null,
    nullif(x ->> 'actual_oee_pct','')::numeric,
    x
  from jsonb_array_elements(v_data) as e(x)
  where nullif(x ->> 'hour','') ~ '^\d+(\.\d+)?$'
    and (nullif(trim(x ->> 'product_code'),'') is not null)
  on conflict (import_item_id, hour, coalesce(product_code, '')) do nothing;
end;
$$;

grant execute on function public.sync_import_item_hourly_from_ocr(uuid) to authenticated;

-- Ensure the synchronisation runs before reconstruction. The reconstruction
-- trigger remains the final 2.01 processing step.
drop trigger if exists zy_import_items_sync_ocr_hourly_2_01 on public.import_items;
create trigger zy_import_items_sync_ocr_hourly_2_01
after update on public.import_items
for each row
when (new.status = 'VALIDATING' and old.status is distinct from new.status)
execute function public.sync_import_item_hourly_from_ocr(new.id);
