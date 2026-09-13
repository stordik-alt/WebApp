# Verze 2.0 AUTO – SQL specifikace databázové vrstvy

## Stav

Toto je implementační specifikace pro branch `2.0-AUTO`. Byla upravena po kontrole skutečného datového modelu projektu.

První implementační migrace této specifikace je oddělená od tohoto dokumentu.

## 1. Zásady

1. `employees`, `products`, `product_profiles` a `daily_records` zůstávají autoritativní business tabulky.
2. `import_batches` = jedna hromadná dávka; `import_items` = jeden originální screenshot.
3. Jeden screenshot může obsahovat více zaměstnanců, proto `daily_record_id` patří pouze do `import_item_rows`, nikoli do `import_items`.
4. OCR je pouze návrh. `ocr_data` zůstává nezměněné a opravy administrátora se zapisují samostatně.
5. Nový zaměstnanec, produkt ani Product Profile se při OCR importu nevytváří automaticky.
6. Vytvoření Product Profile nebo zaměstnance není samo o sobě schválením výrobních dat.
7. `daily_records` vznikají až po automatickém schválení bezpečné položky nebo po explicitním schválení administrátorem.
8. Původní screenshot je v privátním bucketu `screenshots` a `screenshot_path` se ukládá u `import_items`.
9. Idempotence je založena na SHA-256 originálního souboru. `source_hash` je globálně unikátní; opakovaný import stejného souboru nesmí vytvořit nový importní záznam.
10. Stávající `daily_records` má unikátní klíč `(employee_id, work_date, shift, line)`. Importní logika proto musí konflikt vyhodnotit jako blokaci/chybu a nesmí jej obcházet.
11. Product Profile se páruje současným mechanismem projektu podle kódů; tato migrace nezavádí nový FK `product_profiles → products`.
12. Importní tabulky jsou od začátku chráněny RLS stejně jako ostatní administrativní business data.

## 2. `import_batches`

Jeden řádek = jedna dávka screenshotů.

```sql
id uuid primary key default gen_random_uuid()
created_at timestamptz not null default now()
created_by uuid null
status text not null default 'PROCESSING'
total_items integer not null default 0
processed_items integer not null default 0
auto_items integer not null default 0
pending_items integer not null default 0
error_items integer not null default 0
completed_at timestamptz null
metadata jsonb not null default '{}'::jsonb
```

Povolené stavy: `PROCESSING`, `COMPLETED`, `COMPLETED_WITH_ERRORS`, `FAILED`.

Kontroly: všechny počty `>= 0`, `processed_items <= total_items`, `auto_items + pending_items + error_items <= total_items`.

`created_by` zůstává bez nového aplikačního users FK; ukládá se `auth.uid()` podle stávajícího modelu.

## 3. `import_items`

Jeden řádek = jeden originální screenshot.

```sql
id uuid primary key default gen_random_uuid()
batch_id uuid not null references public.import_batches(id) on delete cascade
created_at timestamptz not null default now()
updated_at timestamptz not null default now()
screenshot_path text not null
source_hash text not null unique
status text not null default 'PROCESSING'
error_message text null
work_date date null
shift text null
line text null
product_code text null
product_name text null
norm_per_hour numeric null
ocr_confidence numeric null
ocr_data jsonb not null default '{}'::jsonb
admin_corrections jsonb not null default '{}'::jsonb
pending_reasons jsonb not null default '[]'::jsonb
product_id uuid null references public.products(id) on delete restrict
product_match_status text not null default 'UNMATCHED'
product_profile_status text not null default 'MISSING'
approved_by uuid null
approved_at timestamptz null
rejected_by uuid null
rejected_at timestamptz null
rejection_reason text null
completed_at timestamptz null
```

Důležitá změna proti původnímu návrhu: **`daily_record_id` zde není**. Screenshot může obsahovat více zaměstnanců a tedy více `daily_records`.

Stavy: `PROCESSING`, `VALIDATING`, `AUTO_APPROVED`, `PENDING_APPROVAL`, `APPROVED`, `REJECTED`, `ERROR`.

`product_match_status`: `EXACT`, `MATCHED`, `NEW`, `UNMATCHED`.

`product_profile_status`: `VALID`, `MISSING`, `INCOMPLETE`.

