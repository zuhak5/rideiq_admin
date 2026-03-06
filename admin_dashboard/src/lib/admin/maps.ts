import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { invokeEdgeFunction } from '@/lib/supabase/edge';

export const primaryMapsProviders = ['google', 'mapbox', 'here'] as const;
export const diagnosticMapsProviders = ['ors', 'thunderforest'] as const;
export const allMapsProviders = [
  ...primaryMapsProviders,
  ...diagnosticMapsProviders,
] as const;

export type PrimaryMapsProvider = (typeof primaryMapsProviders)[number];
export type DiagnosticMapsProvider = (typeof diagnosticMapsProviders)[number];
export type ProviderCode = (typeof allMapsProviders)[number];
export type MapsCapability =
  | 'render'
  | 'directions'
  | 'geocode'
  | 'distance_matrix';

export type ProviderRow = {
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

export type CapabilityRow = {
  provider_code: ProviderCode;
  capability: MapsCapability;
  enabled: boolean;
  unit_label: string | null;
  note: string | null;
};

export type ProviderHealthRow = {
  provider_code: ProviderCode;
  capability: MapsCapability;
  consecutive_failures: number;
  disabled_until: string | null;
  last_http_status: number | null;
  last_error_code: string | null;
  last_failure_at: string | null;
  updated_at: string;
};

export type RequestStatsRow = {
  provider_code: ProviderCode;
  capability: MapsCapability;
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

export type MapsRequestLogRow = {
  created_at: string;
  request_id: string;
  actor_user_id: string | null;
  client_renderer: string | null;
  action: string;
  capability: MapsCapability;
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
  request_summary: Record<string, unknown> | null;
  response_summary: Record<string, unknown> | null;
};

export type LiveDriverPoint = {
  driver_id: string;
  lat: number;
  lng: number;
  heading: number | null;
  speed_mps: number | null;
  accuracy_m: number | null;
  updated_at: string;
  vehicle_type: string | null;
};

export type MapsRenderPreview = {
  provider: PrimaryMapsProvider;
  fallbackOrder: ProviderCode[];
  requestId: string | null;
  telemetryExpiresAt: string | null;
  config: Record<string, unknown>;
};

export function isEditableMapsProvider(
  providerCode: ProviderCode,
): providerCode is PrimaryMapsProvider {
  return (primaryMapsProviders as readonly string[]).includes(providerCode);
}

export function sortMapsProviders(rows: ProviderRow[]): ProviderRow[] {
  return [...rows].sort((left, right) => {
    const leftEditable = isEditableMapsProvider(left.provider_code) ? 0 : 1;
    const rightEditable = isEditableMapsProvider(right.provider_code) ? 0 : 1;
    if (leftEditable != rightEditable) {
      return leftEditable - rightEditable;
    }
    if (left.priority != right.priority) {
      return left.priority - right.priority;
    }
    return left.provider_code.localeCompare(right.provider_code);
  });
}

export function sanitizeRendererConfig(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    const sensitive =
      key.toLowerCase().includes('token') ||
      key.toLowerCase().includes('api_key') ||
      key.toLowerCase().includes('apikey') ||
      key.toLowerCase().includes('secret');
    redacted[key] = sensitive ? '[redacted]' : value;
  }
  return redacted;
}

const providerCodeSchema = z.enum([
  'google',
  'mapbox',
  'here',
  'ors',
  'thunderforest',
]);

const mapsRenderPreviewSchema = z.object({
  ok: z.literal(true),
  capability: z.literal('render'),
  provider: z.enum(primaryMapsProviders),
  config: z.record(z.string(), z.unknown()).default({}),
  fallback_order: z.array(providerCodeSchema).optional(),
  request_id: z.string().nullable().optional(),
  telemetry_expires_at: z.string().nullable().optional(),
});

async function listRpcRows<T>(
  supabase: SupabaseClient,
  functionName: string,
  args?: Record<string, unknown>,
): Promise<T[]> {
  const { data, error } = await supabase.rpc(functionName, args ?? {});
  if (error) {
    throw new Error(error.message);
  }
  return Array.isArray(data) ? (data as T[]) : [];
}

async function runRpc(
  supabase: SupabaseClient,
  functionName: string,
  args: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabase.rpc(functionName, args);
  if (error) {
    throw new Error(error.message);
  }
}

export async function listMapsProviders(
  supabase: SupabaseClient,
): Promise<ProviderRow[]> {
  return listRpcRows<ProviderRow>(supabase, 'admin_maps_provider_list_v2');
}

export async function updateMapsProvider(
  supabase: SupabaseClient,
  input: {
    providerCode: PrimaryMapsProvider;
    priority: number;
    enabled: boolean;
    language: string;
    region: string;
    monthlySoftCapUnits?: number | null;
    monthlyHardCapUnits?: number | null;
    cacheEnabled?: boolean;
    cacheTtlSeconds?: number | null;
    note?: string | null;
  },
): Promise<void> {
  await runRpc(supabase, 'admin_maps_provider_set_v2', {
    p_provider_code: input.providerCode,
    p_priority: input.priority,
    p_enabled: input.enabled,
    p_language: input.language,
    p_region: input.region,
    p_monthly_soft_cap_units: input.monthlySoftCapUnits ?? null,
    p_monthly_hard_cap_units: input.monthlyHardCapUnits ?? null,
    p_cache_enabled: input.cacheEnabled ?? false,
    p_cache_ttl_seconds: input.cacheTtlSeconds ?? null,
    p_note: input.note ?? null,
  });
}

export async function listMapsCapabilities(
  supabase: SupabaseClient,
): Promise<CapabilityRow[]> {
  return listRpcRows<CapabilityRow>(
    supabase,
    'admin_maps_provider_capability_list_v1',
  );
}

export async function updateMapsCapability(
  supabase: SupabaseClient,
  input: {
    providerCode: PrimaryMapsProvider;
    capability: MapsCapability;
    enabled: boolean;
    unitLabel?: string | null;
    note?: string | null;
  },
): Promise<void> {
  await runRpc(supabase, 'admin_maps_provider_capability_set_v1', {
    p_provider_code: input.providerCode,
    p_capability: input.capability,
    p_enabled: input.enabled,
    p_unit_label: input.unitLabel ?? null,
    p_note: input.note ?? null,
  });
}

export async function listMapsProviderHealth(
  supabase: SupabaseClient,
): Promise<ProviderHealthRow[]> {
  return listRpcRows<ProviderHealthRow>(
    supabase,
    'admin_maps_provider_health_list_v1',
  );
}

export async function resetMapsProviderHealth(
  supabase: SupabaseClient,
  input: { providerCode: ProviderCode; capability: MapsCapability },
): Promise<void> {
  await runRpc(supabase, 'admin_maps_provider_health_reset_v1', {
    p_provider_code: input.providerCode,
    p_capability: input.capability,
  });
}

export async function listMapsRequestStats(
  supabase: SupabaseClient,
): Promise<RequestStatsRow[]> {
  return listRpcRows<RequestStatsRow>(supabase, 'admin_maps_requests_stats_v1');
}

export async function listMapsRequestLogs(
  supabase: SupabaseClient,
  args: {
    limit: number;
    provider?: ProviderCode | 'all';
    capability?: MapsCapability | 'all';
  },
): Promise<MapsRequestLogRow[]> {
  return listRpcRows<MapsRequestLogRow>(supabase, 'admin_maps_requests_list_v2', {
    p_limit: args.limit,
    p_provider_code:
      args.provider && args.provider !== 'all' ? args.provider : null,
    p_capability:
      args.capability && args.capability !== 'all' ? args.capability : null,
  });
}

export async function fetchMapsRenderPreview(
  supabase: SupabaseClient,
): Promise<MapsRenderPreview> {
  const data = await invokeEdgeFunction<
    z.infer<typeof mapsRenderPreviewSchema>
  >(supabase, 'maps-config-v2', {
    method: 'POST',
    body: {
      capability: 'render',
      supported: [...primaryMapsProviders],
    },
    schema: mapsRenderPreviewSchema,
  });

  return {
    provider: data.provider,
    fallbackOrder: data.fallback_order ?? [],
    requestId: data.request_id ?? null,
    telemetryExpiresAt: data.telemetry_expires_at ?? null,
    config: sanitizeRendererConfig(data.config),
  };
}

export async function fetchServiceAreasOverlay(
  supabase: SupabaseClient,
): Promise<any | null> {
  const data = await invokeEdgeFunction<{ ok: boolean; geojson: any }>(
    supabase,
    'admin-api',
    {
      path: 'admin-service-areas-list',
      method: 'POST',
      body: { q: '', limit: 500, offset: 0 },
    },
  );
  return data.geojson ?? null;
}

export async function fetchLiveDrivers(
  supabase: SupabaseClient,
  args: {
    min_lat?: number;
    min_lng?: number;
    max_lat?: number;
    max_lng?: number;
    max_age_seconds?: number;
    limit?: number;
  } = {},
): Promise<{ drivers: LiveDriverPoint[]; since: string }> {
  const data = await invokeEdgeFunction<{
    ok: boolean;
    drivers: LiveDriverPoint[];
    since: string;
  }>(supabase, 'admin-api', {
    path: 'admin-live-drivers',
    method: 'POST',
    body: {
      ...args,
      max_age_seconds: args.max_age_seconds ?? 300,
      limit: args.limit ?? 1000,
    },
  });
  return { drivers: data.drivers ?? [], since: data.since };
}
