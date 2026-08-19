# E2E testy přístupu ke screenshotům

Cíl: ověřit, že screenshoty smí číst, nahrávat a mazat pouze uživatel s rolí správce, a to výhradně v adresáři `daily/`.

## Co se ověří

Databázová část (rychlé, spolehlivé):
1. Správce nahraje soubor do `daily/…` — projde.
2. Správce soubor přečte (stáhne / vytvoří podepsaný odkaz) — projde.
3. Správce soubor smaže — projde.
4. Správce zkusí nahrát mimo `daily/` (např. `other/…`) — zamítnuto.
5. Běžný přihlášený uživatel bez role správce: nahrání, čtení i mazání v `daily/` — zamítnuto.
6. Nepřihlášený návštěvník: čtení i nahrání — zamítnuto.
7. Běžný uživatel nevidí cizí soubor ani ve výpisu adresáře `daily/`.

Průchod UI (Playwright, jeden scénář):
- Přihlášení jako správce, otevření Denních dat, nahrání testovacího obrázku přes import screenshotu, ověření, že se objeví krok náhledu a soubor skutečně vznikne v úložišti pod `daily/`.
- Přihlášení jako běžný uživatel a ověření, že se zobrazí obrazovka „Přístup zamítnut“ a k importu se vůbec nedostane.

## Testovací účty a úklid

- Test si na začátku sám založí dva dočasné potvrzené účty (jeden s rolí správce, jeden bez role) s náhodným e‑mailem.
- Vše nahrané se ukládá pod prefix `daily/__test__/<náhodné id>/`.
- Na konci se smažou nahrané soubory i oba dočasné účty, ať v databázi nezůstává nic navíc.
- Pokud v prostředí chybí přístupové údaje pro správu účtů, testy se přeskočí místo selhání.

## Technické detaily

- Nový soubor `src/lib/storage-access.e2e.test.ts` spouštěný Vitestem; kvůli síťovým voláním poběží v Node prostředí s delším časovým limitem.
- Klienti: servisní klient (`SUPABASE_SERVICE_ROLE_KEY`) pouze pro založení/smazání účtů a vložení řádku do `user_roles`; samotné operace nad úložištěm se dělají přihlášenými klienty s publikovatelným klíčem, aby se testovala reálná pravidla přístupu.
- Odmítnutí se ověřuje kontrolou chyby (`error` není null) a zároveň tím, že objekt v úložišti nevznikl/nezmizel — ne pouze zachycením výjimky.
- Playwright skript `tests/e2e/screenshots.spec.ts` (a přidání devDependency `@playwright/test`, samostatný skript `test:e2e`, aby se neplet do rychlých unit testů) běží proti běžícímu dev serveru na localhostu.
- Vitest bude pro tyto testy potřebovat načtení `.env` (přes `loadEnv`/`dotenv` v konfiguraci testů), aby měl URL, publikovatelný i servisní klíč.
