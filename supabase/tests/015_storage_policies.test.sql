BEGIN;
SELECT plan(1);

-- Buckets should exist (migrations make the repo reproducible).
SELECT results_eq(
  $$
    SELECT name
    FROM storage.buckets
    WHERE name IN ('avatars', 'chat-media', 'driver-docs', 'kyc-documents')
    ORDER BY name;
  $$,
  $$
    VALUES
      ('avatars'),
      ('chat-media'),
      ('driver-docs'),
      ('kyc-documents')
  $$,
  'Expected storage buckets should exist'
);

-- Storage access is mediated via Edge Functions which sign URLs server-side.
-- (We intentionally avoid creating policies on `storage.objects` in migrations because
-- role ownership may differ between local/dev images and managed environments.)

SELECT * FROM finish();
ROLLBACK;
