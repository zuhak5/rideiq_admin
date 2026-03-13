BEGIN;

SELECT plan(2);

\set last_sign_in_user '00000000-0000-0000-0000-000000000035'
\set terms_completed_user '00000000-0000-0000-0000-000000000036'

INSERT INTO auth.users (
  id,
  phone,
  encrypted_password,
  phone_confirmed_at,
  last_sign_in_at,
  raw_user_meta_data,
  created_at,
  updated_at
)
VALUES
  (
    :'last_sign_in_user'::uuid,
    '+9647700000035',
    'enc-last-sign-in-user',
    null,
    now(),
    '{"display_name":"Last Sign In User"}'::jsonb,
    now(),
    now()
  ),
  (
    :'terms_completed_user'::uuid,
    '+9647700000036',
    'enc-terms-completed-user',
    null,
    null,
    '{"display_name":"Terms Completed User"}'::jsonb,
    now(),
    now()
  )
ON CONFLICT (id) DO NOTHING;

UPDATE public.profiles
SET terms_accepted_at = now(),
    terms_version = 'v1'
WHERE id = :'terms_completed_user'::uuid;

SELECT is(
  public.get_phone_auth_route('+9647700000035'),
  'password',
  'password user with last_sign_in_at routes to password'
);

SELECT is(
  public.get_phone_auth_route('+9647700000036'),
  'password',
  'password user with accepted terms routes to password'
);

SELECT * FROM finish();

ROLLBACK;
