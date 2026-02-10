'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { filterNavForPermissions, type NavGroup } from '@/lib/nav';

function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Sidebar({ permissions }: { permissions: string[] }) {
  const pathname = usePathname();
  const groups: NavGroup[] = filterNavForPermissions(permissions);

  return (
    <aside className="w-64 bg-white border-r min-h-screen p-4">
      <div className="text-lg font-semibold mb-6">RideIQ Admin</div>

      <nav className="space-y-4">
        {groups.map((group) => (
          <div key={group.title}>
            <div className="px-3 mb-2 text-[11px] uppercase tracking-wide text-neutral-400">{group.title}</div>
            <div className="space-y-1">
              {group.items.map((item) => {
                const active = isActive(pathname, item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`block rounded-lg px-3 py-2 text-sm transition-colors ${
                      active ? 'bg-neutral-100 text-neutral-900' : 'text-neutral-600 hover:bg-neutral-50'
                    }`}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
    </aside>
  );
}
