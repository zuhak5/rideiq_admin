import Link from 'next/link';

import { requirePermission } from '@/lib/auth/guards';
import { getOpsDashboard } from '@/lib/admin/ops';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function formatCell(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (v instanceof Date) return v.toISOString();
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function RecordsTable({ rows, maxCols = 8 }: { rows: unknown[]; maxCols?: number }) {
  const first = rows[0];
  if (!isRecord(first)) {
    return (
      <pre className="text-xs whitespace-pre-wrap break-words rounded-lg border bg-neutral-50 p-3 overflow-auto">
        {JSON.stringify(rows, null, 2)}
      </pre>
    );
  }

  const columns = Object.keys(first).slice(0, Math.max(1, maxCols));
  return (
    <div className="overflow-auto rounded-lg border">
      <table className="w-full text-xs">
        <thead className="bg-neutral-50 text-neutral-700">
          <tr>
            {columns.map((c) => (
              <th key={c} className="px-3 py-2 text-left font-medium whitespace-nowrap">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 50).map((row, idx) => (
            <tr key={idx} className="border-t align-top">
              {columns.map((c) => (
                <td key={c} className="px-3 py-2 max-w-[26rem] break-words">
                  {formatCell((row as any)[c])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function KeyValueGrid({ value }: { value: unknown }) {
  if (!isRecord(value)) {
    return (
      <pre className="text-xs whitespace-pre-wrap break-words rounded-lg border bg-neutral-50 p-3 overflow-auto">
        {JSON.stringify(value, null, 2)}
      </pre>
    );
  }

  const entries = Object.entries(value);
  if (entries.length === 0) {
    return <div className="text-xs text-neutral-500">No data.</div>;
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      {entries.map(([k, v]) => (
        <div key={k} className="rounded-lg border bg-neutral-50 p-2">
          <div className="text-[11px] font-medium text-neutral-700">{k}</div>
          <div className="mt-1 text-[11px] text-neutral-700 break-words">{formatCell(v)}</div>
        </div>
      ))}
    </div>
  );
}

export default async function OpsPage() {
  const { supabase } = await requirePermission('ops.view');
  const data = await getOpsDashboard(supabase);

  const dashboards = (data.dashboards ?? {}) as Record<string, unknown>;
  const webhook = Array.isArray(dashboards.webhook) ? (dashboards.webhook as unknown[]) : [];
  const payments = Array.isArray(dashboards.payments) ? (dashboards.payments as unknown[]) : [];

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Ops</h1>
          <div className="text-xs text-neutral-500">
            Window: {data.window_minutes}m · Generated: {new Date(data.generated_at).toLocaleString()}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Link href="/ops/alerting" className="rounded-lg border bg-white px-3 py-2 text-xs text-neutral-700 hover:bg-neutral-50">
            Alerting & Notifications
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-xl border bg-white p-4 space-y-2">
          <div className="text-sm font-medium">Alerts (state)</div>
          {Array.isArray(data.alerts.state) && data.alerts.state.length ? (
            <RecordsTable rows={data.alerts.state} maxCols={10} />
          ) : (
            <div className="text-xs text-neutral-500">No alerts.</div>
          )}
        </div>
        <div className="rounded-xl border bg-white p-4 space-y-2">
          <div className="text-sm font-medium">Recent alert events</div>
          {Array.isArray(data.alerts.recent_events) && data.alerts.recent_events.length ? (
            <RecordsTable rows={data.alerts.recent_events} maxCols={10} />
          ) : (
            <div className="text-xs text-neutral-500">No recent events.</div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-xl border bg-white p-4 space-y-2">
          <div className="text-sm font-medium">Dispatch</div>
          <KeyValueGrid value={dashboards.dispatch} />
        </div>
        <div className="rounded-xl border bg-white p-4 space-y-2">
          <div className="text-sm font-medium">Safety</div>
          <KeyValueGrid value={dashboards.safety} />
        </div>
        <div className="rounded-xl border bg-white p-4 space-y-2">
          <div className="text-sm font-medium">Maps</div>
          <KeyValueGrid value={dashboards.maps} />
        </div>
        <div className="rounded-xl border bg-white p-4 space-y-2">
          <div className="text-sm font-medium">Jobs</div>
          <KeyValueGrid value={dashboards.jobs} />
        </div>
        <div className="rounded-xl border bg-white p-4 space-y-2">
          <div className="text-sm font-medium">Job worker</div>
          <KeyValueGrid value={dashboards.job_worker} />
        </div>
        <div className="rounded-xl border bg-white p-4 space-y-2">
          <div className="text-sm font-medium">Database</div>
          <KeyValueGrid value={dashboards.db} />
        </div>
      </div>

      <div className="rounded-xl border bg-white p-4 space-y-2">
        <div className="text-sm font-medium">Webhook health</div>
        {webhook.length ? <RecordsTable rows={webhook} maxCols={10} /> : <div className="text-xs text-neutral-500">No data.</div>}
      </div>

      <div className="rounded-xl border bg-white p-4 space-y-2">
        <div className="text-sm font-medium">Payments health</div>
        {payments.length ? (
          <RecordsTable rows={payments} maxCols={10} />
        ) : (
          <div className="text-xs text-neutral-500">No data.</div>
        )}
      </div>
    </div>
  );
}