`ocr_confidence`: pokud není `NULL`, musí být v intervalu `0..1`.

`source_hash` je SHA-256 originálního souboru a má globální UNIQUE constraint. Tím je stejný screenshot jednoznačně identifikovatelný i při opakovaném importu do jiné dávky.

## 4. `import_item_rows`

Jeden řádek = jeden zaměstnanec rozpoznaný na screenshotu.

```sql
id uuid primary key default gen_random_uuid()
import_item_id uuid not null references public.import_items(id) on delete cascade
row_index integer not null
ocr_employee_name text null
employee_id uuid null references public.employees(id) on delete restrict
position text null
oee numeric null
performance numeric null
available_time numeric null
confidence numeric null
raw_data jsonb not null default '{}'::jsonb
match_status text not null default 'UNMATCHED'
validation_status text not null default 'PENDING'
daily_record_id uuid null references public.daily_records(id) on delete set null
admin_corrections jsonb not null default '{}'::jsonb
created_at timestamptz not null default now()
updated_at timestamptz not null default now()
```

`row_index >= 0`, `position` je `HA`, `TUP` nebo `NULL`.

`match_status`: `EXACT`, `MATCHED`, `ASSIGNED_MANUALLY`, `CREATED_NEW`, `UNMATCHED`.

`validation_status`: `PENDING`, `VALID`, `BLOCKED`.

UNIQUE `(import_item_id, row_index)`.

`confidence` musí být `0..1`, pokud není `NULL`.

## 5. `import_item_hourly`

Tato tabulka ukládá OCR hodinové údaje v podobě odpovídající současnému OCR modelu; nenahrazuje existující business model `daily_records`.

```sql
id uuid primary key default gen_random_uuid()
import_item_id uuid not null references public.import_items(id) on delete cascade
hour integer not null
product_code text null
role text null
actual_output numeric null
performance_pct numeric null
availability_pct numeric null
norm_per_hour numeric null
capacity numeric null
operator_count integer null
actual_oee_pct numeric null
raw_data jsonb not null default '{}'::jsonb
admin_corrections jsonb not null default '{}'::jsonb
created_at timestamptz not null default now()
updated_at timestamptz not null default now()
```

UNIQUE `(import_item_id, hour)`, `hour >= 0`, `role` je `HA`, `TUP` nebo `NULL`.

Rozsahy OEE/výkonu/dostupnosti se v SQL migraci nezamykají na konkrétní procenta; validace se provede v importní/serverové vrstvě podle skutečného OCR a business formátu.

Současný OCR kód skutečně vrací mimo jiné `hour`, `product_code`, `role`, `actual_output`, `performance_pct`, `availability_pct`, `norm_per_hour`, `capacity`, `operator_count` a `actual_oee_pct`; proto tato struktura odpovídá reálnému zdroji místo původního obecného `planned/actual` modelu.

## 6. `import_item_events`

Dedikovaný audit životního cyklu importu. Nejde o paralelní obecný approval systém.

```sql
id uuid primary key default gen_random_uuid()
import_item_id uuid not null references public.import_items(id) on delete cascade
created_at timestamptz not null default now()
actor_id uuid null
event_type text not null
from_status text null
to_status text null
payload jsonb not null default '{}'::jsonb
```

Události mohou zachytit například `OCR_COMPLETED`, `VALIDATION`, `ADMIN_CORRECTION`, `EMPLOYEE_ASSIGNED`, `EMPLOYEE_CREATED`, `PRODUCT_CREATED`, `PROFILE_CREATED`, `AUTO_APPROVED`, `APPROVED`, `REJECTED`, `ERROR`.

Tím se zachová audit OCR, oprav, přiřazení/master-data akcí a schválení bez změny významu existujícího `approval_audit_log`.

## 7. Vazby a indexy

```text
import_batches 1 ── N import_items
import_items   1 ── N import_item_rows
import_items   1 ── N import_item_hourly
import_items   1 ── N import_item_events
import_item_rows N ── 1 employees
import_item_rows N ── 1 daily_records
import_items   N ── 1 products
```

Minimální indexy:

