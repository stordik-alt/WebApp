-- Řešení pro import produktů s duplicitním kódem
-- Přepíše unikátní index tak, aby omezoval jen aktivní produkty

BEGIN;

-- Odstranit starý unikátní index
DROP INDEX IF EXISTS products_code_unique ON public.products;

-- Vytvořit částečný unikátní index jen pro aktivní produkty
CREATE UNIQUE INDEX products_code_unique_active ON public.products (lower(code)) WHERE active = true;

COMMIT;
