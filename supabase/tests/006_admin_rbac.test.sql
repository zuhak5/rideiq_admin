BEGIN;
SELECT plan(5);

-- Test setup: two admin users
-- Use fixed UUIDs to avoid extension dependencies.
\set admin1 '00000000-0000-0000-0000-000000000001'
\set admin2 '00000000-0000-0000-0000-000000000002'

-- Required for public.profiles FK to auth.users(id)
INSERT INTO auth.users (id)
VALUES
  (:'admin1'::uuid),
  (:'admin2'::uuid)
ON CONFLICT (id) DO NOTHING;

-- Ensure profile rows exist (some RPCs join profiles)
INSERT INTO public.profiles (id, display_name, phone, is_admin)
VALUES
  (:'admin1'::uuid, 'Admin One', '+9647000000001', true),
  (:'admin2'::uuid, 'Admin Two', '+9647000000002', true)
ON CONFLICT (id) DO NOTHING;

-- Mark as admins (legacy table)
INSERT INTO public.admin_users (user_id, note)
VALUES
  (:'admin1'::uuid, 'pgtap seed'),
  (:'admin2'::uuid, 'pgtap seed')
ON CONFLICT (user_id) DO NOTHING;

-- Reset RBAC assignments for deterministic testing
DELETE FROM public.admin_user_roles WHERE user_id IN ((:'admin1')::uuid, (:'admin2')::uuid);

-- admin1 starts as user_admin (has admin_access.manage, but NOT super_admin)
INSERT INTO public.admin_user_roles (user_id, role_id, granted_by, note)
SELECT (:'admin1')::uuid, r.id, (:'admin1')::uuid, 'seed'
FROM public.admin_roles r
WHERE r.key = 'user_admin';

-- admin2 starts as ops_admin (should NOT have admin_access.manage)
INSERT INTO public.admin_user_roles (user_id, role_id, granted_by, note)
SELECT (:'admin2')::uuid, r.id, (:'admin1')::uuid, 'seed'
FROM public.admin_roles r
WHERE r.key = 'ops_admin';

-- Execute as authenticated admin1
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', :'admin1', true);

SELECT ok(
  public.admin_has_permission('admin_access.manage'),
  'admin1 has admin_access.manage'
);

-- Guardrail: cannot remove the LAST admin_access.manage user
SELECT throws_ok(
  'SELECT public.admin_set_user_roles_v1(''' || :'admin1' || '''::uuid, ARRAY[''ops_admin'']::text[], ''attempt demote'')',
  '22023',
  'cannot remove last admin_access.manage user'
);

-- Promote admin2 to user_admin so admin_access.manage remains assigned to someone else
RESET ROLE;
DELETE FROM public.admin_user_roles WHERE user_id = (:'admin2')::uuid;
INSERT INTO public.admin_user_roles (user_id, role_id, granted_by, note)
SELECT (:'admin2')::uuid, r.id, (:'admin1')::uuid, 'seed'
FROM public.admin_roles r
WHERE r.key = 'user_admin';

-- Now admin1 can self-demote because admin2 still has admin_access.manage
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

-- Validate: at least one role is required
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', :'admin2', true);

SELECT throws_ok(
  'SELECT public.admin_set_user_roles_v1(''' || :'admin2' || '''::uuid, ARRAY[]::text[], ''invalid'')',
  '22023',
  'at least one role is required'
);

SELECT * FROM finish();
ROLLBACK;
