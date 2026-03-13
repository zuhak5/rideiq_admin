BEGIN;

SELECT plan(3);

\set complete_user '00000000-0000-0000-0000-000000000037'
\set incomplete_user '00000000-0000-0000-0000-000000000038'
\set missing_user '00000000-0000-0000-0000-000000000039'

INSERT INTO auth.users (
  id,
  phone,
  encrypted_password,
  phone_confirmed_at,
  raw_user_meta_data,
  created_at,
  updated_at
)
VALUES
  (
    :'complete_user'::uuid,
    '+9647700000037',
    'enc-complete-session-user',
    now(),
    '{"display_name":"Complete Session User"}'::jsonb,
    now(),
    now()
  ),
  (
    :'incomplete_user'::uuid,
    '+9647700000038',
    '',
    null,
    '{"display_name":"Incomplete Session User"}'::jsonb,
    now(),
    now()
  )
ON CONFLICT (id) DO NOTHING;

SET LOCAL ROLE authenticated;

SELECT set_config('request.jwt.claim.sub', :'complete_user', true);

SELECT is(
  public.get_my_auth_session_status(),
  'complete',
  'completed phone account sessions bootstrap as complete'
);

SELECT set_config('request.jwt.claim.sub', :'incomplete_user', true);

SELECT is(
  public.get_my_auth_session_status(),
  'incomplete',
  'OTP-only session without password stays incomplete at bootstrap'
);

SELECT set_config('request.jwt.claim.sub', :'missing_user', true);

SELECT is(
  public.get_my_auth_session_status(),
  'signed_out',
  'missing auth.users rows bootstrap as signed_out'
);

SELECT * FROM finish();

ROLLBACK;
