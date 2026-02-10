'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { allNavItems, filterNavForPermissions, type NavItem } from '@/lib/nav';

function normalize(s: string): string {
  return s.toLowerCase().trim();
}

function matchScore(q: string, item: NavItem): number {
  const needle = normalize(q);
  if (!needle) return 0;

  const hay = normalize([item.label, item.href, ...(item.keywords ?? [])].join(' '));
  if (hay.includes(needle)) return 10;

  // basic token match
  const tokens = needle.split(/\s+/).filter(Boolean);
  let score = 0;
  for (const t of tokens) {
    if (hay.includes(t)) score += 2;
  }
  return score;
}

export function CommandPalette({
  open,
  onOpenChange,
  permissions,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  permissions: string[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [q, setQ] = React.useState('');

  const allowedHrefs = React.useMemo(() => {
    const groups = filterNavForPermissions(permissions);
    return new Set(groups.flatMap((g) => g.items.map((i) => i.href)));
  }, [permissions]);

  const items = React.useMemo(() => {
    const base = allNavItems().filter((i) => allowedHrefs.has(i.href));
    if (!q) return base;

    return base
      .map((i) => ({ item: i, score: matchScore(q, i) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 20)
      .map((x) => x.item);
  }, [q, allowedHrefs]);

  React.useEffect(() => {
    if (!open) setQ('');
  }, [open]);

  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const isMac = /mac/i.test(navigator.platform);
      const combo = isMac ? e.metaKey && e.key.toLowerCase() === 'k' : e.ctrlKey && e.key.toLowerCase() === 'k';
      if (combo) {
        e.preventDefault();
        onOpenChange(!open);
      }
      if (open && e.key === 'Escape') onOpenChange(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onOpenChange]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-24 bg-black/30"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      onMouseDown={() => onOpenChange(false)}
    >
      <div
        className="w-[680px] max-w-[95vw] rounded-2xl bg-white shadow-xl border"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="p-3 border-b">
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search… (Ctrl/⌘ K)"
            className="w-full rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-neutral-200"
          />
        </div>

        <div className="max-h-[420px] overflow-auto p-2">
          {items.length === 0 ? (
            <div className="p-6 text-sm text-neutral-500">No results.</div>
          ) : (
            <div className="space-y-1">
              {items.map((item) => {
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <button
                    key={item.href}
                    type="button"
                    onClick={() => {
                      onOpenChange(false);
                      router.push(item.href);
                    }}
                    className={`w-full text-left rounded-xl px-3 py-2 text-sm border transition-colors ${
                      active ? 'bg-neutral-50 border-neutral-200' : 'border-transparent hover:bg-neutral-50'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-neutral-900">{item.label}</span>
                      <span className="text-[11px] text-neutral-400">{item.href}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="p-3 border-t flex items-center justify-between text-[11px] text-neutral-500">
          <span>Navigate quickly across admin modules.</span>
          <Link href="/runbooks" className="underline">
            Runbooks
          </Link>
        </div>
      </div>
    </div>
  );
}
