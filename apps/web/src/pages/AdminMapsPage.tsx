import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import AdminNav from '../components/AdminNav';
import { MapView, type MapMarker, type LatLng } from '../components/maps/MapView';
import { getIsAdmin } from '../lib/admin';
import { invokeEdge } from '../lib/edgeInvoke';
import { errorText } from '../lib/errors';
import { supabase } from '../lib/supabaseClient';

type ProviderCode = 'google' | 'mapbox' | 'here';

type ProviderRow = {
  provider_code: ProviderCode;
  priority: number;
  enabled: boolean;
  language: string;
  region: string;
  monthly_soft_cap_units: number | null;
  monthly_hard_cap_units: number | null;
  cache_enabled: boolean;
  cache_ttl_seconds: number | null;
  note: string | null;
  mtd_render: number;
  mtd_directions: number;
  mtd_geocode: number;
  mtd_distance_matrix: number;
  updated_at: string;
};

type Capability = 'render' | 'directions' | 'geocode' | 'distance_matrix';

type CapabilityRow = {
  provider_code: ProviderCode;
  capability: Capability;
  enabled: boolean;
  unit_label: string | null;
  note: string | null;
};

type ActiveProviderResp = {
  ok: boolean;
  capability: 'render';
  provider: ProviderCode;
  config: { language: string; region: string };
  fallback_order?: ProviderCode[];
};

type MapsRequestLogRow = {
  created_at: string;
  request_id: string;
  actor_user_id: string;
  client_renderer: string | null;
  action: string;
  capability: Capability;
  provider_code: ProviderCode;
  http_status: number;
  latency_ms: number;
  billed_units: number;
  error_code: string | null;
  error_detail: string | null;
  tried_providers: ProviderCode[] | null;
  cache_hit: boolean;
  attempt_number: number;
  fallback_reason: string | null;
  request_summary: any;
  response_summary: any;
};

type ProviderHealthRow = {
  provider_code: ProviderCode;
  capability: Capability;
  consecutive_failures: number;
  disabled_until: string | null;
  last_http_status: number | null;
  last_error_code: string | null;
  last_failure_at: string | null;
  updated_at: string;
};

type RequestStatsRow = {
  provider_code: ProviderCode;
  capability: Capability;
  requests_1h: number;
  requests_24h: number;
  billed_units_1h: number;
  billed_units_24h: number;
  cache_hits_1h: number;
  cache_hits_24h: number;
  errors_1h: number;
  errors_24h: number;
  rate_limited_1h: number;
  rate_limited_24h: number;
};

type LiveDriverRow = {
  driver_id: string;
  lat: number;
  lng: number;
  heading_deg?: number | null;
  distance_m?: number | null;
  age_s?: number | null;
};

async function fetchProviders(): Promise<ProviderRow[]> {
  const { data, error } = await supabase.rpc('admin_maps_provider_list_v2');
  if (error) throw error;
  return (Array.isArray(data) ? data : []) as ProviderRow[];
}

async function fetchCapabilities(): Promise<CapabilityRow[]> {
  const { data, error } = await supabase.rpc('admin_maps_provider_capability_list_v1');
  if (error) throw error;
  return (Array.isArray(data) ? data : []) as CapabilityRow[];
}

async function fetchActiveProvider(): Promise<ActiveProviderResp> {
  const { data } = await invokeEdge<ActiveProviderResp>('maps-config-v2', {
    capability: 'render',
    supported: ['google', 'mapbox', 'here'],
  });
  if (!data?.ok) throw new Error('maps-config-v2 returned not ok');
  return data;
}

async function fetchMapsRequestLog(params: {
  limit: number;
  provider?: ProviderCode | 'all';
  capability?: string | 'all';
}): Promise<MapsRequestLogRow[]> {
  const { data, error } = await supabase.rpc('admin_maps_requests_list_v2', {
    p_limit: params.limit,
    p_provider_code: params.provider && params.provider !== 'all' ? params.provider : null,
    p_capability: params.capability && params.capability !== 'all' ? params.capability : null,
  });
  if (error) throw error;
  return (Array.isArray(data) ? data : []) as MapsRequestLogRow[];
}

async function fetchProviderHealth(): Promise<ProviderHealthRow[]> {
  const { data, error } = await supabase.rpc('admin_maps_provider_health_list_v1');
  if (error) throw error;
  return (Array.isArray(data) ? data : []) as ProviderHealthRow[];
}

async function fetchRequestStats(): Promise<RequestStatsRow[]> {
  const { data, error } = await supabase.rpc('admin_maps_requests_stats_v1');
  if (error) throw error;
  return (Array.isArray(data) ? data : []) as RequestStatsRow[];
}

