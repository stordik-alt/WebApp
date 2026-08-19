CREATE POLICY "screenshots_auth_select" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'screenshots');
CREATE POLICY "screenshots_auth_insert" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'screenshots');
CREATE POLICY "screenshots_auth_update" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'screenshots') WITH CHECK (bucket_id = 'screenshots');
CREATE POLICY "screenshots_auth_delete" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'screenshots');