BEGIN;
SELECT plan(7);

\set admin1 '00000000-0000-0000-0000-000000000011'
\set admin2 '00000000-0000-0000-0000-000000000012'
\set admin3 '00000000-0000-0000-0000-000000000013'

INSERT INTO auth.users (id)
VALUES
  (:'admin1'::uuid),
  (:'admin2'::uuid),
  (:'admin3'::uuid)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, display_name, phone)
VALUES
  (:'admin1'::uuid, 'Admin One', '+9647000000011'),
  (:'admin2'::uuid, 'Admin Two', '+9647000000012'),
  (:'admin3'::uuid, 'Admin Three', '+9647000000013')
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

SELECT (public.admin_create_role_change_request_v1((:'admin3')::uuid, ARRAY['super_admin']::text[], 'promote to super') ->> 'request_id') AS req_id \gset

RESET ROLE;
UPDATE public.admin_role_change_requests
SET created_at = now() - interval '8 days'
WHERE id = (:'req_id')::uuid;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', :'admin2', true);

SELECT throws_ok(
  'SELECT public.admin_approve_role_change_request_v1(''' || :'req_id' || '''::uuid, ''approve old'')',
  '22023',
  'request expired'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM public.admin_list_role_change_requests_v2('expired', 50, 0, 7) r
    WHERE r.id = (:'req_id')::uuid
      AND r.is_expired = true
      AND r.effective_status = 'expired'
  ),
  'list v2 labels stale requests as expired'
);

SELECT ok(
  (public.admin_reject_role_change_request_v1((:'req_id')::uuid, 'reject expired') ->> 'ok')::boolean,
  'rejected expired request'
);

RESET ROLE;
SELECT is(
  (SELECT status FROM public.admin_role_change_requests WHERE id = (:'req_id')::uuid),
  'rejected',
  'request status rejected'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', :'admin1', true);

DO $do$
DECLARE
  i integer;
BEGIN
  FOR i IN 1..19 LOOP
    PERFORM public.admin_create_role_change_request_v1('00000000-0000-0000-0000-000000000013'::uuid, ARRAY['super_admin']::text[], 'spam');
  END LOOP;
END;
$do$;

SELECT throws_ok(
  'SELECT public.admin_create_role_change_request_v1(''' || :'admin3' || '''::uuid, ARRAY[''super_admin'']::text[], ''over limit'')',
  '22023',
  'rate limit exceeded (20/21 in 3600 seconds) for admin.create_role_change_request'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM public.admin_audit_log l
    WHERE l.action = 'reject_admin_role_change'
      AND (l.details ->> 'request_id') = (:'req_id')
  ),
  'reject is audited'
);

SELECT * FROM finish();
ROLLBACK;
