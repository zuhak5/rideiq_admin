-- Baseline storage buckets used by the app.
-- Note: storage.objects policies are intentionally managed via Edge Functions (signed URLs),
-- and are not created here.

INSERT INTO storage.buckets (id, name, public)
VALUES
  ('avatars', 'avatars', false),
  ('chat-media', 'chat-media', false),
  ('driver-docs', 'driver-docs', false),
  ('kyc-documents', 'kyc-documents', false)
ON CONFLICT (id) DO NOTHING;
;
