-- Baseline: Storage buckets required by the application.
--
-- Policies on storage.objects are intentionally managed outside migrations in this repo
-- (see supabase/tests/015_storage_policies.test.sql).

BEGIN;
INSERT INTO storage.buckets (id, name, public)
VALUES
  ('avatars', 'avatars', false),
  ('chat-media', 'chat-media', false),
  ('driver-docs', 'driver-docs', false),
  ('kyc-documents', 'kyc-documents', false)
ON CONFLICT (id) DO NOTHING;
COMMIT;
