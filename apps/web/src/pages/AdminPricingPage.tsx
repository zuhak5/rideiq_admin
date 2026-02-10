import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import AdminNav from '../components/AdminNav';
import { supabase } from '../lib/supabaseClient';
import { getIsAdmin } from '../lib/admin';
import { errorText } from '../lib/errors';

type PricingConfigRow = {
  id: string;
  name: string | null;
  version: number;
  is_default: boolean;
  effective_from: string;
  effective_to: string | null;
  base_fare_iqd: number;
  per_km_iqd: number;
  per_min_iqd: number;
  minimum_fare_iqd: number;
  max_surge_multiplier: number;
  active: boolean;
  updated_at: string;
};

async function fetchPricingConfigs(): Promise<PricingConfigRow[]> {
  const { data, error } = await supabase
    .from('pricing_configs')
    .select(
      'id,name,version,is_default,effective_from,effective_to,base_fare_iqd,per_km_iqd,per_min_iqd,minimum_fare_iqd,max_surge_multiplier,active,updated_at',
    )
    .order('active', { ascending: false })
    .order('is_default', { ascending: false })
    .order('effective_from', { ascending: false })
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return (data as PricingConfigRow[]) ?? [];
}

export default function AdminPricingPage() {
  const qc = useQueryClient();
  const [isAdmin, setIsAdmin] = React.useState<boolean | null>(null);
  const [toast, setToast] = React.useState<string | null>(null);

  const [cloneFromId, setCloneFromId] = React.useState<string>('');
  const [cloneName, setCloneName] = React.useState<string>('');
  const [cloneEffectiveFrom, setCloneEffectiveFrom] = React.useState<string>(() => {
    const d = new Date();
    // Local input type="datetime-local" wants YYYY-MM-DDTHH:mm
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  });
  const [cloneSetDefault, setCloneSetDefault] = React.useState<boolean>(false);
  const [cloneBusy, setCloneBusy] = React.useState<boolean>(false);

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

  const pricing = useQuery({ queryKey: ['admin_pricing_configs_caps'], queryFn: fetchPricingConfigs, enabled: isAdmin === true });

  if (isAdmin === false) {
    return <div className="rounded-2xl border border-gray-200 bg-white p-6">Not authorized.</div>;
  }

  return (
    <div className="space-y-4">
      <AdminNav />
      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="text-sm font-semibold">Pricing</div>
        <div className="text-xs text-gray-500 mt-1">
          Configure surge caps per pricing config. Surge multipliers are capped by <code>max_surge_multiplier</code> and do not affect product multipliers.
        </div>

        {toast ? <div className="mt-3 rounded-xl border p-3 text-sm bg-white">{toast}</div> : null}

        {pricing.isLoading ? <div className="mt-3 text-sm text-gray-600">Loading…</div> : null}
        {pricing.error ? <div className="mt-3 text-sm text-red-700">{errorText(pricing.error)}</div> : null}

        <div className="mt-4 space-y-2">
          {(pricing.data ?? []).map((p) => (
            <div key={p.id} className="rounded-xl border p-3">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="text-sm">
                  <div className="font-medium">
                    {p.name ? `${p.name} ` : ''}
                    <span className="text-gray-500">(v{p.version})</span>
                    {p.is_default ? <span className="ml-2 text-indigo-700">(default)</span> : null}
                    {p.active ? <span className="ml-2 text-emerald-700">(active)</span> : <span className="ml-2 text-gray-500">(inactive)</span>}
                  </div>
                  <div className="text-xs text-gray-600">
                    id={p.id} • base={p.base_fare_iqd} • km={p.per_km_iqd} • min={p.per_min_iqd} • minfare={p.minimum_fare_iqd}
                    <div className="mt-1">
                      effective: {new Date(p.effective_from).toLocaleString()} {p.effective_to ? `→ ${new Date(p.effective_to).toLocaleString()}` : ''}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    className="btn"
                    disabled={p.is_default}
                    onClick={async () => {
                      setToast(null);
                      const { error } = await supabase.rpc('admin_set_default_pricing_config_v1', { p_id: p.id });
                      if (error) {
                        setToast(`Error: ${errorText(error)}`);
                        return;
                      }
                      setToast('Default updated.');
                      qc.invalidateQueries({ queryKey: ['admin_pricing_configs_caps'] });
                    }}
                  >
                    Set default
                  </button>
                </div>

                <label className="text-xs text-gray-600">
                  Max surge multiplier
                  <input
                    className="mt-1 w-40 rounded-md border px-2 py-1 text-sm"
                    type="number"
                    step="0.01"
                    min="1"
                    defaultValue={String(p.max_surge_multiplier ?? 1)}
                    onBlur={async (e) => {
                      const v = Number(e.target.value);
                      if (!Number.isFinite(v) || v < 1) {
                        setToast('Max surge multiplier must be a number >= 1.0');
                        return;
                      }
                      setToast(null);
                      const { error } = await supabase.rpc('admin_update_pricing_config_caps', {
                        p_id: p.id,
                        p_max_surge_multiplier: v,
                      });
                      if (error) {
                        setToast(`Error: ${errorText(error)}`);
                        return;
                      }
                      setToast('Saved.');
                      qc.invalidateQueries({ queryKey: ['admin_pricing_configs_caps'] });
                    }}
                  />
                </label>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-6 rounded-xl border p-4">
          <div className="text-sm font-semibold">Create new pricing version (clone)</div>
          <div className="text-xs text-gray-500 mt-1">
            Creates a new <code>pricing_configs</code> row by cloning an existing config and incrementing its version. You can optionally set it as the default.
          </div>

          <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="text-sm">
              Clone from
              <select className="mt-1 w-full rounded-md border px-3 py-2" value={cloneFromId} onChange={(e) => setCloneFromId(e.target.value)}>
                <option value="">(select)</option>
                {(pricing.data ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {(p.name ? p.name : p.id)} (v{p.version}){p.is_default ? ' — default' : ''}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-sm">
              New name
              <input className="mt-1 w-full rounded-md border px-3 py-2" value={cloneName} onChange={(e) => setCloneName(e.target.value)} placeholder="Iraq default v2" />
            </label>

            <label className="text-sm">
              Effective from
              <input className="mt-1 w-full rounded-md border px-3 py-2" type="datetime-local" value={cloneEffectiveFrom} onChange={(e) => setCloneEffectiveFrom(e.target.value)} />
            </label>

            <label className="text-sm">
              Set as default
              <div className="mt-2">
                <input type="checkbox" checked={cloneSetDefault} onChange={(e) => setCloneSetDefault(e.target.checked)} />
              </div>
            </label>
          </div>

          <div className="mt-4 flex gap-2 flex-wrap">
            <button
              className="btn bg-black text-white disabled:opacity-50"
              disabled={cloneBusy || isAdmin !== true || !cloneFromId}
              onClick={async () => {
                setToast(null);
                if (!cloneFromId) {
                  setToast('Select a source config.');
                  return;
                }
                setCloneBusy(true);
                try {
                  // datetime-local has no timezone; treat as local and let browser convert.
                  const effective = new Date(cloneEffectiveFrom).toISOString();
                  const { data, error } = await supabase.rpc('admin_clone_pricing_config_v1', {
                    p_source_id: cloneFromId,
                    p_name: cloneName || null,
                    p_effective_from: effective,
                    p_active: true,
                    p_set_default: cloneSetDefault,
                  });
                  if (error) throw error;
                  setToast(`Created new pricing config: ${data}`);
                  qc.invalidateQueries({ queryKey: ['admin_pricing_configs_caps'] });
                } catch (e) {
                  setToast(`Error: ${errorText(e)}`);
                } finally {
                  setCloneBusy(false);
                }
              }}
            >
              Clone
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
