BEGIN;

SELECT plan(3);

\set clearing_user '00000000-0000-0000-0000-000000000034'

SELECT is(
  (
    SELECT count(*)
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'auth_sms_hook_events'
      AND column_name = 'otp_hash'
  ),
  0::bigint,
  'auth_sms_hook_events no longer stores otp_hash'
);

INSERT INTO auth.users (
  id,
  phone,
  encrypted_password,
  phone_confirmed_at,
  raw_user_meta_data,
  created_at,
  updated_at
)
VALUES (
  :'clearing_user'::uuid,
  '+9647700000034',
  'enc-clear-user',
  now(),
  '{"display_name":"Clearing User"}'::jsonb,
  now(),
  now()
)
ON CONFLICT (id) DO NOTHING;

UPDATE auth.users
SET phone = null,
    updated_at = now()
WHERE id = :'clearing_user'::uuid;

SELECT ok(
  (
    SELECT phone IS NULL
    FROM public.profiles
    WHERE id = :'clearing_user'::uuid
  ),
  'clearing auth.users phone clears profiles.phone'
);

SELECT ok(
  (
    SELECT phone_e164 IS NULL
    FROM public.profiles
    WHERE id = :'clearing_user'::uuid
  ),
  'clearing auth.users phone clears profiles.phone_e164'
);

ROLLBACK;
