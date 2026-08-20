-- Oprava chybějících sloupců v employees a enum hodnoty

-- 1. Přidat chybějící sloupec is_temporary
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS is_temporary boolean NOT NULL DEFAULT false;

-- 2. Přidat hodnotu 'standard' do enum (frontend ji používá jako výchozí)
ALTER TYPE public.employee_position_type ADD VALUE IF NOT EXISTS 'standard';

-- 3. Obnovit PostgREST schema cache
NOTIFY pgrst, 'reload schema';
