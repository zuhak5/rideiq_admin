import React from 'react';
import { useQuery } from '@tanstack/react-query';
import AdminNav from '../components/AdminNav';
import { supabase } from '../lib/supabaseClient';
import { getIsAdmin } from '../lib/admin';
import { errorText } from '../lib/errors';
import { formatIQD } from '../lib/money';

type FareQuoteRow = {
  id: string;
  created_at: string;
  rider_id: string;
  service_area_id: string | null;
  service_area_name: string | null;
  service_area_governorate: string | null;
  product_code: string;
  total_iqd: number;
  route_distance_m: number | null;
  route_duration_s: number | null;
  breakdown: any;
  pricing_config_id: string | null;
};

async function fetchFareQuotes(params: {
  governorate?: string;
  product_code?: string;
  limit: number;
}): Promise<FareQuoteRow[]> {
  let q = supabase
    .from('fare_quotes')
    .select(
      'id,created_at,rider_id,service_area_id,service_area_name,service_area_governorate,product_code,total_iqd,route_distance_m,route_duration_s,breakdown,pricing_config_id',
    )
    .order('created_at', { ascending: false })
    .limit(params.limit);

  if (params.governorate && params.governorate !== 'all') {
    q = q.eq('service_area_governorate', params.governorate);
  }
  if (params.product_code && params.product_code !== 'all') {
    q = q.eq('product_code', params.product_code);
  }

  const { data, error } = await q;
  if (error) throw error;
  return (data as FareQuoteRow[]) ?? [];
}

function safeNumber(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export default function AdminFareQuotesPage() {
  const [isAdmin, setIsAdmin] = React.useState<boolean | null>(null);
  const [toast, setToast] = React.useState<string | null>(null);

  const [limit, setLimit] = React.useState<string>('200');
  const [gov, setGov] = React.useState<string>('all');
  const [product, setProduct] = React.useState<string>('all');

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

  const lim = Math.max(50, Math.min(1000, Number(limit || 200)));

  const quotes = useQuery({
    queryKey: ['admin_fare_quotes', gov, product, lim],
    queryFn: () => fetchFareQuotes({ governorate: gov, product_code: product, limit: lim }),
    enabled: isAdmin === true,
  });

  const governorates = React.useMemo(() => {
    const set = new Set<string>();
    for (const r of quotes.data ?? []) {
      if (r.service_area_governorate) set.add(r.service_area_governorate);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [quotes.data]);

  const products = React.useMemo(() => {
    const set = new Set<string>();
    for (const r of quotes.data ?? []) {
      if (r.product_code) set.add(r.product_code);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [quotes.data]);

  if (isAdmin === false) {
    return <div className="rounded-2xl border border-gray-200 bg-white p-6">Not authorized.</div>;
  }

  return (
    <div className="space-y-4">
      <AdminNav />

      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="text-sm font-semibold">Fare Quotes</div>
            <div className="text-xs text-gray-500 mt-1">
              Audit view of stored quotes from the route-based fare engine. Every row includes the computed breakdown and pricing snapshot reference.
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              className="btn"
              disabled={!quotes.data?.length}
              onClick={() => {
                try {
                  const blob = new Blob([JSON.stringify(quotes.data ?? [], null, 2)], { type: 'application/json' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `fare_quotes_${new Date().toISOString().slice(0, 10)}.json`;
                  a.click();
                  URL.revokeObjectURL(url);
                } catch (e) {
                  setToast(`Export failed: ${errorText(e)}`);
                }
              }}
            >
              Export JSON
            </button>
          </div>
        </div>

        {toast ? <div className="mt-3 rounded-xl border p-3 text-sm bg-white">{toast}</div> : null}

        <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
          <label className="text-sm">
            Governorate
            <select className="mt-1 w-full rounded-md border px-3 py-2" value={gov} onChange={(e) => setGov(e.target.value)}>
              <option value="all">All</option>
              {governorates.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm">
            Product
            <select className="mt-1 w-full rounded-md border px-3 py-2" value={product} onChange={(e) => setProduct(e.target.value)}>
              <option value="all">All</option>
              {products.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm">
            Limit
            <input className="mt-1 w-full rounded-md border px-3 py-2" value={limit} onChange={(e) => setLimit(e.target.value)} placeholder="200" />
          </label>
        </div>

        {quotes.isLoading ? <div className="mt-4 text-sm text-gray-600">Loading…</div> : null}
        {quotes.error ? <div className="mt-4 text-sm text-red-700">{errorText(quotes.error)}</div> : null}

        <div className="mt-4 space-y-2">
          {(quotes.data ?? []).map((r) => {
            const bd = r.breakdown ?? {};
            const distanceKm = safeNumber(bd.distance_km) ?? (r.route_distance_m != null ? r.route_distance_m / 1000 : null);
            const durationMin = safeNumber(bd.duration_min) ?? (r.route_duration_s != null ? r.route_duration_s / 60 : null);
            const surge = safeNumber(bd.surge_multiplier_applied);
            const productMult = safeNumber(bd.product_multiplier);

            return (
              <div key={r.id} className="rounded-xl border p-3">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="text-sm">
                    <div className="font-medium">
                      {formatIQD(r.total_iqd)}
                      {r.service_area_name ? <span className="ml-2 text-gray-600">{r.service_area_name}</span> : null}
                      {r.service_area_governorate ? <span className="ml-2 text-gray-500">({r.service_area_governorate})</span> : null}
                    </div>
                    <div className="text-xs text-gray-600 mt-1">
                      {new Date(r.created_at).toLocaleString()} • product={r.product_code} • pricing_config={r.pricing_config_id ?? '—'}
                    </div>
                    <div className="text-xs text-gray-600 mt-1">
                      {distanceKm != null ? `${distanceKm.toFixed(2)} km` : '—'} • {durationMin != null ? `${durationMin.toFixed(0)} min` : '—'}
                      {surge != null ? ` • surge=${surge.toFixed(2)}×` : ''}
                      {productMult != null ? ` • product=${productMult.toFixed(2)}×` : ''}
                    </div>
                  </div>

                  <details className="text-xs">
                    <summary className="cursor-pointer text-gray-700">Breakdown JSON</summary>
                    <pre className="mt-2 max-w-[72ch] overflow-auto rounded-lg bg-gray-50 p-3 text-[11px] leading-snug">
                      {JSON.stringify(bd, null, 2)}
                    </pre>
                  </details>
                </div>

                <div className="mt-2 text-[11px] text-gray-500">
                  quote_id={r.id} • rider_id={r.rider_id}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
