BEGIN;
-- Session 9: Admin dashboard Rides + Drivers management primitives
--
-- Adds:
--  - permissions for rides/drivers
--  - role grants (conservative defaults)
--  - audit action enum values for new admin operations

-- 1) Permissions
INSERT INTO public.admin_permissions (key, name, description) VALUES
  ('rides.read', 'Read rides', 'List and view ride details'),
  ('rides.cancel', 'Cancel rides', 'Cancel active rides (assigned/arrived/in_progress)'),
  ('rides.reassign', 'Reassign rides', 'Reassign rides to a different driver (future)'),
  ('rides.adjust_fare', 'Adjust fare', 'Adjust ride fare / fees (future)'),
  ('drivers.read', 'Read drivers', 'List and view driver details'),
  ('drivers.manage', 'Manage drivers', 'Edit driver settings / vehicles / payout settings (future)'),
  ('drivers.suspend', 'Suspend drivers', 'Suspend/unsuspend drivers')
ON CONFLICT (key) DO NOTHING;
-- 2) Grants
WITH r AS (SELECT id, key FROM public.admin_roles),
     p AS (SELECT id, key FROM public.admin_permissions)
INSERT INTO public.admin_role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM r
JOIN p ON (
  -- Full access roles
  (r.key IN ('super_admin','legacy_admin') AND p.key IN (
    'rides.read','rides.cancel','rides.reassign','rides.adjust_fare',
    'drivers.read','drivers.manage','drivers.suspend'
  ))
  OR
  -- Ops visibility (conservative defaults; elevate as needed)
  (r.key = 'ops_admin' AND p.key IN ('rides.read','drivers.read'))
  OR
  -- Fraud investigations often require visibility into ride/driver context
  (r.key = 'fraud_admin' AND p.key IN ('rides.read','drivers.read'))
)
ON CONFLICT DO NOTHING;
-- 3) Audit action enum values for new operations
ALTER TYPE public.admin_audit_action ADD VALUE IF NOT EXISTS 'cancel_ride';
ALTER TYPE public.admin_audit_action ADD VALUE IF NOT EXISTS 'transition_driver_status';
COMMIT;
