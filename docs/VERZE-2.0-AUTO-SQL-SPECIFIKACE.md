# Verze 2.0 AUTO – finální SQL specifikace databázové vrstvy

## 0. Účel

Tento dokument převádí databázový koncept verze 2.0 AUTO do konkrétní SQL specifikace. Je podkladem pro první implementační migraci na branchi `2.0-AUTO`.

**Tato specifikace sama o sobě databázi nemění.** Nejprve musí být zkontrolována; teprve po potvrzení se vytvoří a spustí implementační migration.

---

## 1. Zásady návrhu

1. Stávající `employees`, `products`, `product_profiles` a `daily_records` zůstávají autoritativními tabulkami.
2. `import_batches` a `import_items` jsou orchestrace importu, nikoliv nový master-data systém.
3. OCR je návrh. Původní OCR výsledek se zachovává a administrátorské opravy jsou auditovatelné.
4. Jeden originální screenshot se ukládá pouze jednou a je propojen s `import_item`.
5. Nový zaměstnanec ani nový produkt/Product Profile nevzniká automaticky bez zásahu správce.
6. Schválení importu není totéž jako vytvoření Product Profile nebo zaměstnance.
7. Do `daily_records` se zapisuje až po automatickém schválení nebo explicitním schválení administrátorem.
8. Import musí být idempotentní a nesmí obcházet existující unikátní omezení `daily_records`.
9. Pro schvalování se použije existující approval/audit mechanismus; nevytváří se paralelní obecný approval systém.
10. Serverové operace, které vytvářejí nebo mění business data, musí respektovat bezpečnostní model a RLS.

---

## 2. Tabulka `import_batches`

Jeden řádek = jedna hromadná importní dávka.

### Sloupce

| Sloupec | SQL typ | NULL | Výchozí | Pravidlo |
|---|---|---:|---|---|
| `id` | `uuid` | NE | `gen_random_uuid()` | PK |
| `created_at` | `timestamptz` | NE | `now()` | čas založení dávky |
| `created_by` | `uuid` | ANO | – | ID přihlášeného uživatele; FK na auth uživatele dle stávajícího modelu |
| `status` | `text` | NE | `'PROCESSING'` | pouze povolené stavy |
| `total_items` | `integer` | NE | `0` | >= 0 |
| `processed_items` | `integer` | NE | `0` | >= 0 |
| `auto_items` | `integer` | NE | `0` | >= 0 |
| `pending_items` | `integer` | NE | `0` | >= 0 |
| `error_items` | `integer` | NE | `0` | >= 0 |
| `completed_at` | `timestamptz` | ANO | – | vyplní se při ukončení dávky |
| `metadata` | `jsonb` | NE | `'{}'::jsonb` | technická metadata dávky |

### Povolené stavy

```text
PROCESSING
COMPLETED
COMPLETED_WITH_ERRORS
FAILED
```

`COMPLETED_WITH_ERRORS` znamená, že dávka doběhla, ale minimálně jedna položka skončila stavem `ERROR`. Položky `PENDING_APPROVAL` nejsou technickou chybou dávky.

### Kontroly

```sql
CHECK (total_items >= 0)
CHECK (processed_items >= 0)
CHECK (auto_items >= 0)
CHECK (pending_items >= 0)
CHECK (error_items >= 0)
CHECK (processed_items <= total_items)
CHECK (auto_items + pending_items + error_items <= total_items)
CHECK (status IN ('PROCESSING','COMPLETED','COMPLETED_WITH_ERRORS','FAILED'))
```

Početní sloupce jsou denormalizovaný provozní přehled. Pravdivost jednotlivých položek je vždy v `import_items`.

---

## 3. Tabulka `import_items`

Jeden řádek = jeden originální screenshot v rámci dávky.

### Sloupce

