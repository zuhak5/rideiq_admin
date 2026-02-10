import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabaseClient';
import { getIsAdmin } from '../lib/admin';
import { errorText } from '../lib/errors';
import AdminNav from '../components/AdminNav';
import { formatIQD, parseIQDInput } from '../lib/money';

type CommissionRow = {
  merchant_id: string | null;
  business_name: string;
  specific_rate_bps: number | string | null;
  specific_flat_fee_iqd: number | string | null;
  specific_cod_handling_rate_bps: number | string | null;
  specific_cod_handling_flat_fee_iqd: number | string | null;
  effective_rate_bps: number | string;
  effective_flat_fee_iqd: number | string;
  effective_cod_handling_rate_bps: number | string;
  effective_cod_handling_flat_fee_iqd: number | string;
  updated_at: string;
  is_default: boolean;
};

function asNumber(v: number | string | null | undefined): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function fmtTime(ts: string | null | undefined): string {
  if (!ts) return '—';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString();
}

async function fetchCommissions(): Promise<CommissionRow[]> {
  const { data, error } = await supabase.rpc('admin_merchant_commission_list_v2', {
    p_limit: 500,
    p_offset: 0,
  });
  if (error) throw error;
  return (Array.isArray(data) ? data : []) as CommissionRow[];
}

