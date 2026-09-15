-- Verze 2.01 AUTO – restore reconstruction worker and trigger wrapper.
-- The previous repair migration correctly fixed trigger invocation, but the
-- database may not yet contain the reconstruction worker itself.
-- This migration is intentionally self-contained and does not touch main.

create or replace function public.reconstruct_import_item_hourly(p_import_item_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.import_items%rowtype;
  v_operator_count integer;
  r record;
  v_norm numeric;
  v_capacity numeric;
  v_ocr_norm numeric;
  v_downtime numeric;
  v_minutes numeric;
  v_expected numeric;
  v_perf numeric;
  v_oee numeric;
  v_avail numeric;
  v_source text;
  v_status text;
begin
  select * into v_item
  from public.import_items
  where id = p_import_item_id;

  if not found then
    return;
  end if;

  select count(*) into v_operator_count
  from public.import_item_rows
  where import_item_id = p_import_item_id
    and employee_id is not null;

  v_operator_count := greatest(1, coalesce(v_operator_count, 1));

  for r in
    select h.*
    from public.import_item_hourly h
    where h.import_item_id = p_import_item_id
    order by h.hour, h.id
  loop
    v_norm := null;
    v_capacity := null;

    select x.norm, x.capacity
      into v_norm, v_capacity
    from (
      select
        case
          when upper(coalesce(r.role,'')) = 'HA'
            and lower(regexp_replace(coalesce(pp.ha_subassy,''),'\\s+','','g')) = lower(regexp_replace(coalesce(r.product_code,''),'\\s+','','g'))
            then pp.h_norm_per_hour
          when upper(coalesce(r.role,'')) = 'TUP'
            and lower(regexp_replace(coalesce(pp.tup_subassy,''),'\\s+','','g')) = lower(regexp_replace(coalesce(r.product_code,''),'\\s+','','g'))
            then pp.t_norm_per_hour
          when lower(regexp_replace(coalesce(pp.ha_subassy,''),'\\s+','','g')) = lower(regexp_replace(coalesce(r.product_code,''),'\\s+','','g'))
            then pp.h_norm_per_hour
          when lower(regexp_replace(coalesce(pp.tup_subassy,''),'\\s+','','g')) = lower(regexp_replace(coalesce(r.product_code,''),'\\s+','','g'))
            then pp.t_norm_per_hour
        end as norm,
        case
          when upper(coalesce(r.role,'')) = 'HA'
            and lower(regexp_replace(coalesce(pp.ha_subassy,''),'\\s+','','g')) = lower(regexp_replace(coalesce(r.product_code,''),'\\s+','','g'))
            then pp.h_capacity
          when upper(coalesce(r.role,'')) = 'TUP'
            and lower(regexp_replace(coalesce(pp.tup_subassy,''),'\\s+','','g')) = lower(regexp_replace(coalesce(r.product_code,''),'\\s+','','g'))
            then pp.t_capacity
          when lower(regexp_replace(coalesce(pp.ha_subassy,''),'\\s+','','g')) = lower(regexp_replace(coalesce(r.product_code,''),'\\s+','','g'))
            then pp.h_capacity
          when lower(regexp_replace(coalesce(pp.tup_subassy,''),'\\s+','','g')) = lower(regexp_replace(coalesce(r.product_code,''),'\\s+','','g'))
            then pp.t_capacity
        end as capacity,
        pp.valid_from,
        pp.valid_to,
        pp.version_no
      from public.product_profiles pp
      where lower(regexp_replace(coalesce(pp.ha_subassy,''),'\\s+','','g')) = lower(regexp_replace(coalesce(r.product_code,''),'\\s+','','g'))
         or lower(regexp_replace(coalesce(pp.tup_subassy,''),'\\s+','','g')) = lower(regexp_replace(coalesce(r.product_code,''),'\\s+','','g'))
    ) x
    where (x.valid_from is null or x.valid_from <= v_item.work_date)
      and (x.valid_to is null or x.valid_to >= v_item.work_date)
    order by x.valid_to is null desc,
             x.valid_from desc nulls last,
             x.version_no desc nulls last
    limit 1;

    v_ocr_norm := nullif(
      coalesce(r.raw_data,'{}'::jsonb) ->> 'norm_per_hour',
      ''
    )::numeric;

    v_downtime := nullif(
      coalesce(r.raw_data,'{}'::jsonb) ->> 'downtime_minutes',
      ''
    )::numeric;

    if v_downtime is null then
      v_downtime := nullif(
        coalesce(r.raw_data,'{}'::jsonb) ->> 'downtime_min',
        ''
      )::numeric;
    end if;

    if v_downtime is null
       and r.availability_pct is not null
       and r.availability_pct >= 0
       and r.availability_pct < 100
       and (coalesce(r.raw_data,'{}'::jsonb) ? 'availability_is_clock_time') then
      v_downtime := 60 * (1 - r.availability_pct / 100);
    end if;

    v_downtime := greatest(0, least(60, coalesce(v_downtime, 0)));

    v_minutes := null;

    -- OCR interval norm is treated only as a time clue.
    -- The master Product Profile norm remains authoritative.
    if v_norm is not null
       and v_norm > 0
       and v_ocr_norm is not null
       and v_ocr_norm >= 0
       and v_ocr_norm < v_norm then
      v_minutes := greatest(
        0,
        least(60, (v_ocr_norm / v_norm) * 60)
      );
      v_source := 'OCR_interval_norm_divided_by_master_norm';
      v_status := 'DERIVED';
    elsif v_downtime > 0 then
      v_minutes := greatest(0, 60 - v_downtime);
      v_source := 'EXPLICIT_DOWNTIME';
      v_status := 'DERIVED';
    else
      v_minutes := public.auto_shift_productive_minutes(
        v_item.shift,
        r.hour,
        v_item.ocr_data ->> 'screenshot_time'
      );
      v_source := 'SHIFT_CLOCK_MODEL';
      v_status := 'CLOCK';
    end if;

    v_expected := case
      when v_norm is not null and v_capacity is not null then
        v_norm * v_minutes / 60.0 * v_capacity / v_operator_count
      else null
    end;

    v_perf := case
      when r.actual_output is not null
       and v_norm is not null
       and v_norm > 0
       and v_minutes > 0 then
        r.actual_output / (v_norm * v_minutes / 60.0) * 100
      else null
    end;

    v_avail := case
      when v_downtime < 60 then
        greatest(0, least(100, (60 - v_downtime) / 60.0 * 100))
      else 0
    end;

    v_oee := case
      when v_perf is not null
       and v_capacity is not null
       and v_capacity > 0 then
        v_perf * v_avail * (v_capacity / v_operator_count::numeric) / 100.0
      else null
    end;

    update public.import_item_hourly
    set norm_per_hour = v_norm,
        capacity = v_capacity,
        operator_count = v_operator_count,
        performance_pct = v_perf,
        availability_pct = case
          when v_downtime > 0 then v_avail
          else availability_pct
        end,
        actual_oee_pct = v_oee,
        raw_data = coalesce(raw_data,'{}'::jsonb) || jsonb_build_object(
          'calculation',
          coalesce(raw_data -> 'calculation','{}'::jsonb) || jsonb_build_object(
            'model_version','2.01-AUTO-reconstruction-v2',
            'reconstructed_productive_minutes',v_minutes,
            'reconstructed_effective_norm',case
              when v_norm is not null then v_norm * v_minutes / 60.0
              else null
            end,
            'expected_output_at_current_staffing',v_expected,
            'reconstruction_status',v_status,
            'reconstruction_source',v_source,
            'ocr_interval_norm',v_ocr_norm,
            'downtime_minutes',v_downtime,
            'master_norm',v_norm,
            'capacity',v_capacity,
            'operator_count',v_operator_count
          )
        )
    where id = r.id;
  end loop;
end;
$$;

grant execute on function public.reconstruct_import_item_hourly(uuid)
to authenticated;

-- Trigger functions cannot directly execute a worker with NEW.id.
-- Use a trigger wrapper and keep sync before reconstruction by trigger name.
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
