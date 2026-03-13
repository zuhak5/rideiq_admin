BEGIN;
-- Session 11: Ride Intent conversion governance
--
-- Adds:
--  - permission key rides.convert_intent
--  - grants to super/legacy roles (and optionally ops_admin)
--  - audit action enum value convert_ride_intent

-- 1) Permission (idempotent)
INSERT INTO public.admin_permissions (key, name, description)
VALUES (
  'rides.convert_intent',
  'Convert ride intents',
  'Convert a ride intent into a ride request (admin/operator initiated)'
)
ON CONFLICT (key) DO NOTHING;
-- 2) Grants (idempotent): keep conservative; expand if needed.
WITH r AS (SELECT id, key FROM public.admin_roles),
     p AS (SELECT id FROM public.admin_permissions WHERE key = 'rides.convert_intent')
INSERT INTO public.admin_role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM r
CROSS JOIN p
WHERE r.key IN ('super_admin', 'legacy_admin')
ON CONFLICT DO NOTHING;
-- 3) Audit action enum value
ALTER TYPE public.admin_audit_action ADD VALUE IF NOT EXISTS 'convert_ride_intent';
COMMIT;
