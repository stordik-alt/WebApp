-- Regression test for Master Prompt section 11 (Import Trace ID): every
-- import_items row must get a human-readable, unique trace_id automatically
-- on insert (IMPORT-YYYYMMDD-XXXXXXXX, derived from created_at and the row's
-- own id), without the application ever having to set it explicitly.
--
-- Entirely non-destructive: everything happens inside begin/rollback.

begin;

do $$
declare
  v_batch_id uuid;
  v_item_id_1 uuid;
  v_item_id_2 uuid;
  v_trace_1 text;
  v_trace_2 text;
  v_created_at timestamptz := '2026-09-18 10:00:00+00';
begin
  insert into public.import_batches (id, status, total_items) values (gen_random_uuid(), 'PROCESSING', 2) returning id into v_batch_id;

  insert into public.import_items (id, batch_id, status, screenshot_path, source_hash, created_at)
  values (gen_random_uuid(), v_batch_id, 'PROCESSING', 'test/trace-id-1.png', 'test-trace-id-hash-1', v_created_at)
  returning id into v_item_id_1;

  insert into public.import_items (id, batch_id, status, screenshot_path, source_hash, created_at)
  values (gen_random_uuid(), v_batch_id, 'PROCESSING', 'test/trace-id-2.png', 'test-trace-id-hash-2', v_created_at)
  returning id into v_item_id_2;

  select trace_id into v_trace_1 from public.import_items where id = v_item_id_1;
  select trace_id into v_trace_2 from public.import_items where id = v_item_id_2;

  if v_trace_1 is null or v_trace_2 is null then
    raise exception 'TEST FAILED: trace_id must be auto-generated on insert, got % and %', v_trace_1, v_trace_2;
  end if;

  if v_trace_1 !~ '^IMPORT-20260918-[0-9A-F]{8}$' then
    raise exception 'TEST FAILED: trace_id % does not match the expected IMPORT-YYYYMMDD-XXXXXXXX format', v_trace_1;
  end if;

  if v_trace_1 = v_trace_2 then
    raise exception 'TEST FAILED: two different import_items rows got the same trace_id %', v_trace_1;
  end if;

  -- An explicitly supplied trace_id must be preserved, not overwritten.
  declare
    v_item_id_3 uuid;
    v_trace_3 text;
  begin
    insert into public.import_items (id, batch_id, status, screenshot_path, source_hash, created_at, trace_id)
    values (gen_random_uuid(), v_batch_id, 'PROCESSING', 'test/trace-id-3.png', 'test-trace-id-hash-3', v_created_at, 'IMPORT-CUSTOM-TEST')
    returning id into v_item_id_3;
    select trace_id into v_trace_3 from public.import_items where id = v_item_id_3;
    if v_trace_3 is distinct from 'IMPORT-CUSTOM-TEST' then
      raise exception 'TEST FAILED: an explicitly supplied trace_id must be preserved, got %', v_trace_3;
    end if;
  end;
end $$;

rollback;

-- If this script reaches here, import_items.trace_id is auto-generated
-- correctly, is unique per row, and no fixture data was left behind.
