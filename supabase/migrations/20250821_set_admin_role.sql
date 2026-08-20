-- Získejte user_id z Supabase Auth → Users (klikněte na uživatele a zkopírujte ID)
-- Vložte ho místo 'YOUR_USER_ID_HERE' (uvnitč apostrofů)
-- Např: user_id = '12345678-1234-1234-1234-123456789abc'

INSERT INTO public.user_roles (user_id, role)
VALUES ('YOUR_USER_ID_HERE', 'admin')
ON CONFLICT (user_id, role) DO NOTHING;
