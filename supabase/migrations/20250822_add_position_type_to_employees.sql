-- Přidání sloupce position_type do tabulky employees
-- POZOR: Tento skript předpokládá, že tabulka employees již existuje

-- 1. Přidání sloupce position_type_enum (pokud ještě neexistuje)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'employees' AND column_name = 'position_type_enum'
  ) THEN
    -- Vytvoření enum typu pro position_type (pokud neexistuje)
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'employee_position_type') THEN
      CREATE TYPE public.employee_position_type AS ENUM ('handler', 'vlnař', 'operator');
    END IF;

    -- Přidání sloupce s enum typem
    ALTER TABLE public.employees ADD COLUMN position_type_enum public.employee_position_type;
    
    -- Výchozí hodnoty pro existující zaměstnance (všichni jsou operator)
    UPDATE public.employees SET position_type_enum = 'operator' WHERE position_type_enum IS NULL;
    
    -- Změna sloupce na NOT NULL
    ALTER TABLE public.employees ALTER COLUMN position_type_enum SET NOT NULL;
    
    -- Vytvoření indexu pro position_type
    CREATE INDEX idx_employees_position_type ON public.employees(position_type_enum);
  END IF;
END $$;
