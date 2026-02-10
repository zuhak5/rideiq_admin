import React from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabaseClient';
import { getIsAdmin } from '../lib/admin';
import { errorText } from '../lib/errors';
import AdminNav from '../components/AdminNav';

type Row = {
  id: string;
  rider_id: string;
  pickup_address: string | null;
  dropoff_address: string | null;
  pickup_lat: number;
  pickup_lng: number;
  dropoff_lat: number;
  dropoff_lng: number;
  product_code: string;
  scheduled_at: string;
  status: string;
  executed_at: string | null;
  failure_reason: string | null;
  ride_request_id: string | null;
  created_at: string;
};

export default function AdminScheduledRidesPage() {
  const [page, setPage] = React.useState(0);
  const pageSize = 25;

  const q = useQuery({
    queryKey: ['admin_scheduled_rides', page],
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<Row[]> => {
      const isAdmin = await getIsAdmin();
      if (!isAdmin) throw new Error('Admin only');

      const from = page * pageSize;
      const to = from + pageSize - 1;
      const { data, error } = await supabase
        .from('scheduled_rides')
        .select(
          'id,rider_id,pickup_address,dropoff_address,pickup_lat,pickup_lng,dropoff_lat,dropoff_lng,product_code,scheduled_at,status,executed_at,failure_reason,ride_request_id,created_at'
        )
        .order('scheduled_at', { ascending: false })
        .range(from, to);

      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 space-y-4">
      <AdminNav />

      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div className="text-sm font-semibold">Scheduled rides</div>
            <div className="text-xs text-gray-500">Monitor upcoming/executed/failed scheduled rides</div>
          </div>
          <div className="flex gap-2">
            <button className="btn" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
              Prev
            </button>
            <button className="btn" onClick={() => setPage((p) => p + 1)}>
              Next
            </button>
          </div>
        </div>

        {q.isLoading ? <div className="mt-4 text-sm text-gray-500">Loading…</div> : null}
        {q.error ? <div className="mt-4 text-sm text-red-600">Error: {errorText(q.error)}</div> : null}

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500">
                <th className="py-2">When</th>
                <th className="py-2">Status</th>
                <th className="py-2">Rider</th>
                <th className="py-2">Pickup</th>
                <th className="py-2">Dropoff</th>
                <th className="py-2">Request</th>
                <th className="py-2">Failure</th>
              </tr>
            </thead>
            <tbody>
              {(q.data ?? []).map((r) => (
                <tr key={r.id} className="border-t border-gray-100">
                  <td className="py-2 whitespace-nowrap">{new Date(r.scheduled_at).toLocaleString()}</td>
                  <td className="py-2">{r.status}</td>
                  <td className="py-2 font-mono text-xs">{r.rider_id.slice(0, 8)}…</td>
                  <td className="py-2">{r.pickup_address ?? `${r.pickup_lat.toFixed(4)}, ${r.pickup_lng.toFixed(4)}`}</td>
                  <td className="py-2">{r.dropoff_address ?? `${r.dropoff_lat.toFixed(4)}, ${r.dropoff_lng.toFixed(4)}`}</td>
                  <td className="py-2 font-mono text-xs">{r.ride_request_id ? `${r.ride_request_id.slice(0, 8)}…` : '-'}</td>
                  <td className="py-2 text-xs text-red-600">{r.failure_reason ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
