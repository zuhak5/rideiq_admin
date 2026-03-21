BEGIN;
SELECT plan(11);

\set admin1 '00000000-0000-0000-0000-000000000001'
\set admin2 '00000000-0000-0000-0000-000000000002'
\set admin3 '00000000-0000-0000-0000-000000000003'

INSERT INTO auth.users (id)
VALUES
  (:'admin1'::uuid),
  (:'admin2'::uuid),
  (:'admin3'::uuid)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, display_name, phone)
VALUES
  (:'admin1'::uuid, 'Admin One', '+9647000000001'),
  (:'admin2'::uuid, 'Admin Two', '+9647000000002'),
  (:'admin3'::uuid, 'Admin Three', '+9647000000003')
ON CONFLICT (id) DO NOTHING;

DELETE FROM public.admin_user_roles WHERE user_id IN ((:'admin1')::uuid, (:'admin2')::uuid, (:'admin3')::uuid);

INSERT INTO public.admin_user_roles (user_id, role_id, granted_by, note)
SELECT (:'admin1')::uuid, r.id, (:'admin1')::uuid, 'seed'
FROM public.admin_roles r
WHERE r.key = 'user_admin';

INSERT INTO public.admin_user_roles (user_id, role_id, granted_by, note)
SELECT (:'admin2')::uuid, r.id, (:'admin1')::uuid, 'seed'
FROM public.admin_roles r
WHERE r.key = 'ops_admin';

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', :'admin1', true);

SELECT ok(
  public.admin_has_permission('admin_access.manage'),
  'admin1 has admin_access.manage'
);

SELECT ok(
  public.is_admin((:'admin1')::uuid),
  'admin1 is admin via assigned role'
);

SELECT ok(
  public.is_admin((:'admin2')::uuid),
  'admin2 is admin via assigned role'
);

SELECT ok(
  NOT public.is_admin((:'admin3')::uuid),
  'admin3 is not admin without any roles'
);

SELECT ok(
  (public.admin_set_user_roles_v1((:'admin3')::uuid, ARRAY['user_admin']::text[], 'promote from non-admin') ->> 'ok')::boolean,
  'non-admin user can be promoted by assigning roles'
);

SELECT ok(
  public.is_admin((:'admin3')::uuid),
  'admin3 becomes admin after role assignment'
);

SELECT ok(
  (public.admin_set_user_roles_v1((:'admin3')::uuid, ARRAY[]::text[], 'revoke all access') ->> 'ok')::boolean,
  'empty role array revokes all admin access'
);

SELECT ok(
  NOT public.is_admin((:'admin3')::uuid),
  'admin3 loses admin access after roles are cleared'
);

SELECT throws_ok(
  'SELECT public.admin_set_user_roles_v1(''' || :'admin1' || '''::uuid, ARRAY[''ops_admin'']::text[], ''attempt demote'')',
  '22023',
  'cannot remove last admin_access.manage user'
);

RESET ROLE;
INSERT INTO public.admin_user_roles (user_id, role_id, granted_by, note)
SELECT (:'admin2')::uuid, r.id, (:'admin1')::uuid, 'seed'
FROM public.admin_roles r
WHERE r.key = 'user_admin'
ON CONFLICT (user_id, role_id) DO NOTHING;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', :'admin1', true);

SELECT ok(
  (public.admin_set_user_roles_v1((:'admin1')::uuid, ARRAY['ops_admin']::text[], 'demote ok') ->> 'ok')::boolean,
  'admin1 can self-demote when another manager exists'
);

SELECT ok(
  NOT public.admin_has_permission('admin_access.manage'),
  'admin1 no longer has admin_access.manage after demotion'
);

SELECT * FROM finish();
ROLLBACK;
