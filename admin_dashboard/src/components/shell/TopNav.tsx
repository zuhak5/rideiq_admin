'use client';

import Link from 'next/link';
import * as React from 'react';
import { CommandPalette } from '@/components/shell/CommandPalette';

export function TopNav({
  email,
  roles,
  permissions,
}: {
  email: string | null;
  roles: string[];
  permissions: string[];
}) {
  const shownRoles = (roles ?? []).slice(0, 3);
  const [open, setOpen] = React.useState(false);

  return (
    <>
      <header className="h-14 border-b bg-white flex items-center justify-between px-4">
        <div className="text-sm text-neutral-600">Admin Dashboard</div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="hidden sm:flex items-center gap-2 text-xs rounded-md border px-2 py-1 hover:bg-neutral-50"
            aria-label="Open command palette"
          >
            <span className="text-neutral-600">Search</span>
            <span className="text-[10px] rounded border px-1 text-neutral-500">Ctrl/⌘ K</span>
          </button>

          {shownRoles.length > 0 && (
            <div className="hidden sm:flex gap-1">
              {shownRoles.map((r) => (
                <span key={r} className="text-[11px] rounded-md border px-2 py-0.5 text-neutral-600 bg-neutral-50">
                  {r}
                </span>
              ))}
            </div>
          )}
          <div className="text-xs text-neutral-500">{email ?? ''}</div>
          <Link href="/logout" className="text-xs rounded-md border px-2 py-1 hover:bg-neutral-50">
            Sign out
          </Link>
        </div>
      </header>

      <CommandPalette open={open} onOpenChange={setOpen} permissions={permissions} />
    </>
  );
}
