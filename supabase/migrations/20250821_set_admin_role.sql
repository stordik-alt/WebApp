-- Vytvoření admin usera pro váš projekt
-- Tento skript vytvoří tabulku user_roles (pokud neexistuje) a nastaví admin roli

-- 1. Vytvoření typu role (pokud neexistuje)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'app_role') THEN
    CREATE TYPE public.app_role AS ENUM ('admin', 'team_leader', 'operator');
  END IF;
END $$;

-- 2. Vytvoření tabulky user_roles (pokud neexistuje)
CREATE TABLE IF NOT EXISTS public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

-- 3. Povolení RLS
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- 4. Odstranění starých politik
DROP POLICY IF EXISTS user_roles_user_select ON public.user_roles;

-- 5. Nová politika
CREATE POLICY "Users can read own roles"
ON public.user_roles FOR SELECT TO authenticated
USING (user_id = auth.uid());

-- 6. Vytvoření has_role funkce (pokud neexistuje)
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

-- 7. Nastavení admin role pro vaše User ID
INSERT INTO public.user_roles (user_id, role)
VALUES ('21be6487-7f9b-43fc-9813-b9c60e5ee584', 'admin')
ON CONFLICT (user_id, role) DO NOTHING;

-- 8. Přidání team_leader a operator rolí do typu (pokud neexistují)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'app_role' AND array['team_leader', 'operator']::text[] <= array(SELECT enumlabel FROM pg_enum WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = 'app_role'))::text[]) THEN
    ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'team_leader';
    ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'operator';
  END IF;
END $$;


