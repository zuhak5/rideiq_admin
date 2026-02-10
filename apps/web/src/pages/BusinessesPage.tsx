import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { listApprovedMerchants } from '../lib/merchant';

export default function BusinessesPage() {
  const [q, setQ] = useState('');
  const { data, isLoading, error } = useQuery({
    queryKey: ['merchants', 'approved'],
    queryFn: listApprovedMerchants,
  });

  const rows = useMemo(() => {
    const v = (data ?? []);
    const needle = q.trim().toLowerCase();
    if (!needle) return v;
    return v.filter((m) => (m.business_name ?? '').toLowerCase().includes(needle) || (m.business_type ?? '').toLowerCase().includes(needle));
  }, [data, q]);

  return (
    <div className="max-w-3xl mx-auto p-4 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Businesses</h1>
        <input
          className="border rounded px-3 py-2 w-64"
          placeholder="Search businesses…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {isLoading && <div className="text-sm text-gray-500">Loading…</div>}
      {error && <div className="text-sm text-red-600">Failed to load businesses.</div>}

      <div className="grid gap-3">
        {rows.map((m) => (
          <Link key={m.id} to={`/business/${m.id}`} className="border rounded p-3 hover:bg-gray-50 transition">
            <div className="font-medium">{m.business_name}</div>
            <div className="text-sm text-gray-600">{m.business_type}</div>
            <div className="text-xs text-gray-500 mt-1">Status: {m.status}</div>
          </Link>
        ))}
        {rows.length === 0 && !isLoading && <div className="text-sm text-gray-500">No businesses found.</div>}
      </div>
    </div>
  );
}
