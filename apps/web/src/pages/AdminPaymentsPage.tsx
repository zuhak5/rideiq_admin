import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabaseClient';
import { getIsAdmin } from '../lib/admin';
import { errorText } from '../lib/errors';
import AdminNav from '../components/AdminNav';
import { formatIQD } from '../lib/money';

type PaymentsConfigResponse = {
  ok: boolean;
  providers: Array<{
    code: string;
    name: string;
    kind: string;
    presets: Array<{
      id: string;
      label: string;
      amount_iqd: number;
      bonus_iqd: number;
    }>;
  }>;
};

async function fetchPaymentsConfig(): Promise<PaymentsConfigResponse> {
  const { data, error } = await supabase.functions.invoke('payments-config');
  if (error) throw error;

  const out: unknown = data;
  if (!out || typeof out !== 'object') throw new Error('Failed to load payments config');

  const o = out as { ok?: unknown; providers?: unknown };
  if (o.ok !== true || !Array.isArray(o.providers)) throw new Error('Failed to load payments config');

  return o as PaymentsConfigResponse;
}

const SAMPLE_PAYMENTS_PUBLIC_CONFIG_JSON = JSON.stringify(
  {
    providers: [
      {
        code: 'zaincash',
        name: 'ZainCash',
        kind: 'zaincash_v2',
        enabled: true,
        sort_order: 10,
        presets: [
          { id: 'zc_5k', label: '5,000 IQD', amount_iqd: 5000, bonus_iqd: 0, active: true, sort_order: 10 },
          { id: 'zc_10k', label: '10,000 IQD', amount_iqd: 10000, bonus_iqd: 0, active: true, sort_order: 20 },
        ],
      },
      {
        code: 'qicard',
        name: 'QiCard',
        kind: 'qicard',
        enabled: true,
        sort_order: 20,
        presets: [
          { id: 'qi_5k', label: '5,000 IQD', amount_iqd: 5000, bonus_iqd: 0, active: true, sort_order: 10 },
          { id: 'qi_10k', label: '10,000 IQD', amount_iqd: 10000, bonus_iqd: 0, active: true, sort_order: 20 },
        ],
      },
      {
        code: 'asiapay',
        name: 'AsiaPay',
        kind: 'asiapay',
        enabled: true,
        sort_order: 30,
        presets: [
          { id: 'ap_5k', label: '5,000 IQD', amount_iqd: 5000, bonus_iqd: 0, active: true, sort_order: 10 },
          { id: 'ap_10k', label: '10,000 IQD', amount_iqd: 10000, bonus_iqd: 0, active: true, sort_order: 20 },
        ],
      },
    ],
  },
  null,
  0,
);

export default function AdminPaymentsPage() {
  const isAdminQ = useQuery<boolean, Error>({
    queryKey: ['admin_is_admin'],
    queryFn: () => getIsAdmin(),
    staleTime: 60_000,
  });

  const isAdmin = isAdminQ.data === true;

  const cfgQ = useQuery<PaymentsConfigResponse, Error>({
    queryKey: ['admin_payments_config'],
    queryFn: fetchPaymentsConfig,
    enabled: isAdmin,
    staleTime: 15_000,
  });

  if (isAdminQ.isLoading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <AdminNav />
        <div className="max-w-4xl mx-auto p-6">
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
        <div className="max-w-4xl mx-auto p-6">
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
        <div className="max-w-4xl mx-auto p-6">
          <div className="bg-white rounded-xl shadow p-6">
            <div className="text-lg font-semibold">Admin only</div>
            <div className="text-sm text-gray-600 mt-2">You don&apos;t have permission to view this page.</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <AdminNav />
      <div className="max-w-5xl mx-auto p-6 space-y-6">
        <div className="bg-white rounded-xl shadow p-6">
          <div className="text-xl font-semibold">Payments Configuration</div>
          <div className="text-sm text-gray-600 mt-2">
            Payments are configured via <span className="font-mono">PAYMENTS_PUBLIC_CONFIG_JSON</span> (an Edge Function Secret). No provider rows are seeded in the database.
          </div>

          <div className="mt-4">
            <div className="text-sm font-medium text-gray-900">Sample JSON</div>
            <textarea
              className="mt-2 w-full h-40 font-mono text-xs border rounded-lg p-3 bg-gray-50"
              value={SAMPLE_PAYMENTS_PUBLIC_CONFIG_JSON}
              readOnly
            />
            <div className="text-xs text-gray-500 mt-2">
              Tip: You can use <span className="font-mono">kind: &quot;zaincash_v2&quot;</span> in the JSON; the backend normalizes it to ZainCash v2.
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow p-6">
          <div className="text-lg font-semibold">Current enabled providers</div>

          {cfgQ.isLoading ? <div className="text-sm text-gray-500 mt-3">Loading…</div> : null}
          {cfgQ.error ? <div className="text-sm text-red-700 mt-3">{errorText(cfgQ.error)}</div> : null}

          {cfgQ.data ? (
            <div className="mt-4 space-y-4">
              {cfgQ.data.providers.map((p: PaymentsConfigResponse['providers'][number]) => (
                <div key={p.code} className="border rounded-xl p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-semibold">{p.name}</div>
                      <div className="text-xs text-gray-500">
                        code: <span className="font-mono">{p.code}</span> • kind: <span className="font-mono">{p.kind}</span>
                      </div>
                    </div>
                  </div>

                  <div className="mt-3">
                    <div className="text-sm font-medium">Top-up presets</div>
                    {p.presets.length === 0 ? (
                      <div className="text-sm text-gray-500 mt-1">No active presets.</div>
                    ) : (
                      <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2">
                        {p.presets.map((x: PaymentsConfigResponse['providers'][number]['presets'][number]) => (
                          <div key={x.id} className="border rounded-lg p-3">
                            <div className="text-sm font-semibold">{x.label}</div>
                            <div className="text-xs text-gray-500 mt-1">
                              {formatIQD(x.amount_iqd)} + bonus {formatIQD(x.bonus_iqd)} • preset id: <span className="font-mono">{x.id}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
