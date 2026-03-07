'use client';

import React from 'react';
import {
  LeafletMapPreview,
  type LeafletMarker,
} from '@/components/maps/LeafletMapPreview';
import {
  diagnosticMapsProviders,
  fetchLiveDrivers,
  fetchMapsRenderPreview,
  fetchServiceAreasOverlay,
  isEditableMapsProvider,
  listMapsCapabilities,
  listMapsProviderHealth,
  listMapsProviders,
  listMapsRequestLogs,
  listMapsRequestStats,
  primaryMapsProviders,
  resetMapsProviderHealth,
  sortMapsProviders,
  updateMapsCapability,
  updateMapsProvider,
  type CapabilityRow,
  type MapsCapability,
  type MapsRenderPreview,
  type MapsRequestLogRow,
  type PrimaryMapsProvider,
  type ProviderCode,
  type ProviderHealthRow,
  type ProviderRow,
  type RequestStatsRow,
} from '@/lib/admin/maps';
import { createClient } from '@/lib/supabase/browser';

type BBox = {
  min_lat: number;
  min_lng: number;
  max_lat: number;
  max_lng: number;
};

type ProviderDraft = {
  enabled?: boolean;
  priority?: number;
};

type CapabilityDraft = {
  enabled?: boolean;
};

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function bboxFromLeafletBounds(bounds: any): BBox | null {
  try {
    const sw = bounds.getSouthWest();
    const ne = bounds.getNorthEast();
    const min_lat = clamp(Number(sw.lat), -90, 90);
    const max_lat = clamp(Number(ne.lat), -90, 90);
    const min_lng = clamp(Number(sw.lng), -180, 180);
    const max_lng = clamp(Number(ne.lng), -180, 180);
    return { min_lat, min_lng, max_lat, max_lng };
  } catch {
    return null;
  }
}

function messageFromError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return 'Request failed';
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  return new Date(value).toLocaleString();
}

function providerLabel(providerCode: ProviderCode): string {
  switch (providerCode) {
    case 'google':
      return 'Google';
    case 'mapbox':
      return 'Mapbox';
    case 'here':
      return 'HERE';
    case 'ors':
      return 'OpenRouteService';
    case 'thunderforest':
      return 'Thunderforest';
  }
}

function capabilityLabel(capability: MapsCapability): string {
  switch (capability) {
    case 'render':
      return 'Render';
    case 'directions':
      return 'Directions';
    case 'geocode':
      return 'Geocode';
    case 'distance_matrix':
      return 'Distance matrix';
  }
}

function capabilityKey(row: {
  provider_code: ProviderCode;
  capability: MapsCapability;
}): string {
  return `${row.provider_code}:${row.capability}`;
}

function percent(numerator: number, denominator: number | null): string {
  if (denominator == null || denominator <= 0) return '—';
  return `${Math.min(100, Math.max(0, (numerator / denominator) * 100)).toFixed(
    1,
  )}%`;
}

function summaryText(value: Record<string, unknown> | null): string {
  if (!value) return '—';
  return JSON.stringify(value, null, 2);
}

