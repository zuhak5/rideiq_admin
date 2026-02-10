import React from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import AdminNav from '../components/AdminNav';
import { supabase } from '../lib/supabaseClient';
import { getIsAdmin } from '../lib/admin';
import { errorText } from '../lib/errors';
import { invokeEdge } from '../lib/edgeInvoke';
import { debounce } from '../lib/debounce';

type RideIntentRow = {
  id: string;
  rider_id: string;
  source: string;
  status: 'new' | 'converted' | 'closed';
  pickup_address: string | null;
  dropoff_address: string | null;
  pickup_lat: number;
  pickup_lng: number;
  dropoff_lat: number;
  dropoff_lng: number;
  service_area_id: string | null;
  scheduled_at: string | null;
  converted_request_id: string | null;
  created_at: string;
};

async function fetchIntents(status: string): Promise<RideIntentRow[]> {
  let q = supabase
    .from('ride_intents')
    .select(
      'id,rider_id,source,status,pickup_address,dropoff_address,pickup_lat,pickup_lng,dropoff_lat,dropoff_lng,service_area_id,scheduled_at,converted_request_id,created_at',
    )
    .order('created_at', { ascending: false })
    .limit(100);

  if (status !== 'all') q = q.eq('status', status);

  const { data, error } = await q;
  if (error) throw error;
  return (data as RideIntentRow[]) ?? [];
}

export default function AdminRideIntentsPage() {
  const qc = useQueryClient();
  const [isAdmin, setIsAdmin] = React.useState<boolean | null>(null);
  type StatusFilter = 'all' | 'new' | 'converted' | 'closed';
  const isStatusFilter = (v: string): v is StatusFilter => v === 'all' || v === 'new' || v === 'converted' || v === 'closed';
  const [status, setStatus] = React.useState<StatusFilter>('new');
  const [toast, setToast] = React.useState<string | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);

  React.useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const ok = await getIsAdmin();
        if (!alive) return;
        setIsAdmin(ok);
      } catch {
        if (!alive) return;
        setIsAdmin(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const intents = useQuery({
    queryKey: ['admin_ride_intents', status],
    queryFn: () => fetchIntents(status),
    enabled: isAdmin === true,
  });

  const invalidateRideIntents = React.useMemo(
    () =>
      debounce(() => {
        void qc.invalidateQueries({ queryKey: ['admin_ride_intents'] });
      }, 300),
    [qc],
  );

  // Live updates (requires ride_intents in the supabase_realtime publication).
  React.useEffect(() => {
    if (isAdmin !== true) return;
    let sub: RealtimeChannel | null = null;

    sub = supabase
      .channel('admin-ride-intents')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ride_intents' }, () => {
        invalidateRideIntents();
      })
      .subscribe();

    return () => {
      if (sub) supabase.removeChannel(sub);
    };
  }, [isAdmin, invalidateRideIntents]);

  if (isAdmin === false) {
    return <div className="rounded-2xl border border-gray-200 bg-white p-6">Not authorized.</div>;
  }

  return (
    <div className="space-y-4">
      <AdminNav />

      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="text-sm font-semibold">Ride Intents</div>
            <div className="text-xs text-gray-500">
              Call-center leads captured when riders cannot (or prefer not to) place a request in-app.
            </div>
          </div>

          <div className="flex items-center gap-2">
            <select
              className="rounded-md border px-3 py-2 text-sm"
              value={status}
                onChange={(e) => {
                  const v = e.target.value;
                  setStatus(isStatusFilter(v) ? v : 'all');
                }}
            >
              <option value="new">New</option>
              <option value="converted">Converted</option>
              <option value="closed">Closed</option>
              <option value="all">All</option>
            </select>
            <button className="btn" onClick={() => qc.invalidateQueries({ queryKey: ['admin_ride_intents'] })}>
              Refresh
            </button>
          </div>
        </div>

        {toast ? <div className="mt-3 rounded-xl border p-3 text-sm bg-white">{toast}</div> : null}

        {intents.isLoading ? <div className="mt-4 text-sm text-gray-500">Loading…</div> : null}
        {intents.error ? <div className="mt-4 text-sm text-red-600">{errorText(intents.error)}</div> : null}

        <div className="mt-4 space-y-3">
          {(intents.data ?? []).map((it) => (
            <div key={it.id} className="border border-gray-200 rounded-2xl p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-semibold">
                  {it.pickup_address ?? 'Pickup'} → {it.dropoff_address ?? 'Dropoff'}
                </div>
                <div className="text-xs text-gray-500">{new Date(it.created_at).toLocaleString()}</div>
              </div>

              <div className="mt-2 text-xs text-gray-600 flex flex-wrap gap-2">
                <span className="rounded-full border px-2 py-1">status: {it.status}</span>
                <span className="rounded-full border px-2 py-1">source: {it.source}</span>
                {it.scheduled_at ? (
                  <span className="rounded-full border px-2 py-1">scheduled: {new Date(it.scheduled_at).toLocaleString()}</span>
                ) : null}
                {it.service_area_id ? <span className="rounded-full border px-2 py-1">area: {it.service_area_id.slice(0, 8)}…</span> : null}
                {it.converted_request_id ? (
                  <span className="rounded-full border px-2 py-1">request: {it.converted_request_id.slice(0, 8)}…</span>
                ) : null}
              </div>

              <div className="mt-3 text-xs text-gray-500">
                Pickup coords: {it.pickup_lat}, {it.pickup_lng} • Dropoff coords: {it.dropoff_lat}, {it.dropoff_lng}
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  className="btn"
                  disabled={busyId === it.id || it.status !== 'new'}
                  onClick={async () => {
                    setBusyId(it.id);
                    setToast(null);
                    try {
                      await invokeEdge('admin-ride-intent-convert', { intent_id: it.id });
                      setToast('Converted to a ride request.');
                      qc.invalidateQueries({ queryKey: ['admin_ride_intents'] });
                      qc.invalidateQueries({ queryKey: ['ride_requests'] });
                    } catch (e: unknown) {
                      setToast(`Error: ${errorText(e)}`);
                    } finally {
                      setBusyId(null);
                    }
                  }}
                >
                  Convert → ride request
                </button>

                <button
                  className="btn"
                  disabled={busyId === it.id || it.status === 'closed'}
                  onClick={async () => {
                    setBusyId(it.id);
                    setToast(null);
                    try {
                      const { error } = await supabase.from('ride_intents').update({ status: 'closed' }).eq('id', it.id);
                      if (error) throw error;
                      setToast('Closed.');
                      qc.invalidateQueries({ queryKey: ['admin_ride_intents'] });
                    } catch (e: unknown) {
                      setToast(`Error: ${errorText(e)}`);
                    } finally {
                      setBusyId(null);
                    }
                  }}
                >
                  Close
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}