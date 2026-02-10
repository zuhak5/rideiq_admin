import Link from 'next/link';

import { requirePermission } from '@/lib/auth/guards';
import { getObservabilitySummary } from '@/lib/admin/observability';

type SearchParams = Record<string, string | string[] | undefined>;

function toInt(v: string | string[] | undefined, def: number, min: number, max: number): number {
  const raw = Array.isArray(v) ? v[0] : v;
  if (!raw) return def;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, n));
}

function Badge({ label, variant }: { label: string; variant: 'info' | 'warning' | 'critical' }) {
  const cls =
    variant === 'critical'
      ? 'bg-red-50 text-red-700 border-red-200'
      : variant === 'warning'
        ? 'bg-amber-50 text-amber-700 border-amber-200'
        : 'bg-neutral-50 text-neutral-700 border-neutral-200';
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] ${cls}`}>{label}</span>;
}

export default async function ObservabilityPage({ searchParams }: { searchParams: SearchParams }) {
  const { supabase } = await requirePermission('observability.view');

  const windowMinutes = toInt(searchParams.window, 60, 5, 24 * 60);
  const data = await getObservabilitySummary(supabase, { windowMinutes });

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
          <h1 className="text-xl font-semibold">Observability</h1>
          <div className="text-xs text-neutral-500">
            Window: {data.window_minutes}m · Generated: {new Date(data.generated_at).toLocaleString()}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="text-xs text-neutral-500">Window</div>
          <div className="flex gap-1">
            {windows.map((w) => {
              const active = w.minutes === windowMinutes;
              return (
                <Link
                  key={w.minutes}
                  href={`/observability?window=${w.minutes}`}
                  className={`rounded-lg border px-2 py-1 text-xs ${active ? 'bg-neutral-900 text-white border-neutral-900' : 'bg-white text-neutral-700 hover:bg-neutral-50'}`}
                >
                  {w.label}
                </Link>
              );
            })}
          </div>
          <Link href={`/observability/slos?window=${windowMinutes}`} className="ml-2 text-xs text-neutral-700 hover:underline">
            Latency SLOs
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="rounded-xl border bg-white p-4 space-y-2">
          <div className="text-sm font-medium">Event volume (window)</div>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg border bg-neutral-50 p-2">
              <div className="text-[11px] text-neutral-500">Total</div>
              <div className="text-lg font-semibold">{data.counts.window.total}</div>
            </div>
            <div className="rounded-lg border bg-neutral-50 p-2">
              <div className="text-[11px] text-neutral-500">Errors</div>
              <div className="text-lg font-semibold">{data.counts.window.error}</div>
            </div>
            <div className="rounded-lg border bg-neutral-50 p-2">
              <div className="text-[11px] text-neutral-500">Warnings</div>
              <div className="text-lg font-semibold">{data.counts.window.warn}</div>
            </div>
            <div className="rounded-lg border bg-neutral-50 p-2">
              <div className="text-[11px] text-neutral-500">Info</div>
              <div className="text-lg font-semibold">{data.counts.window.info}</div>
            </div>
          </div>
        </div>

        <div className="rounded-xl border bg-white p-4 space-y-2">
          <div className="text-sm font-medium">Signals (15m)</div>
          <div className="text-xs text-neutral-500">These are derived from app_events (service-role query).</div>
          <div className="space-y-2">
            <div className="flex items-center justify-between rounded-lg border bg-neutral-50 p-2">
              <div className="text-xs">Webhook internal errors</div>
              <div className="text-xs font-semibold">{data.derived.webhook_internal_errors_15m}</div>
            </div>
            <div className="flex items-center justify-between rounded-lg border bg-neutral-50 p-2">
              <div className="text-xs">Webhook auth failures</div>
              <div className="text-xs font-semibold">{data.derived.webhook_auth_fail_15m}</div>
            </div>
            <div className="flex items-center justify-between rounded-lg border bg-neutral-50 p-2">
              <div className="text-xs">Maps misconfigured</div>
              <div className="text-xs font-semibold">{data.derived.maps_misconfigured_15m}</div>
            </div>
          </div>
        </div>

        <div className="rounded-xl border bg-white p-4 space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium">Alerts</div>
            <Link href="/runbooks" className="text-xs text-neutral-600 hover:underline">
              Runbooks
            </Link>
          </div>
          <div className="space-y-2">
            {data.alerts.map((a) => (
              <div key={a.id} className="rounded-lg border bg-neutral-50 p-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs font-medium text-neutral-800">{a.title}</div>
                  <div className="flex items-center gap-2">
                    {a.active ? <Badge label="active" variant={a.severity} /> : <Badge label="ok" variant="info" />}
                    <Link href={a.runbook} className="text-[11px] text-neutral-600 hover:underline">
                      runbook
                    </Link>
                  </div>
                </div>
                <div className="mt-1 text-[11px] text-neutral-600 break-words">{a.message}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-xl border bg-white p-4 space-y-2">
          <div className="text-sm font-medium">Top event types (sample)</div>
          {data.top_event_types.length ? (
            <div className="overflow-auto rounded-lg border">
              <table className="w-full text-xs">
                <thead className="bg-neutral-50 text-neutral-700">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">event_type</th>
                    <th className="px-3 py-2 text-right font-medium">total</th>
                    <th className="px-3 py-2 text-right font-medium">error</th>
                    <th className="px-3 py-2 text-right font-medium">warn</th>
                  </tr>
                </thead>
                <tbody>
                  {data.top_event_types.map((r) => (
                    <tr key={r.event_type} className="border-t">
                      <td className="px-3 py-2 max-w-[28rem] break-words">{r.event_type}</td>
                      <td className="px-3 py-2 text-right">{r.total}</td>
                      <td className="px-3 py-2 text-right">{r.error}</td>
                      <td className="px-3 py-2 text-right">{r.warn}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-xs text-neutral-500">No data in this window.</div>
          )}
          <div className="text-[11px] text-neutral-500">
            Note: this is computed from a bounded sample of recent events for speed.
          </div>
        </div>

        <div className="rounded-xl border bg-white p-4 space-y-2">
          <div className="text-sm font-medium">Recent warnings / errors</div>
          {data.recent_events.length ? (
            <div className="overflow-auto rounded-lg border">
              <table className="w-full text-xs">
                <thead className="bg-neutral-50 text-neutral-700">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">time</th>
                    <th className="px-3 py-2 text-left font-medium">level</th>
                    <th className="px-3 py-2 text-left font-medium">event_type</th>
                    <th className="px-3 py-2 text-left font-medium">request_id</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recent_events.map((e) => (
                    <tr key={e.id} className="border-t align-top">
                      <td className="px-3 py-2 whitespace-nowrap">{new Date(e.created_at).toLocaleString()}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{e.level}</td>
                      <td className="px-3 py-2 max-w-[26rem] break-words">{e.event_type}</td>
                      <td className="px-3 py-2 whitespace-nowrap font-mono text-[11px]">{e.request_id ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-xs text-neutral-500">No warnings/errors in this window.</div>
          )}
        </div>
      </div>
    </div>
  );
}
