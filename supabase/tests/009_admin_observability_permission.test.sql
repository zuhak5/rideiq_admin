BEGIN;
SELECT plan(2);

\set admin1 '00000000-0000-0000-0000-000000000011'
\set admin2 '00000000-0000-0000-0000-000000000012'

-- Required for public.profiles FK to auth.users(id)
INSERT INTO auth.users (id)
VALUES
  (:'admin1'::uuid),
  (:'admin2'::uuid)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, display_name, phone, is_admin)
VALUES
  (:'admin1'::uuid, 'Ops Admin', '+9647000000011', true),
  (:'admin2'::uuid, 'Auditor Admin', '+9647000000012', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.admin_users (user_id, note)
VALUES
  (:'admin1'::uuid, 'pgtap seed'),
  (:'admin2'::uuid, 'pgtap seed')
ON CONFLICT (user_id) DO NOTHING;

DELETE FROM public.admin_user_roles WHERE user_id IN ((:'admin1')::uuid, (:'admin2')::uuid);

INSERT INTO public.admin_user_roles (user_id, role_id, granted_by, note)
SELECT (:'admin1')::uuid, r.id, (:'admin1')::uuid, 'seed'
FROM public.admin_roles r
WHERE r.key = 'ops_admin';

INSERT INTO public.admin_user_roles (user_id, role_id, granted_by, note)
SELECT (:'admin2')::uuid, r.id, (:'admin1')::uuid, 'seed'
FROM public.admin_roles r
WHERE r.key = 'auditor';

SET LOCAL ROLE authenticated;

SELECT set_config('request.jwt.claim.sub', :'admin1', true);
SELECT ok(public.admin_has_permission('observability.view'), 'ops_admin has observability.view');

SELECT set_config('request.jwt.claim.sub', :'admin2', true);
SELECT ok(NOT public.admin_has_permission('observability.view'), 'auditor does not have observability.view');

SELECT * FROM finish();
ROLLBACK;