| Sloupec | SQL typ | NULL | Výchozí | Význam |
|---|---|---:|---|---|
| `id` | `uuid` | NE | `gen_random_uuid()` | PK |
| `batch_id` | `uuid` | NE | – | FK `import_batches.id` |
| `created_at` | `timestamptz` | NE | `now()` | vytvoření |
| `updated_at` | `timestamptz` | NE | `now()` | poslední změna |
| `screenshot_path` | `text` | NE | – | cesta k originálu v privátním bucketu `screenshots` |
| `source_hash` | `text` | NE | – | SHA-256/hash originálního souboru pro idempotenci |
| `status` | `text` | NE | `'PROCESSING'` | stav položky |
| `error_message` | `text` | ANO | – | technická chyba |
| `work_date` | `date` | ANO | – | OCR/finální datum výroby |
| `shift` | `text` | ANO | – | OCR/finální směna |
| `line` | `text` | ANO | – | OCR/finální pracoviště/linka |
| `product_code` | `text` | ANO | – | OCR/finální kód produktu |
| `product_name` | `text` | ANO | – | OCR/finální název produktu |
| `norm_per_hour` | `numeric` | ANO | – | OCR/finální norma, pokud je na screenshotu jedna společná hodnota |
| `ocr_confidence` | `numeric` | ANO | – | agregovaná confidence OCR |
| `ocr_data` | `jsonb` | NE | `'{}'::jsonb` | kompletní strukturovaný OCR výsledek |
| `admin_corrections` | `jsonb` | NE | `'{}'::jsonb` | strukturovaný přehled administrátorských oprav |
| `pending_reasons` | `jsonb` | NE | `'[]'::jsonb` | seznam blokujících důvodů |
| `product_id` | `uuid` | ANO | – | FK na `products.id`, pokud je produkt známý/přiřazený |
| `product_match_status` | `text` | NE | `'UNMATCHED'` | stav párování produktu |
| `product_profile_status` | `text` | NE | `'MISSING'` | stav ověření Product Profile |
| `daily_record_id` | `uuid` | ANO | – | FK na vzniklý `daily_records.id` |
| `approved_by` | `uuid` | ANO | – | administrátor explicitně schvalující položku |
| `approved_at` | `timestamptz` | ANO | – | čas explicitního schválení |
| `rejected_by` | `uuid` | ANO | – | administrátor zamítající položku |
| `rejected_at` | `timestamptz` | ANO | – | čas zamítnutí |
| `rejection_reason` | `text` | ANO | – | důvod zamítnutí |
| `completed_at` | `timestamptz` | ANO | – | dokončení zpracování položky |

### Povolené stavy

```text
PROCESSING
VALIDATING
AUTO_APPROVED
PENDING_APPROVAL
APPROVED
REJECTED
ERROR
```

### Stavová pravidla

- `PROCESSING` → OCR/zpracování probíhá.
- `VALIDATING` → OCR je hotové a probíhá validační rozhodnutí.
- `AUTO_APPROVED` → všechny podmínky jsou splněny bez zásahu administrátora; následuje vytvoření `daily_records`.
- `PENDING_APPROVAL` → existuje nejméně jeden blokující problém.
- `APPROVED` → administrátor vyřešil všechny blokace a explicitně schválil.
- `REJECTED` → administrátor import odmítl; důvod je povinný.
- `ERROR` → technické zpracování nebylo dokončeno.

### Kontroly

```sql
CHECK (status IN (
  'PROCESSING',
  'VALIDATING',
  'AUTO_APPROVED',
  'PENDING_APPROVAL',
  'APPROVED',
  'REJECTED',
  'ERROR'
))
CHECK (product_match_status IN ('EXACT','MATCHED','NEW','UNMATCHED'))
CHECK (product_profile_status IN ('VALID','MISSING','INCOMPLETE'))
CHECK (ocr_confidence IS NULL OR (ocr_confidence >= 0 AND ocr_confidence <= 1))
```

`source_hash` musí být indexován a v kombinaci s relevantním importním kontextem použit pro idempotentní kontrolu. Samotný hash souboru nesmí bez další kontroly znamenat, že lze ignorovat nový batch; opakovaný import stejného souboru musí vrátit vazbu na původní položku místo vytvoření duplicitního výrobního záznamu.

---

## 4. Tabulka `import_item_rows`

Jeden řádek = jeden zaměstnanec rozpoznaný na screenshotu.

Tato tabulka je nutná proto, že jeden screenshot může obsahovat více zaměstnanců a každý z nich může mít jiný výsledek párování/validace.

