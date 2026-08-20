-- Přejmenování sloupce position_type_enum na position_type

-- 1. Přejmenování sloupce
ALTER TABLE public.employees RENAME COLUMN position_type_enum TO position_type;

-- 2. Vytvoření indexu (pokud ještě neexistuje)
CREATE INDEX IF NOT EXISTS idx_employees_position_type ON public.employees(position_type);
