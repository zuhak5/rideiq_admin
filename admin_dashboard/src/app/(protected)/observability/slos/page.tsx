import Link from 'next/link';

import { requirePermission } from '@/lib/auth/guards';
import { getSloSummary } from '@/lib/admin/slo';

type SearchParams = Record<string, string | string[] | undefined>;

function toInt(v: string | string[] | undefined, def: number, min: number, max: number): number {
  const raw = Array.isArray(v) ? v[0] : v;
  if (!raw) return def;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, n));
}

function fmtMs(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—';
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  if (n >= 1000) return `${(n / 1000).toFixed(2)}s`;
  return `${n.toFixed(0)}ms`;
}

export default async function SloPage({ searchParams }: { searchParams: SearchParams }) {
  const { supabase } = await requirePermission('observability.view');

  const windowMinutes = toInt(searchParams.window, 60, 5, 24 * 60);
  const limit = toInt(searchParams.limit, 50, 1, 200);

  const data = await getSloSummary(supabase, { windowMinutes, limit });

  const windows = [
    { label: '15m', minutes: 15 },
    { label: '1h', minutes: 60 },
    { label: '6h', minutes: 360 },
    { label: '24h', minutes: 1440 },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Latency SLOs</h1>
          <div className="text-xs text-neutral-500">
            Window: {data.window_minutes}m · Since: {new Date(data.since).toLocaleString()}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <Link href="/observability" className="text-xs text-neutral-700 hover:underline">
              ← Back to Observability
            </Link>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="text-xs text-neutral-500">Window</div>
          <div className="flex gap-1">
            {windows.map((w) => {
              const active = w.minutes === windowMinutes;
              return (
                <Link
                  key={w.minutes}
                  href={`/observability/slos?window=${w.minutes}&limit=${limit}`}
                  className={`rounded-lg border px-2 py-1 text-xs ${active ? 'bg-neutral-900 text-white border-neutral-900' : 'bg-white text-neutral-700 hover:bg-neutral-50'}`}
                >
                  {w.label}
                </Link>
              );
            })}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="rounded-xl border bg-white p-4 space-y-2">
          <div className="text-sm font-medium">Totals (window)</div>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg border bg-neutral-50 p-2">
              <div className="text-[11px] text-neutral-500">Samples</div>
              <div className="text-lg font-semibold">{data.totals.total}</div>
            </div>
            <div className="rounded-lg border bg-neutral-50 p-2">
              <div className="text-[11px] text-neutral-500">Errors</div>
              <div className="text-lg font-semibold">{data.totals.errors}</div>
            </div>
            <div className="rounded-lg border bg-neutral-50 p-2 col-span-2">
              <div className="text-[11px] text-neutral-500">Error rate</div>
              <div className="text-lg font-semibold">{(data.totals.error_rate * 100).toFixed(2)}%</div>
            </div>
          </div>
        </div>

        <div className="rounded-xl border bg-white p-4 space-y-2 lg:col-span-2">
          <div className="text-sm font-medium">How to read this</div>
          <div className="text-xs text-neutral-600 space-y-1">
            <p>
              This table aggregates <span className="font-mono">app_events</span> where <span className="font-mono">event_type</span> matches
              <span className="font-mono"> metric.%_latency</span>. Percentiles are computed with Postgres <span className="font-mono">percentile_cont</span>.
            </p>
            <p>
              Use it for fast detection of latency regressions (p95/p99) and error spikes. For full SLO burn-rate alerting,
              define explicit SLOs per user journey and alert on multi-window burn rates.
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-xl border bg-white p-4 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-medium">Latency percentiles (by component + metric)</div>
          <div className="text-xs text-neutral-500">Top {data.rows.length} by sample volume</div>
        </div>

        {data.rows.length ? (
          <div className="overflow-auto rounded-lg border">
            <table className="w-full text-xs">
              <thead className="bg-neutral-50 text-neutral-700">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">component</th>
                  <th className="px-3 py-2 text-left font-medium">event_type</th>
                  <th className="px-3 py-2 text-right font-medium">total</th>
                  <th className="px-3 py-2 text-right font-medium">errors</th>
                  <th className="px-3 py-2 text-right font-medium">p50</th>
                  <th className="px-3 py-2 text-right font-medium">p95</th>
                  <th className="px-3 py-2 text-right font-medium">p99</th>
                  <th className="px-3 py-2 text-right font-medium">avg</th>
                  <th className="px-3 py-2 text-right font-medium">max</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => {
                  const errRate = r.total > 0 ? r.errors / r.total : 0;
                  return (
                    <tr key={`${r.component}:${r.event_type}`} className="border-t align-top">
                      <td className="px-3 py-2 whitespace-nowrap">{r.component}</td>
                      <td className="px-3 py-2 max-w-[30rem] break-words">{r.event_type}</td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">{r.total}</td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        {r.errors} <span className="text-[11px] text-neutral-500">({(errRate * 100).toFixed(2)}%)</span>
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">{fmtMs(r.p50_ms)}</td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">{fmtMs(r.p95_ms)}</td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">{fmtMs(r.p99_ms)}</td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">{fmtMs(r.avg_ms)}</td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">{fmtMs(r.max_ms)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-xs text-neutral-500">No latency metrics in this window.</div>
        )}
      </div>
    </div>
  );
}