| Sloupec | SQL typ | NULL | Výchozí | Význam |
|---|---|---:|---|---|
| `id` | `uuid` | NE | `gen_random_uuid()` | PK |
| `import_item_id` | `uuid` | NE | – | FK `import_items.id` |
| `row_index` | `integer` | NE | – | pořadí řádku na screenshotu |
| `ocr_employee_name` | `text` | ANO | – | přesná hodnota z OCR |
| `employee_id` | `uuid` | ANO | – | FK `employees.id` |
| `position` | `text` | ANO | – | HA/TUP |
| `oee` | `numeric` | ANO | – | OEE |
| `performance` | `numeric` | ANO | – | výkon |
| `available_time` | `numeric` | ANO | – | dostupný čas |
| `confidence` | `numeric` | ANO | – | confidence konkrétního řádku |
| `raw_data` | `jsonb` | NE | `'{}'::jsonb` | původní OCR řádek |
| `match_status` | `text` | NE | `'UNMATCHED'` | výsledek párování |
| `validation_status` | `text` | NE | `'PENDING'` | výsledek validace |
| `daily_record_id` | `uuid` | ANO | – | výsledný denní záznam, pokud vznikne |
| `admin_corrections` | `jsonb` | NE | `'{}'::jsonb` | opravy tohoto řádku |
| `created_at` | `timestamptz` | NE | `now()` | vytvoření |
| `updated_at` | `timestamptz` | NE | `now()` | poslední změna |

### `match_status`

```text
EXACT
MATCHED
ASSIGNED_MANUALLY
CREATED_NEW
UNMATCHED
```

### `validation_status`

```text
PENDING
VALID
BLOCKED
```

### Kontroly

```sql
CHECK (row_index >= 0)
CHECK (position IS NULL OR position IN ('HA','TUP'))
CHECK (match_status IN ('EXACT','MATCHED','ASSIGNED_MANUALLY','CREATED_NEW','UNMATCHED'))
CHECK (validation_status IN ('PENDING','VALID','BLOCKED'))
CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1))
UNIQUE (import_item_id, row_index)
```

---

## 5. Tabulka `import_item_hourly`

Jeden řádek = jedna hodinová metrika OCR importu.

| Sloupec | SQL typ | NULL | Význam |
|---|---|---:|---|
| `id` | `uuid` | NE | PK |
| `import_item_id` | `uuid` | NE | FK `import_items.id` |
| `hour` | `integer` | NE | hodina/pořadí |
| `planned` | `numeric` | ANO | plán |
| `actual` | `numeric` | ANO | skutečnost |
| `oee` | `numeric` | ANO | OEE |
| `performance` | `numeric` | ANO | výkon |
| `availability` | `numeric` | ANO | dostupnost |
| `raw_data` | `jsonb` | NE | původní OCR data |
| `admin_corrections` | `jsonb` | NE | administrátorské opravy |
| `created_at` | `timestamptz` | NE | `now()` |
| `updated_at` | `timestamptz` | NE | `now()` |

```sql
UNIQUE (import_item_id, hour)
CHECK (hour >= 0)
```

Rozsah hodnot metrik se nebude v první migraci natvrdo omezovat na konkrétní procenta, dokud nebude potvrzen přesný formát současného `daily_records`/hourly modelu. Validace rozsahu patří do aplikační/serverové vrstvy podle skutečného datového modelu.

---

## 6. Foreign keys

Navrhované vazby:

```text
import_items.batch_id
  → import_batches.id
  ON DELETE CASCADE

import_items.product_id
  → products.id
  ON DELETE RESTRICT

import_items.daily_record_id
  → daily_records.id
  ON DELETE SET NULL

import_item_rows.import_item_id
  → import_items.id
  ON DELETE CASCADE

import_item_rows.employee_id
  → employees.id
  ON DELETE RESTRICT

import_item_rows.daily_record_id
  → daily_records.id
  ON DELETE SET NULL

import_item_hourly.import_item_id
  → import_items.id
  ON DELETE CASCADE
```

Vazba `created_by`/`approved_by`/`rejected_by` na auth uživatele bude implementována podle skutečné auth/RLS struktury projektu; před migrací je nutné použít přesný existující FK pattern a nevymýšlet paralelní uživatelskou tabulku.

---

## 7. Indexy

Minimálně:

