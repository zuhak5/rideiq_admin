export type NavItem = {
  href: string;
  label: string;
  requires?: string;
  keywords?: string[];
};

export type NavGroup = {
  title: string;
  items: NavItem[];
};

export const NAV_GROUPS: NavGroup[] = [
  {
    title: 'Core',
    items: [
      { href: '/dashboard', label: 'Dashboard', requires: 'dashboard.view', keywords: ['home', 'summary'] },
      { href: '/rides', label: 'Rides', requires: 'rides.read', keywords: ['trip', 'ride', 'booking'] },
      { href: '/drivers', label: 'Drivers', requires: 'drivers.read', keywords: ['driver', 'fleet'] },
      { href: '/users', label: 'Users', requires: 'users.read', keywords: ['rider', 'customer', 'profile'] },
    ],
  },
  {
    title: 'Finance',
    items: [
      { href: '/payments', label: 'Payments', requires: 'payments.read', keywords: ['payment', 'charge', 'refund'] },
      { href: '/withdrawals', label: 'Withdrawals', requires: 'withdrawals.read', keywords: ['withdrawal', 'cashout', 'payout request'] },
      { href: '/payouts/jobs', label: 'Payout Jobs', requires: 'payouts.read', keywords: ['payout', 'batch', 'job', 'retry'] },
    ],
  },
  {
    title: 'Safety & Integrity',
    items: [
      { href: '/fraud', label: 'Fraud', requires: 'fraud.view', keywords: ['fraud', 'abuse', 'risk'] },
      { href: '/incidents', label: 'Incidents', requires: 'incidents.read', keywords: ['incident', 'sos', 'safety'] },
    ],
  },
  {
    title: 'Operations',
    items: [
      { href: '/ops', label: 'Ops', requires: 'ops.view', keywords: ['ops', 'operations'] },
      { href: '/observability', label: 'Observability', requires: 'observability.view', keywords: ['logs', 'metrics', 'traces'] },
      { href: '/runbooks', label: 'Runbooks', requires: 'ops.view', keywords: ['runbook', 'playbook'] },
      { href: '/support/tickets', label: 'Support Tickets', requires: 'support.read', keywords: ['support', 'tickets', 'helpdesk'] },
      { href: '/support/articles', label: 'Help Center', requires: 'support.read', keywords: ['help center', 'kb', 'articles'] },
    ],
  },
  {
    title: 'Configuration',
    items: [
      { href: '/service-areas', label: 'Service Areas', requires: 'service_areas.read', keywords: ['geo', 'geofence', 'zone'] },
      { href: '/pricing', label: 'Pricing', requires: 'pricing.read', keywords: ['fare', 'price', 'tariff'] },
      { href: '/promotions', label: 'Promotions', requires: 'promotions.read', keywords: ['promo', 'referral', 'coupon', 'gift'] },
      { href: '/merchants', label: 'Merchants', requires: 'merchants.read', keywords: ['merchant', 'store'] },
      { href: '/orders', label: 'Orders', requires: 'orders.read', keywords: ['order', 'delivery'] },
      { href: '/maps', label: 'Maps', requires: 'maps.view', keywords: ['map', 'live'] },
      { href: '/agents', label: 'Agents', requires: 'agents.view', keywords: ['concierge', 'agent'] },
      { href: '/settings', label: 'Settings', requires: 'settings.read', keywords: ['settings', 'feature flags'] },
    ],
  },
  {
    title: 'Governance',
    items: [
      { href: '/audit', label: 'Audit Log', requires: 'audit.read', keywords: ['audit', 'log'] },
      { href: '/admin-access', label: 'Admin Access', requires: 'admin_access.manage', keywords: ['access', 'roles', 'rbac'] },
      { href: '/admin-access/requests', label: 'Role Requests', requires: 'admin_access.manage', keywords: ['requests', 'approvals'] },
    ],
  },
];

export function allNavItems(): NavItem[] {
  return NAV_GROUPS.flatMap((g) => g.items);
}

export function filterNavForPermissions(permissions: string[] | null | undefined): NavGroup[] {
  const permSet = new Set(permissions ?? []);
  const hasAll = permSet.has('*');

  return NAV_GROUPS.map((g) => {
    const items = g.items.filter((i) => {
      if (!i.requires) return true;
      if (hasAll) return true;
      return permSet.has(i.requires);
    });
    return { ...g, items };
  }).filter((g) => g.items.length > 0);
}
