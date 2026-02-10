import { supabase } from './supabaseClient';
import { getLastMapsConfig, type MapsProvider } from './mapsConfig';

export type MapsCapability = 'render' | 'directions' | 'geocode' | 'distance_matrix';
export type MapsRenderEvent = 'render_success' | 'render_failure';

export type MapsUsageMeta = {
  event?: MapsRenderEvent;
  request_id?: string;
  telemetry_token?: string;
  attempt_number?: number;
  tried_providers?: MapsProvider[];
  latency_ms?: number;
  error_detail?: string;
};

export async function logMapsUsage(
  capability: MapsCapability,
  units: number = 1,
  providerOverride?: MapsProvider,
  meta?: MapsUsageMeta,
): Promise<void> {
  const cfg = getLastMapsConfig();
  const provider_code = providerOverride ?? cfg?.provider ?? 'google';
  const telemetry_token = meta?.telemetry_token ?? cfg?.telemetry_token;

  try {
    await supabase.functions.invoke('maps-usage', {
      body: {
        provider_code,
        capability,
        units,
        ...(meta ?? {}),
        ...(telemetry_token ? { telemetry_token } : {}),
      },
    });
  } catch {
    // Best-effort logging only.
  }
}
