import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import AdminNav from '../components/AdminNav';
import { getIsAdmin } from '../lib/admin';
import { errorText } from '../lib/errors';
import { parseIQDInput } from '../lib/money';
import { supabase } from '../lib/supabaseClient';

type ServiceArea = {
  id: string;
  name: string;
  governorate: string | null;
  is_active: boolean;
};

type PlatformFeeRow = {
  id: string;
  product_code: string;
  service_area_id: string | null;
  service_area_name: string | null;
  rate_bps: number;
  flat_fee_iqd: number;
  active: boolean;
  updated_at: string;
};

function fmtTime(ts: string | null | undefined): string {
  if (!ts) return '—';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString();
}

async function fetchServiceAreas(): Promise<ServiceArea[]> {
  const { data, error } = await supabase
    .from('service_areas')
    .select('id,name,governorate,is_active')
    .order('priority', { ascending: false })
    .order('name', { ascending: true });
  if (error) throw error;
  return (Array.isArray(data) ? data : []) as ServiceArea[];
}

async function fetchPlatformFees(): Promise<PlatformFeeRow[]> {
  const { data, error } = await supabase.rpc('admin_platform_fee_list_v1', {
    p_only_active: false,
  });
  if (error) throw error;
  return (Array.isArray(data) ? data : []) as PlatformFeeRow[];
}

