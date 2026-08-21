-- Fix screenshot storage: the existing policies reference `screenshots`,
-- but the bucket itself was never created by a migration.
-- Keep it private; access is controlled by storage.objects RLS below.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'screenshots',
  'screenshots',
  false,
  10485760,
  ARRAY['image/png', 'image/jpeg', 'image/webp']::text[]
)
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = 10485760,
    allowed_mime_types = ARRAY['image/png', 'image/jpeg', 'image/webp']::text[];

-- Re-apply the intended policies so the migration is safe on databases where
-- older policy names already exist.
DROP POLICY IF EXISTS screenshots_auth_select ON storage.objects;
DROP POLICY IF EXISTS screenshots_auth_insert ON storage.objects;
DROP POLICY IF EXISTS screenshots_auth_update ON storage.objects;
DROP POLICY IF EXISTS screenshots_auth_delete ON storage.objects;
DROP POLICY IF EXISTS screenshots_admin_select ON storage.objects;
DROP POLICY IF EXISTS screenshots_admin_insert ON storage.objects;
DROP POLICY IF EXISTS screenshots_admin_update ON storage.objects;
DROP POLICY IF EXISTS screenshots_admin_delete ON storage.objects;

CREATE POLICY screenshots_admin_select ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'screenshots'
  AND (storage.foldername(name))[1] = 'daily'
  AND public.has_role(auth.uid(), 'admin')
);

CREATE POLICY screenshots_admin_insert ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'screenshots'
  AND (storage.foldername(name))[1] = 'daily'
  AND public.has_role(auth.uid(), 'admin')
);

CREATE POLICY screenshots_admin_update ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'screenshots'
  AND (storage.foldername(name))[1] = 'daily'
  AND public.has_role(auth.uid(), 'admin')
)
WITH CHECK (
  bucket_id = 'screenshots'
  AND (storage.foldername(name))[1] = 'daily'
  AND public.has_role(auth.uid(), 'admin')
);

CREATE POLICY screenshots_admin_delete ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'screenshots'
  AND (storage.foldername(name))[1] = 'daily'
  AND public.has_role(auth.uid(), 'admin')
);
