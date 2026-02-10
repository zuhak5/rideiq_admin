'use client';

import Link from 'next/link';
import { cn } from '@/lib/utils';

export function StatCard(props: {
  label: string;
  value: string | number;
  href?: string;
  subtitle?: string;
  tone?: 'default' | 'warn' | 'danger';
}) {
  const tone = props.tone ?? 'default';
  const body = (
    <div
      className={cn(
        'rounded-xl border bg-white p-4 transition-colors',
        props.href ? 'hover:bg-neutral-50' : '',
      )}
    >
      <div className="text-xs text-neutral-500">{props.label}</div>
      <div
        className={cn(
          'mt-1 text-2xl font-semibold',
          tone === 'danger' ? 'text-red-600' : tone === 'warn' ? 'text-amber-600' : 'text-neutral-900',
        )}
      >
        {props.value}
      </div>
      {props.subtitle ? <div className="mt-2 text-xs text-neutral-500">{props.subtitle}</div> : null}
    </div>
  );

  return props.href ? (
    <Link href={props.href} className="block">
      {body}
    </Link>
  ) : (
    body
  );
}
