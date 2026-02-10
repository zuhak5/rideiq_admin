BEGIN;
SELECT plan(8);

-- RLS enablement checks
SELECT ok(
  (SELECT c.relrowsecurity
   FROM pg_class c
   JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'trip_share_tokens'),
  'trip_share_tokens has RLS enabled'
);

SELECT ok(
  (SELECT c.relrowsecurity
   FROM pg_class c
   JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'families'),
  'families has RLS enabled'
);

SELECT ok(
  (SELECT c.relrowsecurity
   FROM pg_class c
   JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'family_members'),
  'family_members has RLS enabled'
);

-- Policy existence checks (smoke)
SELECT ok(
  EXISTS(
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'trip_share_tokens'
      AND policyname = 'trip_share_tokens_insert_participant'
      AND cmd = 'INSERT'
  ),
  'trip_share_tokens insert policy exists'
);

SELECT ok(
  EXISTS(
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'trip_share_tokens'
      AND policyname = 'trip_share_tokens_select_participant'
      AND cmd = 'SELECT'
  ),
  'trip_share_tokens select policy exists'
);

SELECT ok(
  EXISTS(
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'families'
      AND policyname = 'families_select_access'
      AND cmd = 'SELECT'
  ),
  'families access policy exists'
);

SELECT ok(
  EXISTS(
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'family_members'
      AND policyname = 'family_members_select_access'
      AND cmd = 'SELECT'
  ),
  'family_members access policy exists'
);

-- RPC allowlist sanity: family_create should be executable by authenticated
SELECT ok(
  has_function_privilege('authenticated', 'public.family_create(text)', 'EXECUTE'),
  'authenticated can execute family_create()'
);

SELECT * FROM finish();
ROLLBACK;
