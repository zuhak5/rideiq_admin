'use client';

import React from 'react';
import { LeafletPolygonEditor } from '@/components/maps/LeafletPolygonEditor';
import type { ServiceAreaRow } from '@/lib/admin/serviceAreas';
import type { PricingConfigRow } from '@/lib/admin/pricing';
import { upsertServiceAreaAction, deleteServiceAreaAction } from './actions';

function centroidOfGeometry(geom: any): { lat: number; lng: number } | null {
  try {
    const coords: number[][] = [];
    const push = (c: any) => {
      if (!Array.isArray(c)) return;
      if (typeof c[0] === 'number' && typeof c[1] === 'number') {
        coords.push([c[1], c[0]]); // GeoJSON: [lng, lat]
        return;
      }
      for (const x of c) push(x);
    };
    push(geom?.coordinates);
    if (coords.length === 0) return null;
    let sumLat = 0;
    let sumLng = 0;
    for (const [lat, lng] of coords) {
      sumLat += lat;
      sumLng += lng;
    }
    return { lat: sumLat / coords.length, lng: sumLng / coords.length };
  } catch {
    return null;
  }
}

function formatNumber(v: number | null | undefined): string {
  if (v === null || v === undefined) return '';
  if (!Number.isFinite(v)) return '';
  return String(v);
}

function boolToChecked(v: boolean | null | undefined): boolean {
  return Boolean(v);
}