function numOrNull(v: string): number | null {
  const t = v.trim();
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

function percent(n: number, d: number | null | undefined): string {
  if (!d || d <= 0) return '—';
  const p = Math.max(0, Math.min(100, (n / d) * 100));
  return `${p.toFixed(1)}%`;
}

export default function AdminMapsPage() {
  const qc = useQueryClient();

  const isAdminQ = useQuery<boolean, Error>({
    queryKey: ['admin_is_admin'],
    queryFn: () => getIsAdmin(),
    staleTime: 60_000,
  });
  const isAdmin = isAdminQ.data === true;
  const [nowMs, setNowMs] = React.useState(0);

  React.useEffect(() => {
    const tick = () => setNowMs(Date.now());
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const providersQ = useQuery<ProviderRow[], Error>({
    queryKey: ['admin_maps_providers'],
    queryFn: fetchProviders,
    enabled: isAdmin,
    staleTime: 10_000,
  });

  const capsQ = useQuery<CapabilityRow[], Error>({
    queryKey: ['admin_maps_capabilities'],
    queryFn: fetchCapabilities,
    enabled: isAdmin,
    staleTime: 10_000,
  });

  const activeQ = useQuery<ActiveProviderResp, Error>({
    queryKey: ['admin_maps_active_provider'],
    queryFn: fetchActiveProvider,
    enabled: isAdmin,
    staleTime: 10_000,
  });

  const [logProvider, setLogProvider] = React.useState<ProviderCode | 'all'>('all');
  const [logCapability, setLogCapability] = React.useState<string | 'all'>('all');

  const logsQ = useQuery<MapsRequestLogRow[], Error>({
    queryKey: ['admin_maps_requests_log', logProvider, logCapability],
    queryFn: () => fetchMapsRequestLog({ limit: 100, provider: logProvider, capability: logCapability }),
    enabled: isAdmin,
    staleTime: 1000,
    refetchInterval: 4000,
  });

  const healthQ = useQuery<ProviderHealthRow[], Error>({
    queryKey: ['admin_maps_provider_health'],
    queryFn: fetchProviderHealth,
    enabled: isAdmin,
    staleTime: 1000,
    refetchInterval: 4000,
  });

  const statsQ = useQuery<RequestStatsRow[], Error>({
    queryKey: ['admin_maps_requests_stats'],
    queryFn: fetchRequestStats,
    enabled: isAdmin,
    staleTime: 1000,
    refetchInterval: 4000,
  });

  const resetHealthMut = useMutation({
    mutationFn: async (row: ProviderHealthRow) => {
      const { error } = await supabase.rpc('admin_maps_provider_health_reset_v1', {
        p_provider_code: row.provider_code,
        p_capability: row.capability,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['admin_maps_provider_health'] });
      await qc.invalidateQueries({ queryKey: ['admin_maps_active_provider'] });
    },
  });

  const [geoDebug, setGeoDebug] = React.useState({
    originLat: '33.3152',
    originLng: '44.3661',
    destLat: '33.3128',
    destLng: '44.3615',
    renderer: 'google' as ProviderCode,
  });

  const [live, setLive] = React.useState({
    centerLat: '33.3152',
    centerLng: '44.3661',
    radiusM: '20000',
  });

  const liveCenter: LatLng = React.useMemo(() => {
    const lat = Number(live.centerLat);
    const lng = Number(live.centerLng);
    return {
      lat: Number.isFinite(lat) ? lat : 33.3152,
      lng: Number.isFinite(lng) ? lng : 44.3661,
    };
  }, [live.centerLat, live.centerLng]);

  const liveRadiusM = React.useMemo(() => {
    const r = Number(live.radiusM);
    return Number.isFinite(r) && r > 0 ? r : 20000;
  }, [live.radiusM]);

  const liveDriversQ = useQuery<LiveDriverRow[], Error>({
    queryKey: ['admin_live_drivers', liveCenter.lat, liveCenter.lng, liveRadiusM],
    enabled: isAdmin,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('drivers_nearby_user_v1', {
        p_pickup_lat: liveCenter.lat,
        p_pickup_lng: liveCenter.lng,
        p_radius_m: liveRadiusM,
        p_stale_after_s: 90,
      });
      if (error) throw error;
      return (Array.isArray(data) ? data : []) as LiveDriverRow[];
    },
    staleTime: 1000,
    refetchInterval: 4000,
  });

  const liveMarkers = React.useMemo<MapMarker[]>(() => {
    const drivers = liveDriversQ.data ?? [];
    return drivers
      .filter((d) => Number.isFinite(d.lat) && Number.isFinite(d.lng))
      .map((d) => ({
        id: d.driver_id,
        position: { lat: d.lat, lng: d.lng },
        label: '🚗',
        title: `Driver ${d.driver_id.slice(0, 8)}`,
      }));
  }, [liveDriversQ.data]);

  const geoTestMut = useMutation({
    mutationFn: async () => {
      const origin = { lat: Number(geoDebug.originLat), lng: Number(geoDebug.originLng) };
      const destination = { lat: Number(geoDebug.destLat), lng: Number(geoDebug.destLng) };
      const { data } = await invokeEdge<any>('geo', {
        action: 'route',
        origin,
        destination,
        profile: 'driving',
        renderer: geoDebug.renderer,
      }, { attempts: 1 });
      return data;
    },
  });

  const [draft, setDraft] = React.useState<Record<string, Partial<ProviderRow>>>({});
  const [capDraft, setCapDraft] = React.useState<Record<string, Partial<CapabilityRow>>>({});

  const capMut = useMutation({
    mutationFn: async (row: CapabilityRow) => {
      const { error } = await supabase.rpc('admin_maps_provider_capability_set_v1', {
        p_provider_code: row.provider_code,
        p_capability: row.capability,
        p_enabled: row.enabled,
        p_unit_label: row.unit_label,
        p_note: row.note,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['admin_maps_capabilities'] });
      await qc.invalidateQueries({ queryKey: ['admin_maps_active_provider'] });
    },
  });

  const setMut = useMutation({
    mutationFn: async (p: ProviderRow) => {
      const d = draft[p.provider_code] ?? {};
      const payload = {
        p_provider_code: p.provider_code,
        p_priority: Number(d.priority ?? p.priority),
        p_enabled: Boolean(d.enabled ?? p.enabled),
        p_language: String(d.language ?? p.language ?? 'ar'),
        p_region: String(d.region ?? p.region ?? 'IQ'),
        p_monthly_soft_cap_units: (d.monthly_soft_cap_units ?? p.monthly_soft_cap_units) as number | null,
        p_monthly_hard_cap_units: (d.monthly_hard_cap_units ?? p.monthly_hard_cap_units) as number | null,
        p_cache_enabled: Boolean(d.cache_enabled ?? p.cache_enabled ?? false),
        p_cache_ttl_seconds: (d.cache_ttl_seconds ?? p.cache_ttl_seconds ?? null) as number | null,
        p_note: (d.note ?? p.note ?? null) as string | null,
      };

      const { error } = await supabase.rpc('admin_maps_provider_set_v2', payload);
      if (error) throw error;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['admin_maps_providers'] });
      await qc.invalidateQueries({ queryKey: ['admin_maps_active_provider'] });
    },
  });

  const clearDraft = () => setDraft({});
  const clearCapDraft = () => setCapDraft({});

  const rows = providersQ.data ?? [];
  const capRows = capsQ.data ?? [];

  const updateDraft = (code: ProviderCode, patch: Partial<ProviderRow>) => {
    setDraft((prev) => ({
      ...prev,
      [code]: { ...prev[code], ...patch },
    }));
  };

  const capKey = (provider_code: ProviderCode, capability: Capability) => `${provider_code}:${capability}`;

  const updateCapDraft = (provider_code: ProviderCode, capability: Capability, patch: Partial<CapabilityRow>) => {
    const k = capKey(provider_code, capability);
    setCapDraft((prev) => ({
      ...prev,
      [k]: { ...prev[k], ...patch },
    }));
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
            <div className="text-lg font-semibold">Not authorized</div>
            <div className="text-sm text-gray-600 mt-2">You do not have admin access.</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <AdminNav />
      <div className="max-w-5xl mx-auto p-6 space-y-6">
        <div className="bg-white rounded-2xl shadow p-6">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <div className="text-xl font-semibold">Maps providers</div>
              <div className="text-sm text-gray-600 mt-1">
                Toggle providers, set priority + caps, and review month-to-date usage.
              </div>
              <div className="text-xs text-gray-500 mt-2">
                Approved renderer stack: Google, Mapbox, and HERE only.
              </div>
            </div>
            <div className="flex gap-2">
              <button className="btn" onClick={clearDraft} disabled={Object.keys(draft).length === 0}>
                Reset edits
              </button>
              <button
                className="btn"
                onClick={() => {
                  void qc.invalidateQueries({ queryKey: ['admin_maps_providers'] });
                  void qc.invalidateQueries({ queryKey: ['admin_maps_active_provider'] });
                }}
              >
                Refresh
              </button>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow p-6">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <div className="text-lg font-semibold">Active provider (render)</div>
              <div className="text-sm text-gray-600">
                {activeQ.isLoading
                  ? 'Loading…'
                  : activeQ.isError
                    ? `Error: ${errorText(activeQ.error)}`
                    : activeQ.data
                      ? `${activeQ.data.provider.toUpperCase()} (language=${activeQ.data.config.language}, region=${activeQ.data.config.region})`
                      : 'Unavailable'}
              </div>
            </div>
          </div>

          <div className="mt-4">
            <div className="text-sm font-medium mb-2">Preview (Baghdad)</div>
            <div className="h-72 w-full rounded-2xl overflow-hidden border border-gray-200">
              <MapView center={{ lat: 33.3152, lng: 44.3661 }} zoom={12} className="w-full h-full" />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow p-6">
          <div className="flex items-start justify-between flex-wrap gap-4">
            <div>
              <div className="text-lg font-semibold">Live view (drivers)</div>
              <div className="text-sm text-gray-600 mt-1">Polls nearby drivers and renders them on the current web renderer provider.</div>
            </div>
            <div className="text-xs text-gray-500">Refreshes every 4s</div>
          </div>

          <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <div className="text-xs text-gray-500 mb-1">Center lat</div>
              <input className="w-full rounded-md border px-2 py-1" value={live.centerLat} onChange={(e) => setLive((s) => ({ ...s, centerLat: e.target.value }))} />
            </div>
            <div>
              <div className="text-xs text-gray-500 mb-1">Center lng</div>
              <input className="w-full rounded-md border px-2 py-1" value={live.centerLng} onChange={(e) => setLive((s) => ({ ...s, centerLng: e.target.value }))} />
            </div>
            <div>
              <div className="text-xs text-gray-500 mb-1">Radius (m)</div>
              <input className="w-full rounded-md border px-2 py-1" value={live.radiusM} onChange={(e) => setLive((s) => ({ ...s, radiusM: e.target.value }))} />
            </div>
          </div>

          <div className="mt-4 h-72 w-full rounded-2xl overflow-hidden border border-gray-200">
            <MapView
              center={liveCenter}
              zoom={12}
              markers={liveMarkers}
              circles={[{ id: 'live-radius', center: liveCenter, radiusMeters: liveRadiusM }]}
              className="w-full h-full"
            />
          </div>

          <div className="mt-2 text-xs text-gray-600">
            {liveDriversQ.isLoading
              ? 'Loading…'
              : liveDriversQ.isError
                ? `Error: ${errorText(liveDriversQ.error)}`
                : `Drivers shown: ${liveMarkers.length}`}
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow p-6">
          <div className="text-lg font-semibold">Providers & usage</div>
          <div className="text-sm text-gray-600 mt-1">
            Usage units are internal counters (approx). Render units are counted per map initialization.
          </div>
          <div className="text-xs text-gray-500 mt-2">
            Cache is off by default: many provider free tiers treat geocoding/routing results as “temporary” and disallow
            persistent caching. Only enable if you have storage rights for that provider and have reviewed its terms.
          </div>

          <div className="mt-4">
            <div className="text-sm font-semibold">Request volume (last 1h / 24h)</div>
            <div className="text-xs text-gray-500 mt-1">
              Counts are based on server-side request logs (synthetic missing-key attempts are excluded). Refreshes every 4s.
            </div>
            {statsQ.isLoading ? (
              <div className="mt-2 text-sm text-gray-600">Loading…</div>
            ) : statsQ.isError ? (
              <div className="mt-2 text-sm text-red-700">{errorText(statsQ.error)}</div>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-500 border-b">
                      <th className="py-2 pr-4">Provider</th>
                      <th className="py-2 pr-4">Capability</th>
                      <th className="py-2 pr-4">Req 1h</th>
                      <th className="py-2 pr-4">Req 24h</th>
                      <th className="py-2 pr-4">Units 1h</th>
                      <th className="py-2 pr-4">Units 24h</th>
                      <th className="py-2 pr-4">Cache hits 1h</th>
                      <th className="py-2 pr-4">Cache hits 24h</th>
                      <th className="py-2 pr-4">Errors 1h</th>
                      <th className="py-2 pr-4">Errors 24h</th>
                      <th className="py-2 pr-4">429 1h</th>
                      <th className="py-2 pr-4">429 24h</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(statsQ.data ?? []).map((s) => (
                      <tr key={`${s.provider_code}:${s.capability}`} className="border-b last:border-b-0">
                        <td className="py-2 pr-4 font-medium">{s.provider_code.toUpperCase()}</td>
                        <td className="py-2 pr-4">{s.capability}</td>
                        <td className="py-2 pr-4">{s.requests_1h}</td>
                        <td className="py-2 pr-4">{s.requests_24h}</td>
                        <td className="py-2 pr-4">{s.billed_units_1h}</td>
                        <td className="py-2 pr-4">{s.billed_units_24h}</td>
                        <td className="py-2 pr-4">{s.cache_hits_1h}</td>
                        <td className="py-2 pr-4">{s.cache_hits_24h}</td>
                        <td className="py-2 pr-4">{s.errors_1h}</td>
                        <td className="py-2 pr-4">{s.errors_24h}</td>
                        <td className="py-2 pr-4">{s.rate_limited_1h}</td>
                        <td className="py-2 pr-4">{s.rate_limited_24h}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {providersQ.isLoading ? (
            <div className="mt-4">Loading…</div>
          ) : providersQ.isError ? (
            <div className="mt-4 text-red-700">{errorText(providersQ.error)}</div>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 border-b">
                    <th className="py-2 pr-4">Provider</th>
                    <th className="py-2 pr-4">Enabled</th>
                    <th className="py-2 pr-4">Priority</th>
                    <th className="py-2 pr-4">Lang</th>
                    <th className="py-2 pr-4">Region</th>
                    <th className="py-2 pr-4">Soft cap</th>
                    <th className="py-2 pr-4">Hard cap</th>
                    <th className="py-2 pr-4">Cache</th>
                    <th className="py-2 pr-4">Cache TTL (s)</th>
                    <th className="py-2 pr-4">MTD render</th>
                    <th className="py-2 pr-4">MTD directions</th>
                    <th className="py-2 pr-4">MTD geocode</th>
                    <th className="py-2 pr-4">MTD matrix</th>
                    <th className="py-2 pr-4">% hard</th>
                    <th className="py-2 pr-4">Note</th>
                    <th className="py-2 pr-4">Updated</th>
                    <th className="py-2 pr-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const d = draft[r.provider_code] ?? {};
                    const enabled = (d.enabled ?? r.enabled) as boolean;
                    const priority = String(d.priority ?? r.priority ?? 0);
                    const language = String(d.language ?? r.language ?? 'ar');
                    const region = String(d.region ?? r.region ?? 'IQ');
                    const soft = d.monthly_soft_cap_units ?? r.monthly_soft_cap_units;
                    const hard = d.monthly_hard_cap_units ?? r.monthly_hard_cap_units;
                    const cacheEnabled = Boolean(d.cache_enabled ?? r.cache_enabled ?? false);
                    const cacheTtl = (d.cache_ttl_seconds ?? r.cache_ttl_seconds ?? null) as number | null;
                    const mtd = r.mtd_render ?? 0;
                    const dirty = Object.keys(d).length > 0;

                    return (
                      <tr key={r.provider_code} className="border-b last:border-b-0">
                        <td className="py-3 pr-4 font-medium">{r.provider_code.toUpperCase()}</td>
                        <td className="py-3 pr-4">
                          <label className="inline-flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={enabled}
                              onChange={(e) => updateDraft(r.provider_code, { enabled: e.target.checked })}
                            />
                            <span className={enabled ? 'text-green-700' : 'text-gray-500'}>
                              {enabled ? 'On' : 'Off'}
                            </span>
                          </label>
                        </td>
                        <td className="py-3 pr-4">
                          <input
                            className="w-24 rounded-md border px-2 py-1"
                            value={priority}
                            onChange={(e) => updateDraft(r.provider_code, { priority: Number(e.target.value) })}
                          />
                        </td>
                        <td className="py-3 pr-4">
                          <input
                            className="w-20 rounded-md border px-2 py-1"
                            value={language}
                            onChange={(e) => updateDraft(r.provider_code, { language: e.target.value })}
                          />
                        </td>
                        <td className="py-3 pr-4">
                          <input
                            className="w-20 rounded-md border px-2 py-1"
                            value={region}
                            onChange={(e) => updateDraft(r.provider_code, { region: e.target.value })}
                          />
                        </td>
                        <td className="py-3 pr-4">
                          <input
                            className="w-28 rounded-md border px-2 py-1"
                            value={soft === null || soft === undefined ? '' : String(soft)}
                            placeholder="—"
                            onChange={(e) => updateDraft(r.provider_code, { monthly_soft_cap_units: numOrNull(e.target.value) })}
                          />
                        </td>
                        <td className="py-3 pr-4">
                          <input
                            className="w-28 rounded-md border px-2 py-1"
                            value={hard === null || hard === undefined ? '' : String(hard)}
                            placeholder="—"
                            onChange={(e) => updateDraft(r.provider_code, { monthly_hard_cap_units: numOrNull(e.target.value) })}
                          />
                        </td>
                        <td className="py-3 pr-4">
                          <label className="inline-flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={cacheEnabled}
                              onChange={(e) => updateDraft(r.provider_code, { cache_enabled: e.target.checked })}
                            />
                            <span className={cacheEnabled ? 'text-green-700' : 'text-gray-500'}>
                              {cacheEnabled ? 'On' : 'Off'}
                            </span>
                          </label>
                        </td>
                        <td className="py-3 pr-4">
                          <input
                            className="w-28 rounded-md border px-2 py-1"
                            value={cacheTtl === null || cacheTtl === undefined ? '' : String(cacheTtl)}
                            placeholder="(disabled)"
                            onChange={(e) => updateDraft(r.provider_code, { cache_ttl_seconds: numOrNull(e.target.value) })}
                          />
                        </td>
                        <td className="py-3 pr-4 tabular-nums">{mtd}</td>
                        <td className="py-3 pr-4 tabular-nums">{r.mtd_directions ?? 0}</td>
                        <td className="py-3 pr-4 tabular-nums">{r.mtd_geocode ?? 0}</td>
                        <td className="py-3 pr-4 tabular-nums">{r.mtd_distance_matrix ?? 0}</td>
                        <td className="py-3 pr-4 tabular-nums">{percent(mtd, hard)}</td>
                        <td className="py-3 pr-4">
                          <input
                            className="w-64 rounded-md border px-2 py-1"
                            value={String(d.note ?? r.note ?? '')}
                            placeholder="(optional)"
                            onChange={(e) => updateDraft(r.provider_code, { note: e.target.value })}
                          />
                        </td>
                        <td className="py-3 pr-4 text-gray-600">{new Date(r.updated_at).toLocaleString()}</td>
                        <td className="py-3 pr-2">
                          <button
                            className={dirty ? 'btn btn-primary' : 'btn'}
                            disabled={!dirty || setMut.isPending}
                            onClick={() => setMut.mutate(r)}
                          >
                            Save
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {setMut.isError ? (
                <div className="mt-4 text-sm text-red-700">{errorText(setMut.error)}</div>
              ) : null}
            </div>
          )}
        </div>

        <div className="bg-white rounded-2xl shadow p-6">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <div className="text-lg font-semibold">Capability matrix</div>
              <div className="text-sm text-gray-600 mt-1">
                If a capability is disabled for a provider, it will never be selected for that capability.
              </div>
              <div className="text-xs text-gray-500 mt-2">
                Unit labels are informational (they do not change billing). They help interpret the internal counters.
              </div>
            </div>
            <div className="flex gap-2">
              <button className="btn" onClick={clearCapDraft} disabled={Object.keys(capDraft).length === 0}>
                Reset edits
              </button>
              <button
                className="btn"
                onClick={() => {
                  void qc.invalidateQueries({ queryKey: ['admin_maps_capabilities'] });
                  void qc.invalidateQueries({ queryKey: ['admin_maps_active_provider'] });
                }}
              >
                Refresh
              </button>
            </div>
          </div>

          {capsQ.isLoading ? (
            <div className="mt-4">Loading…</div>
          ) : capsQ.isError ? (
            <div className="mt-4 text-red-700">{errorText(capsQ.error)}</div>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 border-b">
                    <th className="py-2 pr-4">Provider</th>
                    <th className="py-2 pr-4">Capability</th>
                    <th className="py-2 pr-4">Enabled</th>
                    <th className="py-2 pr-4">Unit label</th>
                    <th className="py-2 pr-4">Note</th>
                    <th className="py-2 pr-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {capRows
                    .slice()
                    .sort((a, b) =>
                      a.provider_code === b.provider_code
                        ? a.capability.localeCompare(b.capability)
                        : a.provider_code.localeCompare(b.provider_code),
                    )
                    .map((r) => {
                      const k = capKey(r.provider_code, r.capability);
                      const d = capDraft[k] ?? {};
                      const enabled = Boolean(d.enabled ?? r.enabled);
                      const unit = (d.unit_label ?? r.unit_label ?? '') as string;
                      const note = (d.note ?? r.note ?? '') as string;
                      const dirty = Object.keys(d).length > 0;

                      return (
                        <tr key={k} className="border-b last:border-b-0">
                          <td className="py-3 pr-4 font-medium">{r.provider_code.toUpperCase()}</td>
                          <td className="py-3 pr-4">{r.capability}</td>
                          <td className="py-3 pr-4">
                            <label className="inline-flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={enabled}
                                onChange={(e) => updateCapDraft(r.provider_code, r.capability, { enabled: e.target.checked })}
                              />
                              <span className={enabled ? 'text-green-700' : 'text-gray-500'}>{enabled ? 'On' : 'Off'}</span>
                            </label>
                          </td>
                          <td className="py-3 pr-4">
                            <input
                              className="w-44 rounded-md border px-2 py-1"
                              value={unit}
                              placeholder="(optional)"
                              onChange={(e) => updateCapDraft(r.provider_code, r.capability, { unit_label: e.target.value })}
                            />
                          </td>
                          <td className="py-3 pr-4">
                            <input
                              className="w-72 rounded-md border px-2 py-1"
                              value={note}
                              placeholder="(optional)"
                              onChange={(e) => updateCapDraft(r.provider_code, r.capability, { note: e.target.value })}
                            />
                          </td>
                          <td className="py-3 pr-2">
                            <button
                              className={dirty ? 'btn btn-primary' : 'btn'}
                              disabled={!dirty || capMut.isPending}
                              onClick={() =>
                                capMut.mutate({
                                  provider_code: r.provider_code,
                                  capability: r.capability,
                                  enabled,
                                  unit_label: unit || null,
                                  note: note || null,
                                })
                              }
                            >
                              Save
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>

              {capMut.isError ? <div className="mt-4 text-sm text-red-700">{errorText(capMut.error)}</div> : null}
            </div>
          )}
        </div>

        <div className="bg-white rounded-2xl shadow p-6">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <div className="text-lg font-semibold">Geo API live test (route)</div>
              <div className="text-sm text-gray-600 mt-1">
                Calls the server-side <code className="px-1 py-0.5 bg-gray-100 rounded">geo</code> Edge Function and shows which provider was used.
              </div>
              <div className="text-xs text-gray-500 mt-2">
                Renderer = the map renderer used by the client. To avoid cross-provider content licensing issues, Google web-services are only used when renderer=google.
              </div>
            </div>
            <div className="flex gap-2">
              <button className="btn" onClick={() => void geoTestMut.mutate()} disabled={geoTestMut.isPending || !isAdmin}>
                Test
              </button>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
            <div>
              <div className="text-xs text-gray-500 mb-1">Origin lat</div>
              <input className="w-full rounded-md border px-2 py-1" value={geoDebug.originLat} onChange={(e) => setGeoDebug((s) => ({ ...s, originLat: e.target.value }))} />
            </div>
            <div>
              <div className="text-xs text-gray-500 mb-1">Origin lng</div>
              <input className="w-full rounded-md border px-2 py-1" value={geoDebug.originLng} onChange={(e) => setGeoDebug((s) => ({ ...s, originLng: e.target.value }))} />
            </div>
            <div>
              <div className="text-xs text-gray-500 mb-1">Dest lat</div>
              <input className="w-full rounded-md border px-2 py-1" value={geoDebug.destLat} onChange={(e) => setGeoDebug((s) => ({ ...s, destLat: e.target.value }))} />
            </div>
            <div>
              <div className="text-xs text-gray-500 mb-1">Dest lng</div>
              <input className="w-full rounded-md border px-2 py-1" value={geoDebug.destLng} onChange={(e) => setGeoDebug((s) => ({ ...s, destLng: e.target.value }))} />
            </div>
            <div>
              <div className="text-xs text-gray-500 mb-1">Renderer</div>
              <select className="w-full rounded-md border px-2 py-1" value={geoDebug.renderer} onChange={(e) => setGeoDebug((s) => ({ ...s, renderer: e.target.value as ProviderCode }))}>
                <option value="google">Google</option>
                <option value="mapbox">Mapbox</option>
                <option value="here">HERE</option>
              </select>
            </div>
          </div>

          <div className="mt-4">
            {geoTestMut.isPending ? <div className="text-sm text-gray-600">Running…</div> : null}
            {geoTestMut.isError ? <div className="text-sm text-red-700">{errorText(geoTestMut.error)}</div> : null}
            {geoTestMut.isSuccess ? (
              <pre className="text-xs bg-gray-50 border rounded-xl p-3 overflow-x-auto">{JSON.stringify(geoTestMut.data, null, 2)}</pre>
            ) : null}
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow p-6">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <div className="text-lg font-semibold">Provider health (circuit breaker)</div>
              <div className="text-sm text-gray-600 mt-1">
                Auto-cooldowns are applied when providers return rate-limit / auth-quota / 5xx or timeout errors.
              </div>
            </div>
            <button className="btn" onClick={() => void qc.invalidateQueries({ queryKey: ['admin_maps_provider_health'] })}>
              Refresh
            </button>
          </div>

          {healthQ.isLoading ? (
            <div className="mt-4">Loading…</div>
          ) : healthQ.isError ? (
            <div className="mt-4 text-red-700">{errorText(healthQ.error)}</div>
          ) : (healthQ.data?.length ?? 0) === 0 ? (
            <div className="mt-4 text-sm text-gray-600">No health records yet (no failures recorded).</div>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 border-b">
                    <th className="py-2 pr-4">Provider</th>
                    <th className="py-2 pr-4">Capability</th>
                    <th className="py-2 pr-4">Failures</th>
                    <th className="py-2 pr-4">Disabled until</th>
                    <th className="py-2 pr-4">Last status</th>
                    <th className="py-2 pr-4">Last error</th>
                    <th className="py-2 pr-4">Last failure</th>
                    <th className="py-2 pr-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {(healthQ.data ?? []).map((h) => {
                    const disabled = h.disabled_until ? new Date(h.disabled_until).getTime() > nowMs : false;
                    return (
                      <tr key={`${h.provider_code}:${h.capability}`} className="border-b last:border-b-0">
                        <td className="py-2 pr-4 font-medium">{h.provider_code.toUpperCase()}</td>
                        <td className="py-2 pr-4">{h.capability}</td>
                        <td className="py-2 pr-4 tabular-nums">{h.consecutive_failures}</td>
                        <td className="py-2 pr-4 text-gray-600 whitespace-nowrap">
                          {h.disabled_until ? new Date(h.disabled_until).toLocaleString() : ''}
                          {disabled ? <span className="ml-2 text-xs text-orange-700">(cooldown)</span> : null}
                        </td>
                        <td className="py-2 pr-4 tabular-nums">{h.last_http_status ?? ''}</td>
                        <td className="py-2 pr-4 text-xs text-red-700">{h.last_error_code ?? ''}</td>
                        <td className="py-2 pr-4 text-gray-600 whitespace-nowrap">
                          {h.last_failure_at ? new Date(h.last_failure_at).toLocaleString() : ''}
                        </td>
                        <td className="py-2 pr-2">
                          <button
                            className="btn"
                            disabled={resetHealthMut.isPending}
                            onClick={() => resetHealthMut.mutate(h)}
                          >
                            Reset
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="bg-white rounded-2xl shadow p-6">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <div className="text-lg font-semibold">Recent map/geo API requests</div>
              <div className="text-sm text-gray-600 mt-1">Live log (auto-refresh every ~4s). Includes cache hits (billed_units=0).</div>
            </div>
            <div className="flex flex-wrap gap-2 items-end">
              <div>
                <div className="text-xs text-gray-500 mb-1">Provider</div>
                <select className="rounded-md border px-2 py-1" value={logProvider} onChange={(e) => setLogProvider(e.target.value as any)}>
                  <option value="all">All</option>
                  <option value="google">Google</option>
                  <option value="mapbox">Mapbox</option>
                  <option value="here">HERE</option>
                </select>
              </div>
              <div>
                <div className="text-xs text-gray-500 mb-1">Capability</div>
                <select className="rounded-md border px-2 py-1" value={logCapability} onChange={(e) => setLogCapability(e.target.value as any)}>
                  <option value="all">All</option>
                  <option value="render">render</option>
                  <option value="directions">directions</option>
                  <option value="geocode">geocode</option>
                  <option value="distance_matrix">distance_matrix</option>
                </select>
              </div>
              <button className="btn" onClick={() => void qc.invalidateQueries({ queryKey: ['admin_maps_requests_log'] })}>
                Refresh
              </button>
            </div>
          </div>

          {logsQ.isLoading ? (
            <div className="mt-4">Loading…</div>
          ) : logsQ.isError ? (
            <div className="mt-4 text-red-700">{errorText(logsQ.error)}</div>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 border-b">
                    <th className="py-2 pr-4">Time</th>
                    <th className="py-2 pr-4">Provider</th>
                    <th className="py-2 pr-4">Attempt</th>
                    <th className="py-2 pr-4">Renderer</th>
                    <th className="py-2 pr-4">Endpoint</th>
                    <th className="py-2 pr-4">Action</th>
                    <th className="py-2 pr-4">Capability</th>
                    <th className="py-2 pr-4">Status</th>
                    <th className="py-2 pr-4">Latency</th>
                    <th className="py-2 pr-4">Units</th>
                    <th className="py-2 pr-4">Cache</th>
                    <th className="py-2 pr-4">Fallback</th>
                    <th className="py-2 pr-4">Error</th>
                    <th className="py-2 pr-2">Summary</th>
                  </tr>
                </thead>
                <tbody>
                  {(logsQ.data ?? []).slice(0, 100).map((r, idx) => (
                    <tr key={`${r.request_id}-${idx}`} className="border-b last:border-b-0 align-top">
                      <td className="py-2 pr-4 text-gray-600 whitespace-nowrap">{new Date(r.created_at).toLocaleString()}</td>
                      <td className="py-2 pr-4 font-medium">{r.provider_code.toUpperCase()}</td>
                      <td className="py-2 pr-4 tabular-nums">{r.attempt_number}</td>
                      <td className="py-2 pr-4 text-gray-600">{(r.client_renderer ?? '').toUpperCase()}</td>
                      <td className="py-2 pr-4 text-xs text-gray-600 whitespace-nowrap">{(r.request_summary as any)?.endpoint ?? ''}</td>
                      <td className="py-2 pr-4">{r.action}</td>
                      <td className="py-2 pr-4">{r.capability}</td>
                      <td className="py-2 pr-4 tabular-nums">{r.http_status}</td>
                      <td className="py-2 pr-4 tabular-nums">{r.latency_ms} ms</td>
                      <td className="py-2 pr-4 tabular-nums">{r.billed_units}</td>
                      <td className="py-2 pr-4">{r.cache_hit ? 'hit' : 'miss'}</td>
                      <td className="py-2 pr-4 text-xs text-gray-600">{r.fallback_reason ?? ''}</td>
                      <td className="py-2 pr-4 text-red-700">{r.error_code ?? ''}</td>
                      <td className="py-2 pr-2">
                        <pre className="text-xs bg-gray-50 border rounded-xl p-2 max-w-[620px] overflow-x-auto">
                          {JSON.stringify(
                            { request: r.request_summary ?? {}, response: r.response_summary ?? {}, tried: r.tried_providers ?? [], error_detail: r.error_detail ?? null },
                            null,
                            2,
                          )}
                        </pre>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
