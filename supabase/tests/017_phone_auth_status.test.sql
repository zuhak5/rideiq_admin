BEGIN;

SELECT plan(7);

\set password_user '00000000-0000-0000-0000-000000000031'
\set unconfirmed_user '00000000-0000-0000-0000-000000000032'
\set nopassword_user '00000000-0000-0000-0000-000000000033'

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
    :'password_user'::uuid,
    '+9647700000031',
    'enc-password-user',
    now(),
    '{"display_name":"Password User"}'::jsonb,
    now(),
    now()
  ),
  (
    :'unconfirmed_user'::uuid,
    '+9647700000032',
    'enc-unconfirmed-user',
    null,
    '{"display_name":"Unconfirmed User"}'::jsonb,
    now(),
    now()
  ),
  (
    :'nopassword_user'::uuid,
    '+9647700000033',
    null,
    now(),
    '{"display_name":"No Password User"}'::jsonb,
    now(),
    now()
  )
ON CONFLICT (id) DO NOTHING;

SELECT is(
  public.get_phone_auth_route('+9647700000031'),
  'password',
  'confirmed user with password routes to password'
);

SELECT is(
  public.get_phone_auth_route('+9647700000099'),
  'otp_signup',
  'missing phone routes to otp_signup'
);

SELECT is(
  public.get_phone_auth_route('+9647700000032'),
  'otp_signup',
  'unconfirmed user routes to otp_signup'
);

SELECT is(
  public.get_phone_auth_route('+9647700000033'),
  'otp_signup',
  'confirmed user without password routes to otp_signup'
);

UPDATE auth.users
   SET phone = '+9647700000091',
       raw_user_meta_data = '{"display_name":"Updated Password User"}'::jsonb,
       updated_at = now()
 WHERE id = :'password_user'::uuid;

SELECT is(
  (SELECT display_name FROM public.profiles WHERE id = :'password_user'::uuid),
  'Updated Password User',
  'auth.users metadata updates sync profile display_name'
);

SELECT is(
  (SELECT phone FROM public.profiles WHERE id = :'password_user'::uuid),
  '+9647700000091',
  'auth.users phone updates sync profile phone'
);

SELECT is(
  (SELECT phone_e164 FROM public.profiles WHERE id = :'password_user'::uuid),
  '+9647700000091',
  'auth.users phone updates keep profile phone_e164 normalized'
);

SELECT * FROM finish();

ROLLBACK;
