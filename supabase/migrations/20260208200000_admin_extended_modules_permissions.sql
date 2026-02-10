-- Extended admin permissions and roles for next-gen admin dashboard modules.
-- Idempotent inserts + grants.
BEGIN;

-- 1) Permissions
INSERT INTO public.admin_permissions (key, name, description) VALUES
  ('payments.read', 'Read payments', 'View payments and payment provider metadata'),
  ('payments.refund', 'Refund payments', 'Issue refunds for eligible payments'),
  ('withdrawals.read', 'Read withdrawals', 'View withdrawal requests and status'),
  ('withdrawals.approve', 'Approve withdrawals', 'Approve withdrawal requests'),
  ('withdrawals.reject', 'Reject withdrawals', 'Reject withdrawal requests'),
  ('withdrawals.mark_paid', 'Mark withdrawals paid', 'Manually mark withdrawals as paid/confirmed'),
  ('payouts.read', 'Read payout jobs', 'View payout jobs and attempts'),
  ('payouts.run', 'Run payouts', 'Create and start payout jobs'),
  ('payouts.retry', 'Retry payouts', 'Retry/cancel payout jobs and actions'),
  ('service_areas.read', 'Read service areas', 'View service areas and geofences'),
  ('service_areas.manage', 'Manage service areas', 'Create/update/delete service areas'),
  ('pricing.read', 'Read pricing', 'View pricing configurations'),
  ('pricing.manage', 'Manage pricing', 'Create/update pricing configurations'),
  ('promotions.read', 'Read promotions', 'View promotions/referrals/coupons'),
  ('promotions.manage', 'Manage promotions', 'Create/update promotions/referrals/coupons'),
  ('support.read', 'Read support', 'View support tickets and support content'),
  ('support.manage', 'Manage support', 'Respond to tickets and manage support content'),
  ('incidents.read', 'Read incidents', 'View safety incidents and SOS events'),
  ('incidents.manage', 'Manage incidents', 'Take actions on incidents/SOS events'),
  ('orders.read', 'Read orders', 'View merchant orders and deliveries'),
  ('orders.manage', 'Manage orders', 'Update orders and handle exceptions'),
  ('merchants.read', 'Read merchants', 'View merchant accounts'),
  ('merchants.manage', 'Manage merchants', 'Manage merchant accounts'),
  ('maps.view', 'View maps', 'Access live maps and geo tooling'),
  ('agents.view', 'View agents console', 'Access agent/concierge console'),
  ('settings.read', 'Read settings', 'View system settings and feature flags'),
  ('settings.manage', 'Manage settings', 'Update system settings and feature flags')
ON CONFLICT (key) DO NOTHING;

-- 2) Roles
INSERT INTO public.admin_roles (key, name, description) VALUES
  ('finance_admin', 'Finance Admin', 'Payments, withdrawals, and payout operations'),
  ('pricing_admin', 'Pricing Admin', 'Service areas, pricing rules, and fare simulation'),
  ('support_admin', 'Support Admin', 'Support tickets, articles, and agent console'),
  ('safety_admin', 'Safety Admin', 'Incidents/SOS workflows and safety operations'),
  ('growth_admin', 'Growth Admin', 'Promotions, referrals, and growth operations')
ON CONFLICT (key) DO NOTHING;

-- 3) Grants
WITH r AS (SELECT id, key FROM public.admin_roles),
     p AS (SELECT id, key FROM public.admin_permissions)
INSERT INTO public.admin_role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM r
JOIN p ON (
  -- super_admin + legacy_admin: all new module permissions
  (r.key IN ('super_admin', 'legacy_admin') AND p.key IN (
    'payments.read','payments.refund',
    'withdrawals.read','withdrawals.approve','withdrawals.reject','withdrawals.mark_paid',
    'payouts.read','payouts.run','payouts.retry',
    'service_areas.read','service_areas.manage',
    'pricing.read','pricing.manage',
    'promotions.read','promotions.manage',
    'support.read','support.manage',
    'incidents.read','incidents.manage',
    'orders.read','orders.manage',
    'merchants.read','merchants.manage',
    'maps.view','agents.view',
    'settings.read','settings.manage'
  ))
  OR
  -- finance_admin
  (r.key = 'finance_admin' AND p.key IN (
    'dashboard.view','audit.read',
    'payments.read','payments.refund',
    'withdrawals.read','withdrawals.approve','withdrawals.reject','withdrawals.mark_paid',
    'payouts.read','payouts.run','payouts.retry'
  ))
  OR
  -- pricing_admin
  (r.key = 'pricing_admin' AND p.key IN (
    'dashboard.view','audit.read',
    'service_areas.read','service_areas.manage',
    'pricing.read','pricing.manage'
  ))
  OR
  -- support_admin
  (r.key = 'support_admin' AND p.key IN (
    'dashboard.view','audit.read',
    'support.read','support.manage',
    'agents.view','users.read'
  ))
  OR
  -- safety_admin
  (r.key = 'safety_admin' AND p.key IN (
    'dashboard.view','audit.read',
    'incidents.read','incidents.manage',
    'fraud.view','fraud.manage',
    'rides.read','drivers.read'
  ))
  OR
  -- growth_admin
  (r.key = 'growth_admin' AND p.key IN (
    'dashboard.view','audit.read',
    'promotions.read','promotions.manage',
    'users.read'
  ))
)
ON CONFLICT DO NOTHING;

COMMIT;
