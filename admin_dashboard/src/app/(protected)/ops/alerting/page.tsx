import Link from 'next/link';

import { requirePermission } from '@/lib/auth/guards';
import { getAlertingStatus } from '@/lib/admin/alerting';

function Badge({ label, ok }: { label: string; ok: boolean }) {
  const cls = ok ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-rose-50 text-rose-700 border-rose-200';
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] ${cls}`}>{label}</span>;
}

function fmt(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

export default async function OpsAlertingPage() {
  const { supabase } = await requirePermission('ops.view');
  const data = await getAlertingStatus(supabase, { limit: 200 });

  const channels = data.channels;

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Alerting & Notifications</h1>
          <div className="text-xs text-neutral-500">Environment: {data.env}</div>
          <div className="mt-2">
            <Link href="/ops" className="text-xs text-neutral-700 hover:underline">
              ← Back to Ops
            </Link>
          </div>
        </div>
      </div>

      <div className="rounded-xl border bg-white p-4 space-y-2">
        <div className="text-sm font-medium">Notification channels</div>
        <div className="text-xs text-neutral-600">
          This page shows whether channels are configured in the Edge runtime. Secret values are not displayed.
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge label={channels.slack_ticket ? 'Slack (ticket) configured' : 'Slack (ticket) missing'} ok={channels.slack_ticket} />
          <Badge label={channels.slack_page ? 'Slack (page) configured' : 'Slack (page) missing'} ok={channels.slack_page} />
          <Badge label={channels.webhook ? 'Webhook configured' : 'Webhook missing'} ok={channels.webhook} />
          <Badge label={channels.email ? 'Email configured' : 'Email missing'} ok={channels.email} />
        </div>
        <div className="text-[11px] text-neutral-500">
          Expected secrets: <span className="font-mono">OPS_SLACK_WEBHOOK_TICKET</span>, <span className="font-mono">OPS_SLACK_WEBHOOK_PAGE</span>,
          <span className="font-mono">OPS_WEBHOOK_URL</span>, <span className="font-mono">OPS_RESEND_API_KEY</span>, <span className="font-mono">OPS_EMAIL_FROM</span>,
          <span className="font-mono">OPS_EMAIL_TO</span>.
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-xl border bg-white p-4 space-y-2">
          <div className="text-sm font-medium">Active alerts</div>
          {data.active.length ? (
            <div className="overflow-auto rounded-lg border">
              <table className="w-full text-xs">
                <thead className="bg-neutral-50 text-neutral-700">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">rule</th>
                    <th className="px-3 py-2 text-left font-medium">severity</th>
                    <th className="px-3 py-2 text-left font-medium">active since</th>
                    <th className="px-3 py-2 text-left font-medium">escalated</th>
                  </tr>
                </thead>
                <tbody>
                  {data.active.map((a) => (
                    <tr key={a.rule_id} className="border-t align-top">
                      <td className="px-3 py-2 max-w-[22rem] break-words">{a.ops_alert_rules?.name ?? a.rule_id}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{a.ops_alert_rules?.severity ?? '—'}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{a.active_since ? new Date(a.active_since).toLocaleString() : '—'}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{a.escalated_at ? new Date(a.escalated_at).toLocaleString() : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-xs text-neutral-500">No active alerts.</div>
          )}
        </div>

        <div className="rounded-xl border bg-white p-4 space-y-2">
          <div className="text-sm font-medium">Recent alert events</div>
          {data.recent_events.length ? (
            <div className="overflow-auto rounded-lg border">
              <table className="w-full text-xs">
                <thead className="bg-neutral-50 text-neutral-700">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">time</th>
                    <th className="px-3 py-2 text-left font-medium">rule</th>
                    <th className="px-3 py-2 text-left font-medium">type</th>
                    <th className="px-3 py-2 text-left font-medium">notify</th>
                    <th className="px-3 py-2 text-left font-medium">attempts</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recent_events.slice(0, 200).map((e) => (
                    <tr key={e.id} className="border-t align-top">
                      <td className="px-3 py-2 whitespace-nowrap">{new Date(e.occurred_at).toLocaleString()}</td>
                      <td className="px-3 py-2 max-w-[20rem] break-words">{e.ops_alert_rules?.name ?? '—'}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{e.event_type}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {e.notify_status ?? '—'}
                        {e.notified_at ? (
                          <span className="text-[11px] text-neutral-500"> · {new Date(e.notified_at).toLocaleString()}</span>
                        ) : null}
                        {e.notified_error ? <div className="text-[11px] text-rose-700 break-words">{fmt(e.notified_error)}</div> : null}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">{e.notified_attempts}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-xs text-neutral-500">No recent alert events.</div>
          )}
        </div>
      </div>
    </div>
  );
}