export default function MapsClient(): React.JSX.Element {
  const supabase = React.useMemo(() => createClient(), []);
  const [map, setMap] = React.useState<any>(null);
  const [bbox, setBbox] = React.useState<BBox | null>(null);

  const [showAreas, setShowAreas] = React.useState(true);
  const [showDrivers, setShowDrivers] = React.useState(true);
  const [areasGeojson, setAreasGeojson] = React.useState<any | null>(null);
  const [drivers, setDrivers] = React.useState<LeafletMarker[]>([]);
  const [driversSince, setDriversSince] = React.useState<string | null>(null);
  const [driversUpdatedAt, setDriversUpdatedAt] = React.useState<string | null>(
    null,
  );
  const [mapError, setMapError] = React.useState<string | null>(null);

  const [providers, setProviders] = React.useState<ProviderRow[]>([]);
  const [capabilities, setCapabilities] = React.useState<CapabilityRow[]>([]);
  const [stats, setStats] = React.useState<RequestStatsRow[]>([]);
  const [health, setHealth] = React.useState<ProviderHealthRow[]>([]);
  const [renderPreview, setRenderPreview] =
    React.useState<MapsRenderPreview | null>(null);
  const [summaryLoading, setSummaryLoading] = React.useState(true);
  const [summaryError, setSummaryError] = React.useState<string | null>(null);
  const [summaryVersion, setSummaryVersion] = React.useState(0);

  const [logs, setLogs] = React.useState<MapsRequestLogRow[]>([]);
  const [logsLoading, setLogsLoading] = React.useState(true);
  const [logsError, setLogsError] = React.useState<string | null>(null);
  const [logsVersion, setLogsVersion] = React.useState(0);
  const [logProvider, setLogProvider] = React.useState<ProviderCode | 'all'>(
    'all',
  );
  const [logCapability, setLogCapability] = React.useState<
    MapsCapability | 'all'
  >('all');

  const [providerDrafts, setProviderDrafts] = React.useState<
    Record<string, ProviderDraft>
  >({});
  const [capabilityDrafts, setCapabilityDrafts] = React.useState<
    Record<string, CapabilityDraft>
  >({});
  const [providerMutationError, setProviderMutationError] = React.useState<
    string | null
  >(null);
  const [capabilityMutationError, setCapabilityMutationError] = React.useState<
    string | null
  >(null);
  const [savingProviderCode, setSavingProviderCode] =
    React.useState<PrimaryMapsProvider | null>(null);
  const [savingCapabilityKey, setSavingCapabilityKey] = React.useState<
    string | null
  >(null);
  const [resettingHealthKey, setResettingHealthKey] = React.useState<
    string | null
  >(null);

  React.useEffect(() => {
    if (!map) return;
    const update = () => {
      const nextBbox = bboxFromLeafletBounds(map.getBounds());
      if (nextBbox) {
        setBbox(nextBbox);
      }
    };
    update();
    map.on('moveend', update);
    map.on('zoomend', update);
    return () => {
      map.off('moveend', update);
      map.off('zoomend', update);
    };
  }, [map]);

  React.useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const nextGeojson = await fetchServiceAreasOverlay(supabase);
        if (!cancelled) {
          setAreasGeojson(nextGeojson);
          setMapError(null);
        }
      } catch (error) {
        if (!cancelled) {
          setAreasGeojson(null);
          setMapError(messageFromError(error));
        }
      }
    };
    void load();
    const intervalId = window.setInterval(load, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [supabase]);

  React.useEffect(() => {
    if (!showDrivers) {
      setDrivers([]);
      return;
    }
    if (!bbox) return;

    let cancelled = false;
    const load = async () => {
      try {
        const data = await fetchLiveDrivers(supabase, {
          ...bbox,
          max_age_seconds: 300,
          limit: 2000,
        });
        if (cancelled) return;
        setDriversSince(data.since);
        setDriversUpdatedAt(new Date().toISOString());
        setMapError(null);
        setDrivers(
          data.drivers.map((driver) => ({
            id: driver.driver_id,
            lat: driver.lat,
            lng: driver.lng,
            title: `driver ${driver.driver_id.slice(0, 8)}`,
          })),
        );
      } catch (error) {
        if (!cancelled) {
          setDrivers([]);
          setMapError(messageFromError(error));
        }
      }
    };
    void load();
    const intervalId = window.setInterval(load, 5_000);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [bbox, showDrivers, supabase]);

  React.useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setSummaryLoading(true);
      setSummaryError(null);
      try {
        const [
          nextProviders,
          nextCapabilities,
          nextStats,
          nextHealth,
          nextPreview,
        ] = await Promise.all([
          listMapsProviders(supabase),
          listMapsCapabilities(supabase),
          listMapsRequestStats(supabase),
          listMapsProviderHealth(supabase),
          fetchMapsRenderPreview(supabase),
        ]);
        if (cancelled) return;
        setProviders(sortMapsProviders(nextProviders));
        setCapabilities(nextCapabilities);
        setStats(nextStats);
        setHealth(nextHealth);
        setRenderPreview(nextPreview);
      } catch (error) {
        if (!cancelled) {
          setSummaryError(messageFromError(error));
        }
      } finally {
        if (!cancelled) {
          setSummaryLoading(false);
        }
      }
    };
    void load();
    const intervalId = window.setInterval(load, 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [summaryVersion, supabase]);

  React.useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLogsLoading(true);
      setLogsError(null);
      try {
        const nextLogs = await listMapsRequestLogs(supabase, {
          limit: 60,
          provider: logProvider,
          capability: logCapability,
        });
        if (!cancelled) {
          setLogs(nextLogs);
        }
      } catch (error) {
        if (!cancelled) {
          setLogsError(messageFromError(error));
        }
      } finally {
        if (!cancelled) {
          setLogsLoading(false);
        }
      }
    };
    void load();
    const intervalId = window.setInterval(load, 5_000);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [logCapability, logProvider, logsVersion, supabase]);

  const editableProviders = providers.filter(
    (
      row,
    ): row is ProviderRow & { provider_code: PrimaryMapsProvider } =>
      isEditableMapsProvider(row.provider_code),
  );
  const diagnosticProviders = providers.filter(
    (row) => !isEditableMapsProvider(row.provider_code),
  );

  const updateProviderDraft = (
    providerCode: PrimaryMapsProvider,
    patch: ProviderDraft,
  ) => {
    setProviderDrafts((current) => ({
      ...current,
      [providerCode]: { ...current[providerCode], ...patch },
    }));
  };

  const updateCapabilityDraft = (
    providerCode: PrimaryMapsProvider,
    capability: MapsCapability,
    patch: CapabilityDraft,
  ) => {
    const key = `${providerCode}:${capability}`;
    setCapabilityDrafts((current) => ({
      ...current,
      [key]: { ...current[key], ...patch },
    }));
  };

  const saveProvider = async (row: ProviderRow) => {
    if (!isEditableMapsProvider(row.provider_code)) return;
    const draft = providerDrafts[row.provider_code] ?? {};
    setSavingProviderCode(row.provider_code);
    setProviderMutationError(null);
    try {
      await updateMapsProvider(supabase, {
        providerCode: row.provider_code,
        enabled: draft.enabled ?? row.enabled,
        priority: draft.priority ?? row.priority,
        language: row.language,
        region: row.region,
        monthlySoftCapUnits: row.monthly_soft_cap_units,
        monthlyHardCapUnits: row.monthly_hard_cap_units,
        cacheEnabled: row.cache_enabled,
        cacheTtlSeconds: row.cache_ttl_seconds,
        note: row.note,
      });
      setProviderDrafts((current) => {
        const next = { ...current };
        delete next[row.provider_code];
        return next;
      });
      setSummaryVersion((value) => value + 1);
    } catch (error) {
      setProviderMutationError(messageFromError(error));
    } finally {
      setSavingProviderCode(null);
    }
  };

  const saveCapability = async (row: CapabilityRow) => {
    if (!isEditableMapsProvider(row.provider_code)) return;
    const key = capabilityKey(row);
    const draft = capabilityDrafts[key] ?? {};
    setSavingCapabilityKey(key);
    setCapabilityMutationError(null);
    try {
      await updateMapsCapability(supabase, {
        providerCode: row.provider_code,
        capability: row.capability,
        enabled: draft.enabled ?? row.enabled,
        unitLabel: row.unit_label,
        note: row.note,
      });
      setCapabilityDrafts((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      setSummaryVersion((value) => value + 1);
    } catch (error) {
      setCapabilityMutationError(messageFromError(error));
    } finally {
      setSavingCapabilityKey(null);
    }
  };

  const handleHealthReset = async (row: ProviderHealthRow) => {
    const key = capabilityKey(row);
    setResettingHealthKey(key);
    try {
      await resetMapsProviderHealth(supabase, {
        providerCode: row.provider_code,
        capability: row.capability,
      });
      setSummaryVersion((value) => value + 1);
    } finally {
      setResettingHealthKey(null);
    }
  };

  return (
    <div className="space-y-5">
      <section className="rounded-xl border bg-white p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold">App renderer control</h2>
            <p className="text-sm text-neutral-600">
              The app requests render config from <code>maps-config-v2</code>{' '}
              with fixed fallback order: Google → Mapbox → HERE.
            </p>
            <p className="text-xs text-neutral-500">
              Google, Mapbox, and HERE are editable here. ORS and
              Thunderforest stay read-only because backend geo fallback still
              depends on them.
            </p>
          </div>
          <button
            type="button"
            className="rounded-md border bg-white px-3 py-2 text-sm hover:bg-neutral-50"
            onClick={() => {
              setSummaryVersion((value) => value + 1);
              setLogsVersion((value) => value + 1);
            }}
          >
            Refresh data
          </button>
        </div>

        {summaryError ? (
          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {summaryError}
          </div>
        ) : null}

        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <div className="rounded-lg border bg-neutral-50 p-3">
            <div className="text-xs uppercase tracking-wide text-neutral-500">
              Active renderer
            </div>
            <div className="mt-1 text-lg font-semibold">
              {renderPreview ? providerLabel(renderPreview.provider) : 'Loading…'}
            </div>
            <div className="mt-1 text-xs text-neutral-500">
              request_id={renderPreview?.requestId ?? '—'}
            </div>
          </div>
          <div className="rounded-lg border bg-neutral-50 p-3">
            <div className="text-xs uppercase tracking-wide text-neutral-500">
              Fallback order
            </div>
            <div className="mt-1 text-sm font-medium">
              {(renderPreview?.fallbackOrder ?? [])
                .map(providerLabel)
                .join(' → ') || '—'}
            </div>
            <div className="mt-1 text-xs text-neutral-500">
              Supported set: Google, Mapbox, HERE
            </div>
          </div>
          <div className="rounded-lg border bg-neutral-50 p-3">
            <div className="text-xs uppercase tracking-wide text-neutral-500">
              Telemetry expiry
            </div>
            <div className="mt-1 text-sm font-medium">
              {formatDateTime(renderPreview?.telemetryExpiresAt)}
            </div>
          </div>
        </div>

        {renderPreview ? (
          <pre className="mt-3 overflow-x-auto rounded-lg border bg-neutral-950 p-3 text-xs text-neutral-100">
            {JSON.stringify(renderPreview.config, null, 2)}
          </pre>
        ) : null}
      </section>

      <section className="rounded-xl border bg-white p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Primary render providers</h2>
            <p className="text-sm text-neutral-600">
              Enable or disable each renderer and adjust priority. Higher
              priority wins.
            </p>
          </div>
          {summaryLoading ? (
            <div className="text-sm text-neutral-500">Refreshing…</div>
          ) : null}
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="border-b bg-neutral-50 text-left text-neutral-500">
              <tr>
                <th className="px-3 py-2 font-medium">Provider</th>
                <th className="px-3 py-2 font-medium">Enabled</th>
                <th className="px-3 py-2 font-medium">Priority</th>
                <th className="px-3 py-2 font-medium">Render MTD</th>
                <th className="px-3 py-2 font-medium">Hard cap</th>
                <th className="px-3 py-2 font-medium">Updated</th>
                <th className="px-3 py-2 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {editableProviders.map((row) => {
                const draft = providerDrafts[row.provider_code] ?? {};
                const enabled = draft.enabled ?? row.enabled;
                const priority = draft.priority ?? row.priority;
                const dirty = Object.keys(draft).length > 0;
                return (
                  <tr key={row.provider_code} className="border-b last:border-b-0">
                    <td className="px-3 py-3">
                      <div className="font-medium">
                        {providerLabel(row.provider_code)}
                      </div>
                      <div className="text-xs text-neutral-500">
                        language={row.language} • region={row.region}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <label className="inline-flex items-center gap-2">
                        <input
                          aria-label={`Enable ${row.provider_code}`}
                          type="checkbox"
                          checked={enabled}
                          onChange={(event) =>
                            updateProviderDraft(row.provider_code, {
                              enabled: event.target.checked,
                            })
                          }
                        />
                        <span
                          className={
                            enabled ? 'text-emerald-700' : 'text-neutral-500'
                          }
                        >
                          {enabled ? 'On' : 'Off'}
                        </span>
                      </label>
                    </td>
                    <td className="px-3 py-3">
                      <input
                        aria-label={`${row.provider_code} priority`}
                        className="w-24 rounded-md border px-2 py-1"
                        type="number"
                        value={priority}
                        onChange={(event) =>
                          updateProviderDraft(row.provider_code, {
                            priority: Number.isFinite(event.target.valueAsNumber)
                              ? event.target.valueAsNumber
                              : 0,
                          })
                        }
                      />
                    </td>
                    <td className="px-3 py-3 tabular-nums">{row.mtd_render}</td>
                    <td className="px-3 py-3">
                      {row.monthly_hard_cap_units == null
                        ? '—'
                        : `${row.monthly_hard_cap_units} (${percent(
                            row.mtd_render,
                            row.monthly_hard_cap_units,
                          )})`}
                    </td>
                    <td className="px-3 py-3 text-neutral-500">
                      {formatDateTime(row.updated_at)}
                    </td>
                    <td className="px-3 py-3 text-right">
                      <button
                        aria-label={`Save ${row.provider_code}`}
                        type="button"
                        className="rounded-md border bg-white px-3 py-2 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50"
                        disabled={
                          !dirty || savingProviderCode === row.provider_code
                        }
                        onClick={() => void saveProvider(row)}
                      >
                        {savingProviderCode === row.provider_code
                          ? 'Saving…'
                          : 'Save'}
                      </button>
                    </td>
                  </tr>
                );
              })}
              {editableProviders.length === 0 ? (
                <tr>
                  <td className="px-3 py-6 text-neutral-500" colSpan={7}>
                    No render providers returned by the backend.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        {providerMutationError ? (
          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {providerMutationError}
          </div>
        ) : null}
      </section>

      <section className="rounded-xl border bg-white p-4">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">Backend diagnostics providers</h2>
          <p className="text-sm text-neutral-600">
            ORS and Thunderforest remain read-only here because backend geo
            routing and fallback policy are out of scope.
          </p>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[680px] text-sm">
            <thead className="border-b bg-neutral-50 text-left text-neutral-500">
              <tr>
                <th className="px-3 py-2 font-medium">Provider</th>
                <th className="px-3 py-2 font-medium">Enabled</th>
                <th className="px-3 py-2 font-medium">Priority</th>
                <th className="px-3 py-2 font-medium">Directions MTD</th>
                <th className="px-3 py-2 font-medium">Geocode MTD</th>
                <th className="px-3 py-2 font-medium">Updated</th>
              </tr>
            </thead>
            <tbody>
              {diagnosticProviders.map((row) => (
                <tr key={row.provider_code} className="border-b last:border-b-0">
                  <td className="px-3 py-3 font-medium">
                    {providerLabel(row.provider_code)}
                  </td>
                  <td className="px-3 py-3">{row.enabled ? 'On' : 'Off'}</td>
                  <td className="px-3 py-3 tabular-nums">{row.priority}</td>
                  <td className="px-3 py-3 tabular-nums">
                    {row.mtd_directions}
                  </td>
                  <td className="px-3 py-3 tabular-nums">{row.mtd_geocode}</td>
                  <td className="px-3 py-3 text-neutral-500">
                    {formatDateTime(row.updated_at)}
                  </td>
                </tr>
              ))}
              {diagnosticProviders.length === 0 ? (
                <tr>
                  <td className="px-3 py-6 text-neutral-500" colSpan={6}>
                    No diagnostics providers returned.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-xl border bg-white p-4">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">Capability matrix</h2>
          <p className="text-sm text-neutral-600">
            Capability flags stay editable for Google, Mapbox, and HERE only.
          </p>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="border-b bg-neutral-50 text-left text-neutral-500">
              <tr>
                <th className="px-3 py-2 font-medium">Provider</th>
                <th className="px-3 py-2 font-medium">Capability</th>
                <th className="px-3 py-2 font-medium">Enabled</th>
                <th className="px-3 py-2 font-medium">Note</th>
                <th className="px-3 py-2 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {capabilities.map((row) => {
                const editable = isEditableMapsProvider(row.provider_code);
                const editableProviderCode = editable
                  ? (row.provider_code as PrimaryMapsProvider)
                  : null;
                const key = capabilityKey(row);
                const draft = capabilityDrafts[key] ?? {};
                const enabled = draft.enabled ?? row.enabled;
                const dirty = Object.keys(draft).length > 0;
                return (
                  <tr key={key} className="border-b last:border-b-0">
                    <td className="px-3 py-3 font-medium">
                      {providerLabel(row.provider_code)}
                    </td>
                    <td className="px-3 py-3">
                      {capabilityLabel(row.capability)}
                    </td>
                    <td className="px-3 py-3">
                      {editable ? (
                        <label className="inline-flex items-center gap-2">
                          <input
                            aria-label={`${row.provider_code}-${row.capability}-enabled`}
                            type="checkbox"
                            checked={enabled}
                            onChange={(event) =>
                              updateCapabilityDraft(
                                editableProviderCode!,
                                row.capability,
                                { enabled: event.target.checked },
                              )
                            }
                          />
                          <span
                            className={
                              enabled ? 'text-emerald-700' : 'text-neutral-500'
                            }
                          >
                            {enabled ? 'On' : 'Off'}
                          </span>
                        </label>
                      ) : (
                        <span
                          className={
                            enabled ? 'text-emerald-700' : 'text-neutral-500'
                          }
                        >
                          {enabled ? 'On' : 'Off'}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-neutral-500">
                      {row.note ?? '—'}
                    </td>
                    <td className="px-3 py-3 text-right">
                      {editable ? (
                        <button
                          type="button"
                          className="rounded-md border bg-white px-3 py-2 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50"
                          disabled={!dirty || savingCapabilityKey === key}
                          onClick={() => void saveCapability(row)}
                        >
                          {savingCapabilityKey === key ? 'Saving…' : 'Save'}
                        </button>
                      ) : (
                        <span className="text-xs text-neutral-400">
                          Read only
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {capabilityMutationError ? (
          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {capabilityMutationError}
          </div>
        ) : null}
      </section>

      <section className="rounded-xl border bg-white p-4">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">Provider health</h2>
          <p className="text-sm text-neutral-600">
            Reset circuit-breaker cooldowns after quota or upstream issues are
            resolved.
          </p>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="border-b bg-neutral-50 text-left text-neutral-500">
              <tr>
                <th className="px-3 py-2 font-medium">Provider</th>
                <th className="px-3 py-2 font-medium">Capability</th>
                <th className="px-3 py-2 font-medium">Failures</th>
                <th className="px-3 py-2 font-medium">Disabled until</th>
                <th className="px-3 py-2 font-medium">Last status</th>
                <th className="px-3 py-2 font-medium">Last error</th>
                <th className="px-3 py-2 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {health.map((row) => {
                const key = capabilityKey(row);
                return (
                  <tr key={key} className="border-b last:border-b-0">
                    <td className="px-3 py-3 font-medium">
                      {providerLabel(row.provider_code)}
                    </td>
                    <td className="px-3 py-3">
                      {capabilityLabel(row.capability)}
                    </td>
                    <td className="px-3 py-3 tabular-nums">
                      {row.consecutive_failures}
                    </td>
                    <td className="px-3 py-3">
                      {formatDateTime(row.disabled_until)}
                    </td>
                    <td className="px-3 py-3 tabular-nums">
                      {row.last_http_status ?? '—'}
                    </td>
                    <td className="px-3 py-3 text-red-700">
                      {row.last_error_code ?? '—'}
                    </td>
                    <td className="px-3 py-3 text-right">
                      <button
                        type="button"
                        className="rounded-md border bg-white px-3 py-2 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50"
                        disabled={resettingHealthKey === key}
                        onClick={() => void handleHealthReset(row)}
                      >
                        {resettingHealthKey === key ? 'Resetting…' : 'Reset'}
                      </button>
                    </td>
                  </tr>
                );
              })}
              {health.length === 0 ? (
                <tr>
                  <td className="px-3 py-6 text-neutral-500" colSpan={7}>
                    No provider health records yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-xl border bg-white p-4">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">Request stats</h2>
          <p className="text-sm text-neutral-600">
            Hourly and daily request volume from server-side maps logs.
          </p>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="border-b bg-neutral-50 text-left text-neutral-500">
              <tr>
                <th className="px-3 py-2 font-medium">Provider</th>
                <th className="px-3 py-2 font-medium">Capability</th>
                <th className="px-3 py-2 font-medium">Req 1h</th>
                <th className="px-3 py-2 font-medium">Req 24h</th>
                <th className="px-3 py-2 font-medium">Units 1h</th>
                <th className="px-3 py-2 font-medium">Units 24h</th>
                <th className="px-3 py-2 font-medium">Cache 1h</th>
                <th className="px-3 py-2 font-medium">Cache 24h</th>
                <th className="px-3 py-2 font-medium">Errors 24h</th>
                <th className="px-3 py-2 font-medium">429 24h</th>
              </tr>
            </thead>
            <tbody>
              {stats.map((row) => (
                <tr key={capabilityKey(row)} className="border-b last:border-b-0">
                  <td className="px-3 py-3 font-medium">
                    {providerLabel(row.provider_code)}
                  </td>
                  <td className="px-3 py-3">
                    {capabilityLabel(row.capability)}
                  </td>
                  <td className="px-3 py-3 tabular-nums">{row.requests_1h}</td>
                  <td className="px-3 py-3 tabular-nums">
                    {row.requests_24h}
                  </td>
                  <td className="px-3 py-3 tabular-nums">
                    {row.billed_units_1h}
                  </td>
                  <td className="px-3 py-3 tabular-nums">
                    {row.billed_units_24h}
                  </td>
                  <td className="px-3 py-3 tabular-nums">
                    {row.cache_hits_1h}
                  </td>
                  <td className="px-3 py-3 tabular-nums">
                    {row.cache_hits_24h}
                  </td>
                  <td className="px-3 py-3 tabular-nums">{row.errors_24h}</td>
                  <td className="px-3 py-3 tabular-nums">
                    {row.rate_limited_24h}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-xl border bg-white p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold">Recent request log</h2>
            <p className="text-sm text-neutral-600">
              Server-side maps and geo requests with provider attempts, cache
              hits, and fallback reasons.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <label className="text-sm">
              <span className="mb-1 block text-xs text-neutral-500">
                Provider
              </span>
              <select
                aria-label="Log provider filter"
                className="rounded-md border px-3 py-2"
                value={logProvider}
                onChange={(event) =>
                  setLogProvider(event.target.value as ProviderCode | 'all')
                }
              >
                <option value="all">All</option>
                {[...primaryMapsProviders, ...diagnosticMapsProviders].map(
                  (provider) => (
                    <option key={provider} value={provider}>
                      {providerLabel(provider)}
                    </option>
                  ),
                )}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs text-neutral-500">
                Capability
              </span>
              <select
                aria-label="Log capability filter"
                className="rounded-md border px-3 py-2"
                value={logCapability}
                onChange={(event) =>
                  setLogCapability(event.target.value as MapsCapability | 'all')
                }
              >
                <option value="all">All</option>
                <option value="render">Render</option>
                <option value="directions">Directions</option>
                <option value="geocode">Geocode</option>
                <option value="distance_matrix">Distance matrix</option>
              </select>
            </label>
            <button
              type="button"
              className="rounded-md border bg-white px-3 py-2 text-sm hover:bg-neutral-50"
              onClick={() => setLogsVersion((value) => value + 1)}
            >
              Refresh logs
            </button>
          </div>
        </div>

        {logsError ? (
          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {logsError}
          </div>
        ) : null}

        <div className="mt-4 overflow-x-auto" data-testid="maps-request-log-table">
          <table className="w-full min-w-[1200px] text-sm">
            <thead className="border-b bg-neutral-50 text-left text-neutral-500">
              <tr>
                <th className="px-3 py-2 font-medium">Time</th>
                <th className="px-3 py-2 font-medium">Provider</th>
                <th className="px-3 py-2 font-medium">Capability</th>
                <th className="px-3 py-2 font-medium">Attempt</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Latency</th>
                <th className="px-3 py-2 font-medium">Renderer</th>
                <th className="px-3 py-2 font-medium">Fallback</th>
                <th className="px-3 py-2 font-medium">Summary</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((row, index) => (
                <tr
                  key={`${row.request_id}-${index}`}
                  className="border-b last:border-b-0 align-top"
                >
                  <td className="px-3 py-3 text-neutral-500">
                    {formatDateTime(row.created_at)}
                  </td>
                  <td className="px-3 py-3 font-medium">
                    {providerLabel(row.provider_code)}
                  </td>
                  <td className="px-3 py-3">
                    {capabilityLabel(row.capability)}
                  </td>
                  <td className="px-3 py-3 tabular-nums">
                    {row.attempt_number}
                  </td>
                  <td className="px-3 py-3 tabular-nums">{row.http_status}</td>
                  <td className="px-3 py-3 tabular-nums">
                    {row.latency_ms} ms
                  </td>
                  <td className="px-3 py-3">{row.client_renderer ?? '—'}</td>
                  <td className="px-3 py-3 text-neutral-500">
                    {row.fallback_reason ?? '—'}
                  </td>
                  <td className="px-3 py-3">
                    <pre className="max-w-[520px] overflow-x-auto rounded-lg border bg-neutral-50 p-2 text-xs text-neutral-700">
                      {summaryText(row.request_summary)}
                    </pre>
                  </td>
                </tr>
              ))}
              {!logsLoading && logs.length === 0 ? (
                <tr>
                  <td className="px-3 py-6 text-neutral-500" colSpan={9}>
                    No request log rows matched the current filters.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-xl border bg-white p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold">Operations map</h2>
            <p className="text-sm text-neutral-600">
              Service-area overlays and live driver points from the existing
              admin backend endpoints.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={showAreas}
                onChange={(event) => setShowAreas(event.target.checked)}
              />
              Service areas
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={showDrivers}
                onChange={(event) => setShowDrivers(event.target.checked)}
              />
              Live drivers
            </label>
          </div>
        </div>

        <div className="mt-3 text-xs text-neutral-500">
          {showDrivers ? `drivers=${drivers.length}` : 'drivers=hidden'}
          {driversUpdatedAt
            ? ` • updated=${new Date(driversUpdatedAt).toLocaleTimeString()}`
            : ''}
          {driversSince ? ` • window=${driversSince}` : ''}
        </div>
        {mapError ? (
          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {mapError}
          </div>
        ) : null}

        <LeafletMapPreview
          center={{ lat: 33.3152, lng: 44.3661 }}
          zoom={11}
          onMapReady={(leafletMap) => setMap(leafletMap)}
          fitGeojson={false}
          geojson={showAreas ? areasGeojson : null}
          markers={showDrivers ? drivers : []}
          className="mt-4 h-[72vh] w-full rounded-xl border"
        />
      </section>
    </div>
  );
}
