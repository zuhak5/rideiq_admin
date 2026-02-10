BEGIN;
SELECT plan(8);

-- Test setup: three admin users
\set admin1 '00000000-0000-0000-0000-000000000001'
\set admin2 '00000000-0000-0000-0000-000000000002'
\set admin3 '00000000-0000-0000-0000-000000000003'

-- Required for public.profiles FK to auth.users(id)
INSERT INTO auth.users (id)
VALUES
  (:'admin1'::uuid),
  (:'admin2'::uuid),
  (:'admin3'::uuid)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, display_name, phone, is_admin)
VALUES
  (:'admin1'::uuid, 'Admin One', '+9647000000001', true),
  (:'admin2'::uuid, 'Admin Two', '+9647000000002', true),
  (:'admin3'::uuid, 'Admin Three', '+9647000000003', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.admin_users (user_id, note)
VALUES
  (:'admin1'::uuid, 'pgtap seed'),
  (:'admin2'::uuid, 'pgtap seed'),
  (:'admin3'::uuid, 'pgtap seed')
ON CONFLICT (user_id) DO NOTHING;

DELETE FROM public.admin_user_roles WHERE user_id IN ((:'admin1')::uuid, (:'admin2')::uuid, (:'admin3')::uuid);

-- admin1 + admin2 are super_admin (two managers exist)
INSERT INTO public.admin_user_roles (user_id, role_id, granted_by, note)
SELECT (:'admin1')::uuid, r.id, (:'admin1')::uuid, 'seed'
FROM public.admin_roles r
WHERE r.key = 'super_admin';

INSERT INTO public.admin_user_roles (user_id, role_id, granted_by, note)
SELECT (:'admin2')::uuid, r.id, (:'admin1')::uuid, 'seed'
FROM public.admin_roles r
WHERE r.key = 'super_admin';

-- admin3 starts as ops_admin
INSERT INTO public.admin_user_roles (user_id, role_id, granted_by, note)
SELECT (:'admin3')::uuid, r.id, (:'admin1')::uuid, 'seed'
FROM public.admin_roles r
WHERE r.key = 'ops_admin';

-- Execute as authenticated admin1
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', :'admin1', true);

SELECT ok(
  public.admin_has_permission('admin_access.manage'),
  'admin1 has admin_access.manage'
);

-- Direct super_admin changes must be blocked (requires approval workflow)
SELECT throws_ok(
  'SELECT public.admin_set_user_roles_v1(''' || :'admin3' || '''::uuid, ARRAY[''super_admin'']::text[], ''try direct promote'')',
  '22023',
  'super_admin changes require approval request'
);

-- Create request
SELECT (public.admin_create_role_change_request_v1((:'admin3')::uuid, ARRAY['super_admin']::text[], 'promote to super') ->> 'request_id') AS req_id \gset

SELECT ok(
  length(:'req_id') > 0,
  'request created'
);

-- Requester cannot approve (2-person rule)
SELECT throws_ok(
  'SELECT public.admin_approve_role_change_request_v1(''' || :'req_id' || '''::uuid, ''self approve'')',
  '22023',
  'two-person approval required'
);

-- Approve + execute as a different admin
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', :'admin2', true);

SELECT ok(
  (public.admin_approve_role_change_request_v1((:'req_id')::uuid, 'approve and execute') ->> 'ok')::boolean,
  'approved and executed'
);

-- Verify admin3 now has super_admin
SELECT ok(
  EXISTS (
    SELECT 1
    FROM public.admin_user_roles ur
    JOIN public.admin_roles r ON r.id = ur.role_id
    WHERE ur.user_id = (:'admin3')::uuid
      AND r.key = 'super_admin'
  ),
  'admin3 promoted to super_admin'
);

-- Verify request status is executed
RESET ROLE;
SELECT is(
  (SELECT status FROM public.admin_role_change_requests WHERE id = (:'req_id')::uuid),
  'executed',
  'request status executed'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', :'admin2', true);

-- Verify audit entry records request metadata
SELECT ok(
  EXISTS (
    SELECT 1
    FROM public.admin_audit_log l
    WHERE l.action = 'set_admin_roles'
      AND l.target_user_id = (:'admin3')::uuid
      AND (l.details ->> 'source') = 'approved_request'
      AND (l.details ->> 'request_id') = (:'req_id')
  ),
  'audit log includes approved_request details'
);

SELECT * FROM finish();
ROLLBACK;