```sql
CREATE INDEX idx_import_items_batch_id
  ON import_items(batch_id);

CREATE INDEX idx_import_items_status
  ON import_items(status);

CREATE INDEX idx_import_items_source_hash
  ON import_items(source_hash);

CREATE INDEX idx_import_items_work_date
  ON import_items(work_date);

CREATE INDEX idx_import_items_product_id
  ON import_items(product_id);

CREATE INDEX idx_import_items_daily_record_id
  ON import_items(daily_record_id);

CREATE INDEX idx_import_item_rows_import_item_id
  ON import_item_rows(import_item_id);

CREATE INDEX idx_import_item_rows_employee_id
  ON import_item_rows(employee_id);

CREATE INDEX idx_import_item_rows_daily_record_id
  ON import_item_rows(daily_record_id);

CREATE INDEX idx_import_item_hourly_import_item_id
  ON import_item_hourly(import_item_id);
```

---

## 8. Idempotence a duplicity

### 8.1 Stejný screenshot

Originální soubor se před založením položky zahashuje. Hash slouží jako první ochrana proti opakovanému importu stejného screenshotu.

Opakovaný import stejného screenshotu:

```text
stejný source_hash
      ↓
najdi existující import_item
      ↓
nevytvářej nový daily_record
```

Pokud je nutné tentýž screenshot záměrně zpracovat znovu po opravě OCR, musí se použít explicitní reprocess mechanismus; běžný import jej nesmí považovat za nový výrobní záznam.

### 8.2 Stejný výrobní záznam

Před vytvořením `daily_records` se musí respektovat současné UNIQUE omezení:

```text
employee_id + work_date + shift + line
```

Import nesmí tento constraint obcházet.

Pokud už záznam existuje, serverová logika musí rozhodnout mezi:

- bezpečným navázáním importu na existující záznam, pokud jde o stejný zdroj,
- nebo `PENDING_APPROVAL`, pokud nelze jednoznačně určit, zda jde o nový/opakovaný výrobní záznam.

Automatické přepsání existujícího denního záznamu se v první verzi 2.0 AUTO nepovoluje.

---

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

Jakmile selže jediná blokující podmínka:

```text
PENDING_APPROVAL
```

---

## 10. `pending_reasons`

Použijí se stabilní kódy místo závislosti pouze na zobrazovaném textu.

Navržené kódy:

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

UI si kódy převede na český popis.

---

## 11. Admin editace a audit

`ocr_data` je neměnný záznam původního OCR výsledku.

Aktuální pracovní hodnoty jsou ve strukturovaných sloupcích a/nebo v `import_item_rows`.

`admin_corrections` je pomocná strukturovaná stopa, ale nenahrazuje existující audit mechanismus.

Každá schválená změna důležité hodnoty musí být dohledatelná přes existující audit infrastrukturu projektu:

```text
field
old_value
new_value
changed_by
changed_at
```

Před implementací je nutné zkontrolovat konkrétní strukturu `approval_audit_log` a navázat 2.0 AUTO na ni, nikoliv vytvořit druhý obecný audit systém.

---

## 12. Screenshot Storage

Použije se současný privátní Supabase Storage bucket:

```text
screenshots
```

`import_items.screenshot_path` obsahuje pouze cestu/klíč objektu.

Screenshot se nekopíruje do nové databázové tabulky jako blob.

Přístup k originálu musí zůstat omezený existujícím bezpečnostním modelem. UI pro `Ke schválení` může získat dočasný/signed URL způsobem, který již projekt používá pro privátní screenshoty.

---

## 13. RLS

Nové tabulky musí mít RLS zapnuté.

Základní pravidlo první verze:

- čtení importních dat: administrátor,
- vytvoření dávky: administrátor/serverová importní operace,
- změna položky: administrátor/serverová importní operace,
- explicitní schválení/zamítnutí: administrátor,
- běžný klient nesmí obejít RLS přímým zápisem do `daily_records`, `employees` nebo `products`.

Přesná SQL podoba policy musí vycházet z existující helper funkce/role používané v projektu. Před migrací se musí ověřit aktuální admin policy, aby nevznikla druhá definice role.

---

## 14. Trigger `updated_at`

`import_items`, `import_item_rows` a `import_item_hourly` mají aktualizovat `updated_at` při změně.

Pokud projekt již obsahuje společnou funkci typu `set_updated_at`, použije se existující funkce. Nová duplicitní trigger funkce se nevytváří, pokud není potřeba.