export default function ServiceAreasClient(props: {
  query: { q: string; offset: number };
  initialAreas: ServiceAreaRow[];
  page: { limit: number; offset: number; returned: number };
  pricingConfigs: PricingConfigRow[];
}): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<ServiceAreaRow | null>(null);

  const [name, setName] = React.useState('');
  const [governorate, setGovernorate] = React.useState('Baghdad');
  const [priority, setPriority] = React.useState('0');
  const [isActive, setIsActive] = React.useState(true);
  const [pricingConfigId, setPricingConfigId] = React.useState('');
  const [minBaseFare, setMinBaseFare] = React.useState('');
  const [surgeMultiplier, setSurgeMultiplier] = React.useState('');
  const [surgeReason, setSurgeReason] = React.useState('');
  const [matchRadiusM, setMatchRadiusM] = React.useState('');
  const [staleAfterS, setStaleAfterS] = React.useState('');
  const [cashRounding, setCashRounding] = React.useState('');
  const [geometry, setGeometry] = React.useState<any | null>(null);

  const defaultCenter = React.useMemo(() => ({ lat: 33.3152, lng: 44.3661 }), []);
  const center = React.useMemo(() => centroidOfGeometry(geometry) ?? defaultCenter, [geometry, defaultCenter]);

  const openNew = () => {
    setEditing(null);
    setName('');
    setGovernorate('Baghdad');
    setPriority('0');
    setIsActive(true);
    setPricingConfigId('');
    setMinBaseFare('');
    setSurgeMultiplier('');
    setSurgeReason('');
    setMatchRadiusM('');
    setStaleAfterS('');
    setCashRounding('');
    setGeometry(null);
    setOpen(true);
  };

  const openEdit = (a: ServiceAreaRow) => {
    setEditing(a);
    setName(a.name ?? '');
    setGovernorate(a.governorate ?? '');
    setPriority(String(a.priority ?? 0));
    setIsActive(boolToChecked(a.is_active));
    setPricingConfigId(a.pricing_config_id ?? '');
    setMinBaseFare(formatNumber(a.min_base_fare_iqd));
    setSurgeMultiplier(formatNumber(a.surge_multiplier));
    setSurgeReason(a.surge_reason ?? '');
    setMatchRadiusM(formatNumber(a.match_radius_m));
    setStaleAfterS(formatNumber(a.driver_loc_stale_after_seconds));
    setCashRounding(formatNumber(a.cash_rounding_step_iqd));
    setGeometry(a.geom_geojson ?? null);
    setOpen(true);
  };

  const geojsonStr = React.useMemo(() => (geometry ? JSON.stringify(geometry) : ''), [geometry]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs text-neutral-500">
          Define active operating regions using polygons (GeoJSON). Higher priority wins.
        </div>
        <button
          onClick={openNew}
          className="rounded-md bg-neutral-900 text-white px-3 py-2 text-sm hover:bg-neutral-800"
          type="button"
        >
          New service area
        </button>
      </div>

      <div className="rounded-xl border bg-white overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 border-b">
            <tr>
              <th className="text-left px-4 py-2 font-medium">Name</th>
              <th className="text-left px-4 py-2 font-medium">Governorate</th>
              <th className="text-left px-4 py-2 font-medium">Active</th>
              <th className="text-left px-4 py-2 font-medium">Priority</th>
              <th className="text-left px-4 py-2 font-medium">Surge</th>
              <th className="text-left px-4 py-2 font-medium">Pricing</th>
              <th className="text-right px-4 py-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {props.initialAreas.map((a) => (
              <tr key={a.id} className="border-b last:border-b-0">
                <td className="px-4 py-2">
                  <div className="font-medium">{a.name}</div>
                  <div className="text-xs text-neutral-500">{a.id.slice(0, 8)}…</div>
                </td>
                <td className="px-4 py-2">{a.governorate ?? '—'}</td>
                <td className="px-4 py-2">
                  {a.is_active ? <span className="text-emerald-700">active</span> : <span className="text-neutral-500">inactive</span>}
                </td>
                <td className="px-4 py-2">{a.priority}</td>
                <td className="px-4 py-2">
                  <div>{a.surge_multiplier ?? 1}</div>
                  {a.surge_reason ? <div className="text-xs text-neutral-500">{a.surge_reason}</div> : null}
                </td>
                <td className="px-4 py-2">
                  {a.pricing_config_id ? <span className="text-xs">{a.pricing_config_id.slice(0, 8)}…</span> : '—'}
                </td>
                <td className="px-4 py-2 text-right">
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      className="rounded-md border bg-white px-2 py-1 hover:bg-neutral-50"
                      onClick={() => openEdit(a)}
                    >
                      Edit
                    </button>
                    <form action={deleteServiceAreaAction}>
                      <input type="hidden" name="id" value={a.id} />
                      <button
                        type="submit"
                        className="rounded-md border border-red-200 bg-white px-2 py-1 text-red-700 hover:bg-red-50"
                        onClick={(e) => {
                          if (!confirm(`Delete service area “${a.name}”?`)) e.preventDefault();
                        }}
                      >
                        Delete
                      </button>
                    </form>
                  </div>
                </td>
              </tr>
            ))}
            {props.initialAreas.length === 0 && (
              <tr>
                <td className="px-4 py-6 text-sm text-neutral-500" colSpan={7}>
                  No service areas.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 overflow-auto">
          <div className="w-full max-w-5xl rounded-2xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b px-6 py-4">
              <div>
                <div className="text-sm font-semibold">{editing ? 'Edit service area' : 'New service area'}</div>
                <div className="text-xs text-neutral-500">Draw a polygon. Only one polygon/multipolygon is saved.</div>
              </div>
              <button
                type="button"
                className="rounded-md border bg-white px-3 py-2 text-sm hover:bg-neutral-50"
                onClick={() => setOpen(false)}
              >
                Close
              </button>
            </div>

            <form action={upsertServiceAreaAction} className="p-6 space-y-4">
              {editing ? <input type="hidden" name="id" value={editing.id} /> : null}
              <input type="hidden" name="geojson" value={geojsonStr} />

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <label className="text-sm">
                  Name
                  <input
                    className="mt-1 w-full rounded-md border px-3 py-2"
                    name="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Baghdad Core"
                    required
                  />
                </label>

                <label className="text-sm">
                  Governorate
                  <input
                    className="mt-1 w-full rounded-md border px-3 py-2"
                    name="governorate"
                    value={governorate}
                    onChange={(e) => setGovernorate(e.target.value)}
                    placeholder="Baghdad"
                    required
                  />
                </label>

                <label className="text-sm">
                  Priority
                  <input
                    className="mt-1 w-full rounded-md border px-3 py-2"
                    name="priority"
                    value={priority}
                    onChange={(e) => setPriority(e.target.value)}
                    type="number"
                  />
                </label>

                <label className="text-sm flex items-center gap-2">
                  <input name="is_active" type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
                  Active
                </label>

                <label className="text-sm md:col-span-2">
                  Pricing config
                  <select
                    className="mt-1 w-full rounded-md border px-3 py-2"
                    name="pricing_config_id"
                    value={pricingConfigId}
                    onChange={(e) => setPricingConfigId(e.target.value)}
                  >
                    <option value="">(none)</option>
                    {props.pricingConfigs.map((p) => (
                      <option key={p.id} value={p.id}>
                        {(p.name ? p.name : p.id)} (v{p.version}){p.is_default ? ' — default' : ''}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="text-sm">
                  Min base fare (IQD)
                  <input
                    className="mt-1 w-full rounded-md border px-3 py-2"
                    name="min_base_fare_iqd"
                    value={minBaseFare}
                    onChange={(e) => setMinBaseFare(e.target.value)}
                    type="number"
                    min={0}
                  />
                </label>

                <label className="text-sm">
                  Surge multiplier
                  <input
                    className="mt-1 w-full rounded-md border px-3 py-2"
                    name="surge_multiplier"
                    value={surgeMultiplier}
                    onChange={(e) => setSurgeMultiplier(e.target.value)}
                    type="number"
                    step="0.01"
                    min={1}
                  />
                </label>

                <label className="text-sm md:col-span-3">
                  Surge reason
                  <input
                    className="mt-1 w-full rounded-md border px-3 py-2"
                    name="surge_reason"
                    value={surgeReason}
                    onChange={(e) => setSurgeReason(e.target.value)}
                    placeholder="Peak hours"
                  />
                </label>

                <label className="text-sm">
                  Match radius (m)
                  <input
                    className="mt-1 w-full rounded-md border px-3 py-2"
                    name="match_radius_m"
                    value={matchRadiusM}
                    onChange={(e) => setMatchRadiusM(e.target.value)}
                    type="number"
                    min={10}
                  />
                </label>

                <label className="text-sm">
                  Driver location stale after (s)
                  <input
                    className="mt-1 w-full rounded-md border px-3 py-2"
                    name="driver_loc_stale_after_seconds"
                    value={staleAfterS}
                    onChange={(e) => setStaleAfterS(e.target.value)}
                    type="number"
                    min={10}
                  />
                </label>

                <label className="text-sm">
                  Cash rounding step (IQD)
                  <input
                    className="mt-1 w-full rounded-md border px-3 py-2"
                    name="cash_rounding_step_iqd"
                    value={cashRounding}
                    onChange={(e) => setCashRounding(e.target.value)}
                    type="number"
                    min={1}
                  />
                </label>
              </div>

              <div>
                <div className="text-sm font-medium">Polygon editor</div>
                <div className="mt-1 text-xs text-neutral-500">
                  Use the draw tool to create a polygon. Creating a new polygon replaces the old one.
                </div>
                <div className="mt-2 rounded-xl overflow-hidden border">
                  <LeafletPolygonEditor
                    center={center}
                    zoom={12}
                    initialGeometry={geometry}
                    onGeometryChange={(g) => setGeometry(g)}
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 border-t pt-4">
                <button
                  type="button"
                  className="rounded-md border bg-white px-3 py-2 text-sm hover:bg-neutral-50"
                  onClick={() => setOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!geojsonStr}
                  className="rounded-md bg-neutral-900 text-white px-4 py-2 text-sm hover:bg-neutral-800 disabled:opacity-50"
                  onClick={(e) => {
                    if (!geojsonStr) {
                      e.preventDefault();
                      alert('Draw a polygon first.');
                    }
                  }}
                >
                  Save
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
