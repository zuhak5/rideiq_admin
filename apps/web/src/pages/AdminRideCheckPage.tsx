import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabaseClient';
import { getIsAdmin } from '../lib/admin';
import { errorText } from '../lib/errors';
import AdminNav from '../components/AdminNav';

type RideCheckEvent = {
  id: string;
  ride_id: string;
  kind: string;
  status: string;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  metadata: Record<string, unknown>;
};

type RideCheckResponse = {
  id: string;
  event_id: string;
  ride_id: string;
  user_id: string;
  role: 'rider' | 'driver' | string;
  response: 'ok' | 'false_alarm' | 'need_help' | string;
  note: string | null;
  created_at: string;
};

async function fetchEvents(statusFilter: string): Promise<{ events: RideCheckEvent[]; responsesByEvent: Record<string, RideCheckResponse[]> }> {
  const { data: events, error } = await supabase
    .from('ridecheck_events')
    .select('id,ride_id,kind,status,created_at,updated_at,resolved_at,metadata')
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) throw error;

  const filtered = (events ?? []) as RideCheckEvent[];
  const finalEvents = statusFilter === 'all' ? filtered : filtered.filter((e) => e.status === statusFilter);

  const ids = finalEvents.map((e) => e.id);
  if (!ids.length) return { events: finalEvents, responsesByEvent: {} };

  const { data: resp, error: respErr } = await supabase
    .from('ridecheck_responses')
    .select('id,event_id,ride_id,user_id,role,response,note,created_at')
    .in('event_id', ids)
    .order('created_at', { ascending: false })
    .limit(400);
  if (respErr) throw respErr;

  const map: Record<string, RideCheckResponse[]> = {};
  for (const r of (resp ?? []) as RideCheckResponse[]) {
    if (!map[r.event_id]) map[r.event_id] = [];
    map[r.event_id].push(r);
  }
  return { events: finalEvents, responsesByEvent: map };
}

function Badge({ text }: { text: string }) {
  const base = 'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium border';
  if (text === 'open') return <span className={`${base} border-amber-200 bg-amber-50 text-amber-800`}>open</span>;
  if (text === 'resolved') return <span className={`${base} border-emerald-200 bg-emerald-50 text-emerald-800`}>resolved</span>;
  if (text === 'escalated') return <span className={`${base} border-red-200 bg-red-50 text-red-800`}>escalated</span>;
  return <span className={`${base} border-gray-200 bg-gray-50 text-gray-700`}>{text}</span>;
}

function ResponsePill({ r }: { r: RideCheckResponse }) {
  const base = 'inline-flex items-center rounded-full px-2 py-0.5 text-xs border';
  const label = `${r.role}:${r.response}`;
  if (r.response === 'need_help') return <span className={`${base} border-red-200 bg-red-50 text-red-800`}>{label}</span>;
  if (r.response === 'ok') return <span className={`${base} border-emerald-200 bg-emerald-50 text-emerald-800`}>{label}</span>;
  if (r.response === 'false_alarm') return <span className={`${base} border-gray-200 bg-gray-50 text-gray-700`}>{label}</span>;
  return <span className={`${base} border-gray-200 bg-gray-50 text-gray-700`}>{label}</span>;
}

