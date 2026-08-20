-- Vytvoření admin usera pro váš projekt
-- DŮLEŽITÉ: Tento skript NEVYTVORÍ uživatele - pro to musíte použít Supabase Dashboard
-- SQL příkaz INSERT do auth.users NEFUNGUJE kvuli bezpečnostním restrikcím

-- POSTUP V SUPABASE DASHBOARD:
-- 1. Přihlaste se do https://app.supabase.com
-- 2. Vyberte váš projekt → Authentication → Users → "Add user" → "Create new user"
-- 3. Vyplňte:
--    Email: admin@produktivita.cz
--    Password: AdminHeslo2024! (nebo své heslo)
--    Autoconfirm user: YES (aby se mohl okamžitě přihlásit)
-- 4. Klikněte na "Create user"
-- 5. Po vytvoření klikněte na tříteček u uživatele → "Set role"
-- 6. Vložte tento SQL do SQL Editoru (nahraďte USER_ID vaším skutečným ID):

INSERT INTO public.user_roles (user_id, role)
VALUES ('VAŠE_USER_ID_ZDE', 'admin')
ON CONFLICT (user_id, role) DO NOTHING;