export default function AdminCommissionsPage() {
  const qc = useQueryClient();

  const isAdminQ = useQuery<boolean, Error>({
    queryKey: ['admin_is_admin'],
    queryFn: () => getIsAdmin(),
    staleTime: 60_000,
  });

  const isAdmin = isAdminQ.data === true;

  const commissionsQ = useQuery<CommissionRow[], Error>({
    queryKey: ['admin_merchant_commissions'],
    queryFn: fetchCommissions,
    enabled: isAdmin,
    staleTime: 10_000,
  });

  const [filter, setFilter] = React.useState('');

  // Inline edit state per merchant (and default).
  const [draft, setDraft] = React.useState<Record<string, { rateBps: string; flatFee: string; codRateBps: string; codFlatFee: string }>>({});

  const setDraftFor = React.useCallback((key: string, rateBps: string, flatFee: string, codRateBps: string, codFlatFee: string) => {
    setDraft((d) => ({ ...d, [key]: { rateBps, flatFee, codRateBps, codFlatFee } }));
  }, []);

  React.useEffect(() => {
    const rows = commissionsQ.data;
    if (!rows) return;
    // Seed drafts only for rows we haven't touched.
    setDraft((prev) => {
      const next = { ...prev };
      for (const r of rows) {
        const key = r.is_default ? 'DEFAULT' : String(r.merchant_id);
        if (!key || next[key]) continue;
        const rate = r.specific_rate_bps ?? r.effective_rate_bps;
        const flat = r.specific_flat_fee_iqd ?? r.effective_flat_fee_iqd;
        const codRate = r.specific_cod_handling_rate_bps ?? r.effective_cod_handling_rate_bps;
        const codFlat = r.specific_cod_handling_flat_fee_iqd ?? r.effective_cod_handling_flat_fee_iqd;
        next[key] = {
          rateBps: String(asNumber(rate)),
          flatFee: String(asNumber(flat)),
          codRateBps: String(asNumber(codRate)),
          codFlatFee: String(asNumber(codFlat)),
        };
      }
      return next;
    });
  }, [commissionsQ.data]);

  const setMut = useMutation({
    mutationFn: async (args: { merchantId: string | null; rateBps: number; flatFee: number; codRateBps: number; codFlatFee: number }) => {
      const { error } = await supabase.rpc('admin_merchant_commission_set_v2', {
        p_merchant_id: args.merchantId,
        p_rate_bps: args.rateBps,
        p_flat_fee_iqd: args.flatFee,
        p_cod_handling_rate_bps: args.codRateBps,
        p_cod_handling_flat_fee_iqd: args.codFlatFee,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['admin_merchant_commissions'] });
    },
  });

  const clearMut = useMutation({
    mutationFn: async (merchantId: string) => {
      const { error } = await supabase.rpc('admin_merchant_commission_clear_v2', {
        p_merchant_id: merchantId,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['admin_merchant_commissions'] });
    },
  });

  const refresh = () => {
    void commissionsQ.refetch();
  };

  if (isAdminQ.isLoading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <AdminNav />
        <div className="max-w-5xl mx-auto p-6">
          <div className="bg-white rounded-xl shadow p-6">
            <div className="text-lg font-semibold">Checking permissions…</div>
          </div>
        </div>
      </div>
    );
  }

  if (isAdminQ.error) {
    return (
      <div className="min-h-screen bg-gray-50">
        <AdminNav />
        <div className="max-w-5xl mx-auto p-6">
          <div className="bg-white rounded-xl shadow p-6">
            <div className="text-lg font-semibold">Failed to load</div>
            <div className="text-sm text-red-700 mt-2">{errorText(isAdminQ.error)}</div>
          </div>
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-gray-50">
        <AdminNav />
        <div className="max-w-5xl mx-auto p-6">
          <div className="bg-white rounded-xl shadow p-6">
            <div className="text-lg font-semibold">Admin only</div>
            <div className="text-sm text-gray-600 mt-2">You don&apos;t have permission to view this page.</div>
          </div>
        </div>
      </div>
    );
  }

  const rows = (commissionsQ.data ?? []).filter((r) => {
    if (!filter.trim()) return true;
    const q = filter.trim().toLowerCase();
    return (r.business_name || '').toLowerCase().includes(q);
  });

  return (
    <div className="min-h-screen bg-gray-50">
      <AdminNav />
      <div className="max-w-5xl mx-auto p-6 space-y-6">
        <div className="bg-white rounded-xl shadow p-6">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <div className="text-xl font-semibold">Merchant commissions</div>
              <div className="text-sm text-gray-600 mt-2">
                Configure the platform take-rate for COD merchant settlements.
                Commission is applied to goods value, plus an optional COD handling fee deducted on COD remittance.
                Rates are in <span className="font-semibold">basis points</span> (100 bps = 1%). Flat fees are per order.
              </div>
            </div>
            <button className="btn" onClick={refresh} type="button">Refresh</button>
          </div>

          <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="md:col-span-2">
              <div className="text-xs text-gray-600">Filter by merchant</div>
              <input
                className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Search by business name"
              />
            </div>
            <div className="flex items-end">
              <div className="text-xs text-gray-500">Example: 800 bps = 8%</div>
            </div>
          </div>

          {commissionsQ.isLoading ? <div className="mt-4 text-sm text-gray-500">Loading…</div> : null}
          {commissionsQ.error ? <div className="mt-4 text-sm text-red-700">{errorText(commissionsQ.error)}</div> : null}

          {rows.length === 0 && !commissionsQ.isLoading ? (
            <div className="mt-4 text-sm text-gray-500">No rows.</div>
          ) : null}

          {rows.length > 0 ? (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-500">
                    <th className="py-2">Merchant</th>
                    <th className="py-2">Effective</th>
                    <th className="py-2">Specific override</th>
                    <th className="py-2">Updated</th>
                    <th className="py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const key = r.is_default ? 'DEFAULT' : String(r.merchant_id);
                    const d =
                      draft[key] ?? {
                        rateBps: String(asNumber(r.effective_rate_bps)),
                        flatFee: String(asNumber(r.effective_flat_fee_iqd)),
                        codRateBps: String(asNumber(r.effective_cod_handling_rate_bps)),
                        codFlatFee: String(asNumber(r.effective_cod_handling_flat_fee_iqd)),
                      };

                    const effRate = asNumber(r.effective_rate_bps);
                    const effFlat = asNumber(r.effective_flat_fee_iqd);

                    const specRate = r.specific_rate_bps == null ? null : asNumber(r.specific_rate_bps);
                    const specFlat = r.specific_flat_fee_iqd == null ? null : asNumber(r.specific_flat_fee_iqd);
                    const specCodRate = r.specific_cod_handling_rate_bps == null ? null : asNumber(r.specific_cod_handling_rate_bps);
                    const specCodFlat = r.specific_cod_handling_flat_fee_iqd == null ? null : asNumber(r.specific_cod_handling_flat_fee_iqd);

                    const busy = setMut.isPending || clearMut.isPending;

                    return (
                      <tr key={key} className="border-t">
                        <td className="py-2 whitespace-nowrap">
                          <div className="font-semibold">{r.business_name}</div>
                          {r.is_default ? <div className="text-xs text-gray-500">Default applied to merchants without override</div> : null}
                        </td>
                        <td className="py-2 whitespace-nowrap">
                          <div className="font-semibold">Commission</div>
                          <div>{effRate} bps</div>
                          <div className="text-xs text-gray-500">+ {formatIQD(effFlat)} per order</div>
                          <div className="mt-2 font-semibold">COD handling</div>
                          <div>{asNumber(r.effective_cod_handling_rate_bps)} bps</div>
                          <div className="text-xs text-gray-500">+ {formatIQD(asNumber(r.effective_cod_handling_flat_fee_iqd))} per COD order</div>
                        </td>
                        <td className="py-2">
                          <div className="flex flex-col gap-2">
                            <div className="flex gap-2 flex-wrap">
                              <input
                                className="w-28 rounded-xl border border-gray-200 px-3 py-2 text-sm"
                                value={d.rateBps}
                                onChange={(e) => setDraftFor(key, e.target.value, d.flatFee, d.codRateBps, d.codFlatFee)}
                                placeholder="commission bps"
                              />
                              <input
                                className="w-36 rounded-xl border border-gray-200 px-3 py-2 text-sm"
                                value={d.flatFee}
                                onChange={(e) => setDraftFor(key, d.rateBps, e.target.value, d.codRateBps, d.codFlatFee)}
                                placeholder="commission flat IQD"
                              />
                              <input
                                className="w-28 rounded-xl border border-gray-200 px-3 py-2 text-sm"
                                value={d.codRateBps}
                                onChange={(e) => setDraftFor(key, d.rateBps, d.flatFee, e.target.value, d.codFlatFee)}
                                placeholder="COD bps"
                              />
                              <input
                                className="w-36 rounded-xl border border-gray-200 px-3 py-2 text-sm"
                                value={d.codFlatFee}
                                onChange={(e) => setDraftFor(key, d.rateBps, d.flatFee, d.codRateBps, e.target.value)}
                                placeholder="COD flat IQD"
                              />
                            </div>
                            <div className="text-xs text-gray-500">
                              {specRate == null && specFlat == null && specCodRate == null && specCodFlat == null
                                ? 'No override set.'
                                : `Override: commission ${specRate ?? '—'} bps +${formatIQD(specFlat ?? 0)}, COD ${specCodRate ?? '—'} bps +${formatIQD(specCodFlat ?? 0)}`}
                            </div>
                          </div>
                        </td>
                        <td className="py-2 whitespace-nowrap">{fmtTime(r.updated_at)}</td>
                        <td className="py-2">
                          <div className="flex gap-2 flex-wrap">
                            <button
                              className="btn btn-primary"
                              type="button"
                              disabled={busy}
                              onClick={() => {
                                const rate = Math.trunc(Number.parseInt(d.rateBps, 10) || 0);
                                const flat = parseIQDInput(d.flatFee);
                                const codRate = Math.trunc(Number.parseInt(d.codRateBps, 10) || 0);
                                const codFlat = parseIQDInput(d.codFlatFee);
                                setMut.mutate({
                                  merchantId: r.is_default ? null : (r.merchant_id as string),
                                  rateBps: rate,
                                  flatFee: flat,
                                  codRateBps: codRate,
                                  codFlatFee: codFlat,
                                });
                              }}
                            >
                              {setMut.isPending ? 'Saving…' : 'Save'}
                            </button>
                            {!r.is_default ? (
                              <button
                                className="btn"
                                type="button"
                                disabled={busy}
                                onClick={() => clearMut.mutate(r.merchant_id as string)}
                              >
                                {clearMut.isPending ? 'Clearing…' : 'Clear override'}
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}

          {(setMut.error || clearMut.error) ? (
            <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {errorText((setMut.error || clearMut.error) as any)}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