export default function AdminRideCheckPage() {
  const adminQ = useQuery({ queryKey: ['is_admin'], queryFn: getIsAdmin });
  const [status, setStatus] = React.useState<'open' | 'resolved' | 'escalated' | 'all'>('open');

  const dataQ = useQuery({
    queryKey: ['admin_ridecheck', { status }],
    queryFn: () => fetchEvents(status),
    enabled: adminQ.data === true,
    refetchInterval: 15000,
    refetchIntervalInBackground: false,
  });

  const err = dataQ.error ? errorText(dataQ.error) : null;
  const events = dataQ.data?.events ?? [];
  const responsesByEvent = dataQ.data?.responsesByEvent ?? {};

  async function resolveEvent(eventId: string) {
    const note = window.prompt('Resolution note (optional):') ?? '';
    const { error } = await supabase.rpc('admin_ridecheck_resolve', { p_event_id: eventId, p_note: note });
    if (error) {
      window.alert(error.message);
      return;
    }
    void dataQ.refetch();
  }

  async function escalateEvent(eventId: string) {
    const note = window.prompt('Escalation note (recommended):') ?? '';
    const { data, error } = await supabase.rpc('admin_ridecheck_escalate', { p_event_id: eventId, p_note: note });
    if (error) {
      window.alert(error.message);
      return;
    }
    window.alert(`Escalated. Incident created: ${String(data ?? '')}`);
    void dataQ.refetch();
  }

  return (
    <div className="space-y-4">
      <AdminNav />

      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="text-lg font-semibold">RideCheck</div>
            <div className="text-xs text-gray-500">Monitor safety prompts and triage responses.</div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <label className="text-xs text-gray-600">
              Status
              <select
                className="ml-2 rounded-xl border border-gray-200 px-2 py-1 text-sm"
                value={status}
                onChange={(e) => setStatus(e.target.value as typeof status)}
              >
                <option value="open">open</option>
                <option value="resolved">resolved</option>
                <option value="escalated">escalated</option>
                <option value="all">all</option>
              </select>
            </label>

            <button
              className="rounded-xl bg-gray-900 px-3 py-2 text-sm text-white disabled:opacity-60"
              onClick={() => void dataQ.refetch()}
              type="button"
              disabled={dataQ.isFetching}
            >
              {dataQ.isFetching ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        </div>

        {adminQ.isLoading ? <div className="mt-3 text-sm text-gray-600">Checking admin…</div> : null}
        {adminQ.data === false ? <div className="mt-3 text-sm text-red-700">Admin access required.</div> : null}
        {err ? <div className="mt-3 text-sm text-red-700">{err}</div> : null}
        <div className="mt-2 text-xs text-gray-500">Showing: {events.length} events</div>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm overflow-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-600">
            <tr>
              <th className="px-3 py-2 text-left font-medium whitespace-nowrap">Created</th>
              <th className="px-3 py-2 text-left font-medium whitespace-nowrap">Kind</th>
              <th className="px-3 py-2 text-left font-medium whitespace-nowrap">Status</th>
              <th className="px-3 py-2 text-left font-medium whitespace-nowrap">Ride</th>
              <th className="px-3 py-2 text-left font-medium whitespace-nowrap">Latest responses</th>
              <th className="px-3 py-2 text-left font-medium whitespace-nowrap">Actions</th>
            </tr>
          </thead>
          <tbody>
            {events.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-gray-600">
                  No RideCheck events.
                </td>
              </tr>
            ) : null}

            {events.map((e, idx) => {
              const responses = responsesByEvent[e.id] ?? [];
              const latest = responses.slice(0, 4);

              return (
                <tr key={e.id} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                  <td className="px-3 py-2 whitespace-nowrap text-xs text-gray-700">{new Date(e.created_at).toLocaleString()}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <span className="font-mono text-xs">{e.kind}</span>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <Badge text={e.status} />
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <span className="font-mono text-xs">{e.ride_id}</span>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {latest.length ? latest.map((r) => <ResponsePill key={r.id} r={r} />) : <span className="text-xs text-gray-500">—</span>}
                    </div>
                    {responses.find((r) => r.note) ? (
                      <div className="mt-1 text-xs text-gray-500">Note: {String(responses.find((r) => r.note)?.note ?? '').slice(0, 140)}</div>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <button
                        className="rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-xs hover:bg-gray-50 disabled:opacity-50"
                        type="button"
                        onClick={() => void resolveEvent(e.id)}
                        disabled={e.status !== 'open'}
                      >
                        Resolve
                      </button>
                      <button
                        className="rounded-xl border border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-800 hover:bg-red-100 disabled:opacity-50"
                        type="button"
                        onClick={() => void escalateEvent(e.id)}
                        disabled={e.status !== 'open'}
                      >
                        Escalate
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
