-- Admin Observability permission
--
-- Adds a dedicated permission key for observability dashboards.
-- Keeps operational visibility separate from other capabilities.

BEGIN;

-- 1) Permission (idempotent)
INSERT INTO public.admin_permissions (key, name, description)
VALUES (
  'observability.view',
  'View observability',
  'Access observability dashboards and recent system events'
)
ON CONFLICT (key) DO NOTHING;

-- 2) Grant permission to relevant roles (idempotent)
WITH r AS (SELECT id, key FROM public.admin_roles),
     p AS (SELECT id, key FROM public.admin_permissions WHERE key = 'observability.view')
INSERT INTO public.admin_role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM r
CROSS JOIN p
WHERE r.key IN ('super_admin', 'legacy_admin', 'ops_admin')
ON CONFLICT DO NOTHING;

COMMIT;