export default function AdminSettingsPage() {
  const qc = useQueryClient();

  const isAdminQ = useQuery<boolean, Error>({
    queryKey: ['admin_is_admin'],
    queryFn: () => getIsAdmin(),
    staleTime: 60_000,
  });
  const isAdmin = isAdminQ.data === true;

  const serviceAreasQ = useQuery<ServiceArea[], Error>({
    queryKey: ['admin_service_areas_for_settings'],
    queryFn: fetchServiceAreas,
    enabled: isAdmin,
    staleTime: 60_000,
  });

  const feesQ = useQuery<PlatformFeeRow[], Error>({
    queryKey: ['admin_platform_fees'],
    queryFn: fetchPlatformFees,
    enabled: isAdmin,
    staleTime: 10_000,
  });

  const [productCode, setProductCode] = React.useState('standard');
  const [serviceAreaId, setServiceAreaId] = React.useState<string>(''); // '' = global
  const [rateBps, setRateBps] = React.useState('1000');
  const [flatFee, setFlatFee] = React.useState('0');
  const [active, setActive] = React.useState(true);

  const setMut = useMutation({
    mutationFn: async () => {
      const pRate = Number(rateBps);
      if (!Number.isFinite(pRate) || pRate < 0 || pRate > 5000) {
        throw new Error('Rate (bps) must be between 0 and 5000');
      }
      const pFlat = parseIQDInput(flatFee);
      if (pFlat < 0) {
        throw new Error('Flat fee must be >= 0');
      }

      const { error } = await supabase.rpc('admin_platform_fee_set_v1', {
        p_product_code: productCode,
        p_service_area_id: serviceAreaId ? serviceAreaId : null,
        p_rate_bps: Math.trunc(pRate),
        p_flat_fee_iqd: pFlat,
        p_active: active,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['admin_platform_fees'] });
    },
  });

  const fillFromRow = (r: PlatformFeeRow) => {
    setProductCode(r.product_code || 'standard');
    setServiceAreaId(r.service_area_id ?? '');
    setRateBps(String(r.rate_bps ?? 0));
    setFlatFee(String(r.flat_fee_iqd ?? 0));
    setActive(r.active === true);
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

  const serviceAreas = (serviceAreasQ.data ?? []).filter((sa) => sa.is_active);
  const rows = (feesQ.data ?? []) as PlatformFeeRow[];
  const activeRows = rows.filter((r) => r.active);
  const inactiveRows = rows.filter((r) => !r.active);

  return (
    <div className="min-h-screen bg-gray-50">
      <AdminNav />
      <div className="max-w-5xl mx-auto p-6 space-y-6">
        <div className="bg-white rounded-xl shadow p-6">
          <div className="text-xl font-semibold">Settings</div>
          <div className="text-sm text-gray-600 mt-2">
            Manage platform-wide operational parameters. Changes here affect settlement accounting.
          </div>
        </div>

        <div className="bg-white rounded-xl shadow p-6">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <div className="text-lg font-semibold">Platform fees</div>
              <div className="text-sm text-gray-600 mt-2">
                These fees are deducted from rides as the platform take-rate. Rates are in basis points (100 bps = 1%).
                For cash rides, the driver owes this amount to the platform settlement account.
              </div>
            </div>
            <button className="btn" type="button" onClick={() => feesQ.refetch()}>
              Refresh
            </button>
          </div>

          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <div className="text-sm font-semibold">Create / update fee</div>
              <div className="mt-3 space-y-3">
                <div>
                  <div className="text-xs text-gray-600">Product code</div>
                  <input
                    className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
                    value={productCode}
                    onChange={(e) => setProductCode(e.target.value)}
                    placeholder="standard"
                  />
                </div>
                <div>
                  <div className="text-xs text-gray-600">Service area</div>
                  <select
                    className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
                    value={serviceAreaId}
                    onChange={(e) => setServiceAreaId(e.target.value)}
                  >
                    <option value="">Global default</option>
                    {serviceAreas.map((sa) => (
                      <option key={sa.id} value={sa.id}>
                        {sa.name}{sa.governorate ? ` — ${sa.governorate}` : ''}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-xs text-gray-600">Rate (bps)</div>
                    <input
                      className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
                      value={rateBps}
                      onChange={(e) => setRateBps(e.target.value)}
                      inputMode="numeric"
                      placeholder="1000"
                    />
                  </div>
                  <div>
                    <div className="text-xs text-gray-600">Flat fee (IQD)</div>
                    <input
                      className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
                      value={flatFee}
                      onChange={(e) => setFlatFee(e.target.value)}
                      inputMode="numeric"
                      placeholder="0"
                    />
                  </div>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
                  Active
                </label>

                {setMut.isError ? (
                  <div className="text-sm text-red-700">{errorText(setMut.error as any)}</div>
                ) : null}

                <button
                  className="btn"
                  type="button"
                  disabled={setMut.isPending}
                  onClick={() => setMut.mutate()}
                >
                  {setMut.isPending ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>

            <div>
              <div className="text-sm font-semibold">Active fee rules</div>
              <div className="mt-3 overflow-auto border border-gray-100 rounded-xl">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 text-left">
                      <th className="px-3 py-2">Product</th>
                      <th className="px-3 py-2">Area</th>
                      <th className="px-3 py-2">Rate</th>
                      <th className="px-3 py-2">Flat</th>
                      <th className="px-3 py-2">Updated</th>
                      <th className="px-3 py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeRows.length === 0 ? (
                      <tr>
                        <td className="px-3 py-3 text-gray-500" colSpan={6}>
                          No active rules.
                        </td>
                      </tr>
                    ) : (
                      activeRows.map((r) => (
                        <tr key={r.id} className="border-t border-gray-100">
                          <td className="px-3 py-2 font-medium">{r.product_code}</td>
                          <td className="px-3 py-2">{r.service_area_name ?? (r.service_area_id ? r.service_area_id : 'Global')}</td>
                          <td className="px-3 py-2">{r.rate_bps} bps</td>
                          <td className="px-3 py-2">{r.flat_fee_iqd.toLocaleString()} IQD</td>
                          <td className="px-3 py-2">{fmtTime(r.updated_at)}</td>
                          <td className="px-3 py-2">
                            <button className="btn" type="button" onClick={() => fillFromRow(r)}>
                              Edit
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              <details className="mt-3">
                <summary className="cursor-pointer text-sm text-gray-700">Show inactive history ({inactiveRows.length})</summary>
                <div className="mt-2 overflow-auto border border-gray-100 rounded-xl">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 text-left">
                        <th className="px-3 py-2">Product</th>
                        <th className="px-3 py-2">Area</th>
                        <th className="px-3 py-2">Rate</th>
                        <th className="px-3 py-2">Flat</th>
                        <th className="px-3 py-2">Updated</th>
                      </tr>
                    </thead>
                    <tbody>
                      {inactiveRows.map((r) => (
                        <tr key={r.id} className="border-t border-gray-100">
                          <td className="px-3 py-2">{r.product_code}</td>
                          <td className="px-3 py-2">{r.service_area_name ?? (r.service_area_id ? r.service_area_id : 'Global')}</td>
                          <td className="px-3 py-2">{r.rate_bps} bps</td>
                          <td className="px-3 py-2">{r.flat_fee_iqd.toLocaleString()} IQD</td>
                          <td className="px-3 py-2">{fmtTime(r.updated_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
