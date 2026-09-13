# Verze 2.0 AUTO – databázový koncept

## Účel
Tento dokument je závazným technickým základem pro návrh databázové části automatického importu screenshotů. Při implementaci se od něj nemáme odchylovat bez předchozí dohody.

## 1. Existující autoritativní vazby

### Zaměstnanci
- `daily_records.employee_id` → `employees.id`.
- Zaměstnanec je master-data záznam; OCR jméno není jeho náhradou.
- Nového zaměstnance automatický import nevytváří bez zásahu správce.
- Při nerozpoznaném zaměstnanci je možné přiřadit existujícího nebo vytvořit nového a následně jej přiřadit.

### Spolupracovníci
- `daily_record_coworkers.record_id` → `daily_records.id`.
- `daily_record_coworkers.coworker_id` → `employees.id`.
- Jeden denní záznam může mít další spolupracovníky.

### Produkty
- `daily_records.product_id` → `products.id` je autoritativní vazba produktu.
- `daily_records.product` zůstává kvůli kompatibilitě jako textová hodnota.
- `products.code` je unikátní identita produktu.
- Nový produkt nesmí být automaticky vytvořen jako aktivní master data bez schválení správce.

### Product Profile
- `product_profiles` je podle současného runtime autoritativní model pro HA/TUP párování, normy, kapacity a verze.
- Profil používá kódy `ha_subassy` a `tup_subassy`, nikoliv přímé FK na `products`.
- Aktivní profil je určen `valid_to IS NULL`.
- Profil je verzovaný pomocí `valid_from`, `valid_to` a `version_no`.
- Legacy `product_families`, `product_norms` a `product_relationships` nesmí být pro nový AUTO workflow použity jako další paralelní zdroj pravdy.

## 2. Stávající denní záznam
`daily_records` obsahuje mimo jiné:
- `employee_id`
- `product_id`
- `product`
- `work_date`
- `shift`
- `line`
- `source`
- `screenshot_path`
- `import_batch_id`
- `approval_status`

Existuje unikátní omezení na kombinaci `employee_id + work_date + shift + line`. Nový import musí tuto skutečnost respektovat a nesmí vytvářet duplicitní denní záznamy.

## 3. Navrhované nové entity pro 2.0 AUTO

### `import_batches`
Jeden záznam reprezentuje jednu spuštěnou dávku importu.

Navrhovaný účel polí:
- `id`
- `created_at`
- `created_by`
- `status`
- `total_items`
- `processed_items`
- `pending_items`
- `error_items`
- případná metadata dávky

### `import_items`
Jeden záznam reprezentuje jeden zpracovávaný screenshot.

Navrhovaný účel polí:
- `id`
- `batch_id` → `import_batches.id`
- `screenshot_path`
- `status`
- `work_date`
- `shift`
- `line`
- OCR výsledek / strukturovaná data
- OCR confidence
- důvod stavu `pending`
- vazba na případný `daily_record_id`
- informace o vytvoření/přiřazení master dat
- timestamps pro audit

Konkrétní datové typy a názvy polí budou potvrzeny před vytvořením první migrace.

## 4. Stavový tok

```text
Screenshot
   ↓
OCR
   ↓
Validace
   ├── bez problému → AUTO → daily_records
   │
   └── problém → KE SCHVÁLENÍ
                    ↓
             oprava / přiřazení /
             vytvoření master dat
                    ↓
                 SCHVÁLIT
                    ↓
              daily_records
```

## 5. Screenshot
- Originální screenshot musí být dohledatelný u každé položky, která skončí v `Ke schválení`.
- Má se použít současný privátní Supabase Storage bucket `screenshots` a existující `screenshot_path` mechanismus.
- Jeden screenshot může být zdrojem více problémů; nemá se zbytečně ukládat více kopií.

## 6. Nový produkt
Workflow:
1. OCR rozpozná produkt.
2. Produkt není znám / nemá odpovídající profil.
3. `import_item` přejde do `pending`.
4. Správce vidí screenshot a OCR hodnoty.
5. Tlačítko `Vytvořit nový Product Profile` otevře existující nebo společný Product Profile formulář v modálním okně.
6. OCR předvyplněné hodnoty jsou všechny editovatelné.
7. Správce profil vytvoří.
8. Teprve potom je dostupné `Schválit`.
9. Schválení dokončí zpracování importu.

Samotné vytvoření Product Profile není automatické schválení výrobních dat.

## 7. Nerozpoznaný zaměstnanec
Správce musí mít dvě možnosti:
- `Přiřadit stávajícího zaměstnance` – vyhledat a vybrat existujícího zaměstnance.
- `Vytvořit nového zaměstnance` – otevřít modální formulář, předvyplnit OCR údaje, umožnit jejich opravu, vytvořit zaměstnance a následně jej přiřadit k čekajícímu záznamu.

Po vyřešení vazby na zaměstnance je možné záznam schválit, pokud nejsou jiné nevyřešené problémy.

## 8. Editace OCR
Všechny údaje předvyplněné OCR musí být před schválením editovatelné. OCR je pouze návrh, nikdy absolutní zdroj pravdy.

## 9. Schvalování
- Bezpečné a kompletní záznamy se zpracují automaticky.
- Problematické záznamy jdou do `Ke schválení`.
- `Schválit` je možné až po vyřešení všech blokujících problémů.
- `Zamítnout` musí být možné a ideálně s důvodem.
- Schvalování má využít existující approval mechanismus a audit, nikoliv vytvořit druhý paralelní systém.

## 10. Duplicity a idempotence
- Batch import nesmí vytvořit duplicitní `daily_records`.
- Je nutné respektovat existující unikátní omezení `employee_id + work_date + shift + line`.
- Před implementací musí být přesně definována idempotentní kontrola screenshotu/import itemu a chování při opakovaném importu stejného screenshotu.

## 11. Bezpečnost
- Business tabulky jsou aktuálně omezené na administrátory.
- Screenshot Storage je privátní a administrátorský.
- Automatický import musí používat bezpečný server-side mechanismus a nesmí obcházet RLS nebezpečným klientským zápisem.

## 12. Zásadní architektonické pravidlo
Nový AUTO workflow nebude vytvářet další paralelní produktový, zaměstnanecký ani schvalovací model. Má pouze orchestrálně propojit existující master data a `daily_records` pomocí `import_batches` a `import_items`.