---

## 15. Vytváření `daily_records`

Vytvoření výsledného `daily_record` musí být serverová, transakční operace:

```text
import_item
  ↓
validace
  ↓
vytvoření daily_record
  ↓
uložení daily_record_id
  ↓
finalizace import_item
```

Pokud vytvoření `daily_record` selže, import item nesmí zůstat ve stavu `AUTO_APPROVED` bez výsledku. Operace musí být atomická nebo musí být možné bezpečně pokračovat/retryovat.

---

## 16. Nový produkt / Product Profile

`import_items` neobsahuje kopii Product Profile.

Při `NEW_PRODUCT` nebo `MISSING_PRODUCT_PROFILE` zůstává položka `PENDING_APPROVAL`.

Administrátor:

```text
otevře modal Product Profile
→ OCR hodnoty předvyplněny
→ všechny hodnoty editovatelné
→ vytvoří/aktualizuje Product Profile
→ systém znovu validuje import_item
→ pokud nezůstává blokace, zpřístupní Schválit
```

Vytvoření profilu samo o sobě nemění `import_item` na `APPROVED`.

---

## 17. Nový zaměstnanec

`import_item_rows.employee_id` zůstává `NULL`, dokud není zaměstnanec nalezen/přiřazen/vytvořen.

Administrátor může:

```text
Přiřadit stávajícího zaměstnance
```

nebo:

```text
Vytvořit nového zaměstnance
→ modal s OCR předvyplněním
→ editace
→ vytvoření master data
→ přiřazení employee_id
→ znovuvalidování položky
```

Vytvoření zaměstnance samo o sobě není schválením výrobních dat.

---

## 18. Co první migration NEMÁ dělat

První migration nesmí:

- měnit existující unikátní constraint `daily_records(employee_id, work_date, shift, line)`,
- vytvářet paralelní tabulku zaměstnanců,
- vytvářet paralelní tabulku produktů,
- vytvářet nový Product Profile model,
- vytvářet druhý obecný approval systém,
- automaticky vytvářet nové zaměstnance,
- automaticky vytvářet nové produkty jako schválená master data,
- měnit legacy HA/TUP model bez samostatného důvodu,
- mazat současná screenshot data,
- obcházet RLS pomocí klientského service-role klíče.

---

## 19. Doporučené pořadí implementace

### Migration 1
Pouze databázová struktura:

```text
import_batches
import_items
import_item_rows
import_item_hourly
FK
CHECK constraints
UNIQUE constraints
indexy
RLS základ
updated_at triggers
```

### Poté

1. serverová importní orchestrace,
2. idempotence/hash,
3. validace OCR,
4. AUTO workflow,
5. `Ke schválení`,
6. Product Profile modal,
7. zaměstnanecké přiřazení/vytvoření,
8. schválení/zamítnutí,
9. transakční zápis do `daily_records`,
10. audit a testy.

---

## 20. Kontrolní bod před SQL migrací

Před vytvořením migration je nutné ještě jednou ověřit proti aktuálnímu repozitáři:

- přesný typ a FK `employees.id`,
- přesný typ a FK `products.id`,
- přesný typ `daily_records.id`,
- přesný auth/admin helper používaný v RLS,
- přesnou strukturu `approval_audit_log`,
- existující `updated_at` trigger funkci,
- přesný model hodinových dat,
- aktuální Storage policy pro bucket `screenshots`.

Teprve po této kontrole se má vytvořit implementační SQL migration.

---

## 21. Výsledek návrhu

Cílová struktura:

```text
                    import_batches
                         │
                         │ 1:N
                         ▼
                    import_items
                    /     |      \
                   /      |       \
                  ▼       ▼        ▼
      import_item_rows  hourly   OCR JSON
              │
              ▼
          employees

      import_items ─────► products
            │
            └───────────► product_profiles (nepřímá aplikační validace)
            │
            └───────────► daily_records
```

Princip zůstává:

```text
SCREENSHOT
    ↓
OCR
    ↓
VALIDACE
    ├── OK ─────────────► AUTO ─────► daily_records
    │
    └── PROBLÉM ───────► PENDING
                              ↓
                    ADMINISTRÁTORSKÁ OPRAVA
                              ↓
                           APPROVED
                              ↓
                        daily_records
```
