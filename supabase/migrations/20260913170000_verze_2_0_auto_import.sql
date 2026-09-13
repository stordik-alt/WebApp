-- Verze 2.0 AUTO
-- Import staging/audit layer. Does not modify daily_records or master-data tables.

create table if not exists public.import_batches (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid null,
  status text not null default 'PROCESSING',
  total_items integer not null default 0,
  processed_items integer not null default 0,
  auto_items integer not null default 0,
  pending_items integer not null default 0,
  error_items integer not null default 0,
  completed_at timestamptz null,
  metadata jsonb not null default '{}'::jsonb,
  constraint import_batches_status_check check (
    status in ('PROCESSING','COMPLETED','COMPLETED_WITH_ERRORS','FAILED')
  ),
  constraint import_batches_total_items_check check (total_items >= 0),
  constraint import_batches_processed_items_check check (processed_items >= 0 and processed_items <= total_items),
  constraint import_batches_auto_items_check check (auto_items >= 0),
  constraint import_batches_pending_items_check check (pending_items >= 0),
  constraint import_batches_error_items_check check (error_items >= 0),
  constraint import_batches_counter_sum_check check (auto_items + pending_items + error_items <= total_items)
);

create table if not exists public.import_items (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.import_batches(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  screenshot_path text not null,
  source_hash text not null unique,
  status text not null default 'PROCESSING',
  error_message text null,
  work_date date null,
  shift text null,
  line text null,
  product_code text null,
  product_name text null,
  norm_per_hour numeric null,
  ocr_confidence numeric null,
  ocr_data jsonb not null default '{}'::jsonb,
  admin_corrections jsonb not null default '{}'::jsonb,
  pending_reasons jsonb not null default '[]'::jsonb,
  product_id uuid null references public.products(id) on delete restrict,
  product_match_status text not null default 'UNMATCHED',
  product_profile_status text not null default 'MISSING',
  approved_by uuid null,
  approved_at timestamptz null,
  rejected_by uuid null,
  rejected_at timestamptz null,
  rejection_reason text null,
  completed_at timestamptz null,
  constraint import_items_status_check check (
    status in ('PROCESSING','VALIDATING','AUTO_APPROVED','PENDING_APPROVAL','APPROVED','REJECTED','ERROR')
  ),
  constraint import_items_product_match_status_check check (
    product_match_status in ('EXACT','MATCHED','NEW','UNMATCHED')
  ),
  constraint import_items_product_profile_status_check check (
    product_profile_status in ('VALID','MISSING','INCOMPLETE')
  ),
  constraint import_items_ocr_confidence_check check (
    ocr_confidence is null or (ocr_confidence >= 0 and ocr_confidence <= 1)
  ),
  constraint import_items_rejection_reason_check check (
    status <> 'REJECTED' or nullif(trim(rejection_reason), '') is not null
  )
);

create table if not exists public.import_item_rows (
  id uuid primary key default gen_random_uuid(),
  import_item_id uuid not null references public.import_items(id) on delete cascade,
  row_index integer not null,
  ocr_employee_name text null,
  employee_id uuid null references public.employees(id) on delete restrict,
  position text null,
  oee numeric null,
  performance numeric null,
  available_time numeric null,
  confidence numeric null,
  raw_data jsonb not null default '{}'::jsonb,
  match_status text not null default 'UNMATCHED',
  validation_status text not null default 'PENDING',
  daily_record_id uuid null references public.daily_records(id) on delete set null,
  admin_corrections jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint import_item_rows_row_index_check check (row_index >= 0),
  constraint import_item_rows_position_check check (position is null or position in ('HA','TUP')),
  constraint import_item_rows_match_status_check check (
    match_status in ('EXACT','MATCHED','ASSIGNED_MANUALLY','CREATED_NEW','UNMATCHED')
  ),
  constraint import_item_rows_validation_status_check check (
    validation_status in ('PENDING','VALID','BLOCKED')
  ),
  constraint import_item_rows_confidence_check check (
    confidence is null or (confidence >= 0 and confidence <= 1)
  ),
  constraint import_item_rows_unique_row unique (import_item_id, row_index)
);

create table if not exists public.import_item_hourly (
  id uuid primary key default gen_random_uuid(),
  import_item_id uuid not null references public.import_items(id) on delete cascade,
  hour integer not null,
  product_code text null,
  role text null,
  actual_output numeric null,
  performance_pct numeric null,
  availability_pct numeric null,
  norm_per_hour numeric null,
  capacity numeric null,
  operator_count integer null,
  actual_oee_pct numeric null,
  raw_data jsonb not null default '{}'::jsonb,
  admin_corrections jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint import_item_hourly_hour_check check (hour >= 0),
  constraint import_item_hourly_role_check check (role is null or role in ('HA','TUP')),
  constraint import_item_hourly_unique_hour unique (import_item_id, hour)
);

create table if not exists public.import_item_events (
  id uuid primary key default gen_random_uuid(),
  import_item_id uuid not null references public.import_items(id) on delete cascade,
  created_at timestamptz not null default now(),
  actor_id uuid null,
  event_type text not null,
  from_status text null,
  to_status text null,
  payload jsonb not null default '{}'::jsonb
);

create index if not exists idx_import_items_batch_id on public.import_items(batch_id);
create index if not exists idx_import_items_status on public.import_items(status);
create index if not exists idx_import_items_work_date on public.import_items(work_date);
create index if not exists idx_import_items_product_id on public.import_items(product_id);
create index if not exists idx_import_item_rows_import_item_id on public.import_item_rows(import_item_id);
create index if not exists idx_import_item_rows_employee_id on public.import_item_rows(employee_id);
create index if not exists idx_import_item_rows_daily_record_id on public.import_item_rows(daily_record_id);
create index if not exists idx_import_item_hourly_import_item_id on public.import_item_hourly(import_item_id);
create index if not exists idx_import_item_events_import_item_id on public.import_item_events(import_item_id);
create index if not exists idx_import_item_events_created_at on public.import_item_events(created_at desc);

create or replace function public.set_import_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

DROP TRIGGER IF EXISTS trg_import_items_updated_at ON public.import_items;
CREATE TRIGGER trg_import_items_updated_at
BEFORE UPDATE ON public.import_items
FOR EACH ROW EXECUTE FUNCTION public.set_import_updated_at();

DROP TRIGGER IF EXISTS trg_import_item_rows_updated_at ON public.import_item_rows;
CREATE TRIGGER trg_import_item_rows_updated_at
BEFORE UPDATE ON public.import_item_rows
FOR EACH ROW EXECUTE FUNCTION public.set_import_updated_at();

DROP TRIGGER IF EXISTS trg_import_item_hourly_updated_at ON public.import_item_hourly;
CREATE TRIGGER trg_import_item_hourly_updated_at
BEFORE UPDATE ON public.import_item_hourly
FOR EACH ROW EXECUTE FUNCTION public.set_import_updated_at();

-- Keep batch counters as a derived operational cache of item states.
create or replace function public.refresh_import_batch_counters(p_batch_id uuid)
returns void
language plpgsql
as $$
begin
  update public.import_batches b
  set
    total_items = counts.total_items,
    processed_items = counts.processed_items,
    auto_items = counts.auto_items,
    pending_items = counts.pending_items,
    error_items = counts.error_items
  from (
    select
      count(*)::integer as total_items,
      count(*) filter (where status in ('AUTO_APPROVED','APPROVED','REJECTED','ERROR'))::integer as processed_items,
      count(*) filter (where status = 'AUTO_APPROVED')::integer as auto_items,
      count(*) filter (where status = 'PENDING_APPROVAL')::integer as pending_items,
      count(*) filter (where status = 'ERROR')::integer as error_items
    from public.import_items
    where batch_id = p_batch_id
  ) counts
  where b.id = p_batch_id;
end;
$$;

create or replace function public.refresh_import_batch_counters_from_item()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    perform public.refresh_import_batch_counters(old.batch_id);
    return old;
  end if;

  perform public.refresh_import_batch_counters(new.batch_id);
  if tg_op = 'UPDATE' and old.batch_id is distinct from new.batch_id then
    perform public.refresh_import_batch_counters(old.batch_id);
  end if;
  return new;
end;
$$;

DROP TRIGGER IF EXISTS trg_import_items_refresh_batch_counters ON public.import_items;
CREATE TRIGGER trg_import_items_refresh_batch_counters
AFTER INSERT OR UPDATE OF status, batch_id OR DELETE ON public.import_items
FOR EACH ROW EXECUTE FUNCTION public.refresh_import_batch_counters_from_item();

ALTER TABLE public.import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.import_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.import_item_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.import_item_hourly ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.import_item_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS import_batches_admin_all ON public.import_batches;
CREATE POLICY import_batches_admin_all
ON public.import_batches
FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS import_items_admin_all ON public.import_items;
CREATE POLICY import_items_admin_all
ON public.import_items
FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS import_item_rows_admin_all ON public.import_item_rows;
CREATE POLICY import_item_rows_admin_all
ON public.import_item_rows
FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS import_item_hourly_admin_all ON public.import_item_hourly;
CREATE POLICY import_item_hourly_admin_all
ON public.import_item_hourly
FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS import_item_events_admin_all ON public.import_item_events;
CREATE POLICY import_item_events_admin_all
ON public.import_item_events
FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

GRANT ALL ON public.import_batches TO service_role;
GRANT ALL ON public.import_items TO service_role;
GRANT ALL ON public.import_item_rows TO service_role;
GRANT ALL ON public.import_item_hourly TO service_role;
GRANT ALL ON public.import_item_events TO service_role;