```sql
CREATE INDEX idx_import_items_batch_id ON public.import_items(batch_id);
CREATE INDEX idx_import_items_status ON public.import_items(status);
CREATE INDEX idx_import_items_work_date ON public.import_items(work_date);
CREATE INDEX idx_import_items_product_id ON public.import_items(product_id);
CREATE INDEX idx_import_item_rows_import_item_id ON public.import_item_rows(import_item_id);
CREATE INDEX idx_import_item_rows_employee_id ON public.import_item_rows(employee_id);
CREATE INDEX idx_import_item_rows_daily_record_id ON public.import_item_rows(daily_record_id);
CREATE INDEX idx_import_item_hourly_import_item_id ON public.import_item_hourly(import_item_id);
CREATE INDEX idx_import_item_events_import_item_id ON public.import_item_events(import_item_id);
```

`source_hash` je řešen UNIQUE constraintem, který zároveň vytvoří unikátní index.

## 8. Idempotence a duplicity

### Stejný screenshot

Originální soubor se před založením položky zahashuje. Hash slouží jako první ochrana proti opakovanému importu stejného screenshotu.

```text
stejný source_hash
      ↓
najdi existující import_item
      ↓
nevytvářej nový daily_record
```

Pokud je nutné tentýž screenshot záměrně zpracovat znovu po opravě OCR, musí se použít explicitní reprocess mechanismus; běžný import jej nesmí považovat za nový výrobní záznam.

### Stejný výrobní záznam

Před vytvořením `daily_records` se musí respektovat současné UNIQUE omezení:

```text
employee_id + work_date + shift + line
```

Import nesmí tento constraint obcházet.

Pokud už záznam existuje, serverová logika musí rozhodnout mezi bezpečným navázáním importu na existující záznam, pokud jde o stejný zdroj, nebo `PENDING_APPROVAL`, pokud nelze jednoznačně určit, zda jde o nový/opakovaný výrobní záznam.

Automatické přepsání existujícího denního záznamu se v první verzi 2.0 AUTO nepovoluje.

## 9. Pravidla pro `AUTO_APPROVED`

Položka smí být automaticky schválena pouze tehdy, pokud:

```text
OCR dokončen
AND datum validní
AND směna validní
AND pracoviště validní
AND produkt nalezen
AND Product Profile validní
AND všechny zaměstnanecké řádky mají přiřazeného zaměstnance
AND HA/TUP je validní
AND povinné metriky jsou validní
AND neexistuje blokující OCR/validace chyba
AND nebyla zjištěna duplicita
```

Jakmile selže jediná blokující podmínka, stav je `PENDING_APPROVAL`.

## 10. `pending_reasons`

Použijí se stabilní kódy místo závislosti pouze na zobrazovaném textu.

```text
NEW_PRODUCT
PRODUCT_NOT_FOUND
MISSING_PRODUCT_PROFILE
INCOMPLETE_PRODUCT_PROFILE
UNMATCHED_EMPLOYEE
INVALID_EMPLOYEE_DATA
INVALID_DATE
INVALID_SHIFT
INVALID_LINE
INVALID_POSITION
INVALID_METRIC
DUPLICATE_SCREENSHOT
DUPLICATE_PRODUCTION_RECORD
OCR_LOW_CONFIDENCE
MISSING_REQUIRED_DATA
OTHER
```

## 11. Co migrace záměrně NEDĚLÁ

- nevytváří nové zaměstnance automaticky,
- nevytváří produkty automaticky,
- nevytváří Product Profile automaticky,
- nemění strukturu `daily_records`,
- nepřepisuje legacy HA/TUP vztahy,
- nezavádí nový obecný approval systém,
- neobchází RLS,
- neřeší samotné OCR ani UI importu.

## 12. Následující implementační krok

`Screenshot → OCR → normalizace → match produktu → ověření Product Profile → match zaměstnanců → validace → AUTO / KE SCHVÁLENÍ → daily_records`.

Při `NEW` produktu se čeká na administrátora. Ten může vytvořit Product Profile z předvyplněného OCR formuláře; teprve poté lze importní položku samostatně schválit.

Při `UNMATCHED` zaměstnanci se čeká na administrátora. Ten může přiřadit existujícího zaměstnance nebo vytvořit nového zaměstnance a přiřadit jej k čekajícímu řádku. Teprve poté lze importní položku schválit.
