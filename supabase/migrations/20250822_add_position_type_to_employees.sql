-- Přidání sloupce position_type do tabulky employees

-- 1. Přidání sloupce position_type
ALTER TABLE public.employees ADD COLUMN position_type text;

-- 2. Vytvoření enum typu pro position_type (pokud neexistuje)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'employee_position_type') THEN
    CREATE TYPE public.employee_position_type AS ENUM ('handler', 'vlnař', 'operator');
  END IF;
END $$;

-- 3. Přidání sloupce s enum typem
ALTER TABLE public.employees ADD COLUMN position_type_enum public.employee_position_type;

-- 4. Výchozí hodnoty pro existující zaměstnance (všichni jsou operator)
UPDATE public.employees SET position_type_enum = 'operator' WHERE position_type_enum IS NULL;

-- 5. Změna sloupce na NOT NULL
ALTER TABLE public.employees ALTER COLUMN position_type_enum SET NOT NULL;

-- 6. Vytvoření indexu pro position_type
CREATE INDEX idx_employees_position_type ON public.employees(position_type_enum);

-- 7. Přidání RLS
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
