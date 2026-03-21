BEGIN;
SELECT plan(8);

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
WHERE r.key = 'super_admin';

INSERT INTO public.admin_user_roles (user_id, role_id, granted_by, note)
SELECT (:'admin2')::uuid, r.id, (:'admin1')::uuid, 'seed'
FROM public.admin_roles r
WHERE r.key = 'super_admin';

INSERT INTO public.admin_user_roles (user_id, role_id, granted_by, note)
SELECT (:'admin3')::uuid, r.id, (:'admin1')::uuid, 'seed'
FROM public.admin_roles r
WHERE r.key = 'ops_admin';

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', :'admin1', true);

SELECT ok(
  public.admin_has_permission('admin_access.manage'),
  'admin1 has admin_access.manage'
);

SELECT throws_ok(
  'SELECT public.admin_set_user_roles_v1(''' || :'admin3' || '''::uuid, ARRAY[''super_admin'']::text[], ''try direct promote'')',
  '22023',
  'super_admin changes require approval request'
);

SELECT (public.admin_create_role_change_request_v1((:'admin3')::uuid, ARRAY['super_admin']::text[], 'promote to super') ->> 'request_id') AS req_id \gset

SELECT ok(
  length(:'req_id') > 0,
  'request created'
);

SELECT throws_ok(
  'SELECT public.admin_approve_role_change_request_v1(''' || :'req_id' || '''::uuid, ''self approve'')',
  '22023',
  'two-person approval required'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', :'admin2', true);

SELECT ok(
  (public.admin_approve_role_change_request_v1((:'req_id')::uuid, 'approve and execute') ->> 'ok')::boolean,
  'approved and executed'
);

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

RESET ROLE;
SELECT is(
  (SELECT status FROM public.admin_role_change_requests WHERE id = (:'req_id')::uuid),
  'executed',
  'request status executed'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', :'admin2', true);

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
