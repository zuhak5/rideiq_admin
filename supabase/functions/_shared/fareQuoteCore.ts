import { envTrim } from './config.ts';
import type { FareQuoteInput } from './schemas.ts';
import type { RequestContext } from './requestContext.ts';

type OsrmRoute = {
  distance: number; // meters
  duration: number; // seconds
};

export class FareEngineError extends Error {
  status: number;
  code: string;
  details?: Record<string, unknown>;

  constructor(message: string, status: number, code: string, details?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function fetchWithTimeout(input: string, init: RequestInit, timeoutMs: number) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

async function getOsrmRoute(params: {
  pickupLat: number;
  pickupLng: number;
  dropoffLat: number;
  dropoffLng: number;
}): Promise<OsrmRoute> {
  const base = envTrim('ROUTING_OSRM_BASE_URL') || 'https://router.project-osrm.org';
  const url = new URL(
    `${base.replace(/\/$/, '')}/route/v1/driving/${params.pickupLng},${params.pickupLat};${params.dropoffLng},${params.dropoffLat}`,
  );
  url.searchParams.set('overview', 'false');
  url.searchParams.set('steps', 'false');
  url.searchParams.set('annotations', 'false');

  const res = await fetchWithTimeout(url.toString(), { method: 'GET' }, 4500);
  if (!res.ok) throw new Error(`OSRM HTTP ${res.status}`);

  const body = await res.json();
  const r = body?.routes?.[0];
  const distance = Number(r?.distance);
  const duration = Number(r?.duration);
  if (!Number.isFinite(distance) || !Number.isFinite(duration)) {
    throw new Error('OSRM response missing distance/duration');
  }
  return { distance, duration };
}

async function getOpenMeteoCurrent(lat: number, lng: number): Promise<Record<string, unknown> | null> {
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', String(lat));
  url.searchParams.set('longitude', String(lng));
  url.searchParams.set('current', 'temperature_2m,precipitation,weather_code,wind_speed_10m');
  url.searchParams.set('timezone', 'Asia/Baghdad');

  try {
    const res = await fetchWithTimeout(url.toString(), { method: 'GET' }, 3500);
    if (!res.ok) return null;
    const body = await res.json();
    const current = body?.current;
    if (!current || typeof current !== 'object') return null;
    return {
      source: 'open-meteo',
      current,
      units: body?.current_units ?? undefined,
      fetched_at: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

function roundToStep(value: number, step: number, mode: 'nearest' | 'up' | 'down' = 'nearest'): number {
  const v = Math.max(0, Math.trunc(value));
  const s = Math.max(1, Math.trunc(step));
  if (s === 1) return v;

  const q = v / s;
  if (mode === 'up') return Math.ceil(q) * s;
  if (mode === 'down') return Math.floor(q) * s;
  return Math.round(q) * s;
}

function ceilInt(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.ceil(n);
}

function safeRecord(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  return v as Record<string, unknown>;
}

function getLocalParts(utc: Date, timeZone: string) {
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    weekday: 'short',
  });
  const parts = dtf.formatToParts(utc);
  const get = (type: string) => parts.find((p) => p.type === type)?.value;

  const year = Number(get('year') ?? '0');
  const month = Number(get('month') ?? '0');
  const day = Number(get('day') ?? '0');
  const hour = Number(get('hour') ?? '0');
  const minute = Number(get('minute') ?? '0');
  const second = Number(get('second') ?? '0');
  const weekday = String(get('weekday') ?? '');
  const localDate = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return { year, month, day, hour, minute, second, weekday, localDate };
}

function normalizeContext(input: FareQuoteInput, serviceArea?: { governorate?: string | null; name?: string | null }) {
  // Canonical, non-identifying telemetry schema.
  const requestedAtUtc = new Date();
  const tz = 'Asia/Baghdad';
  const local = getLocalParts(requestedAtUtc, tz);
  const clientContext = safeRecord(input.context);

  return {
    schema_version: 1,
    request: {
      requested_at_utc: requestedAtUtc.toISOString(),
      timezone: tz,
      local_date: local.localDate,
      local_hour: local.hour,
      local_weekday: local.weekday,
      local_month: local.month,
      local_year: local.year,
      // Weekend in Iraq is commonly Fri/Sat; encode explicitly for modeling.
      is_weekend_iq: local.weekday === 'Fri' || local.weekday === 'Sat',
    },
    geo: {
      country: 'IQ',
      governorate: serviceArea?.governorate ?? null,
      service_area_name: serviceArea?.name ?? null,
    },
    vehicle: {
      class: input.vehicle_class ?? null,
      year: input.vehicle_year ?? null,
    },
    routing: {
      pickup_deadhead_m: input.pickup_deadhead_m ?? null,
    },
    // Preserve extra, non-identifying client context (versioning, client type, etc.).
    client_context: clientContext,
  } as Record<string, unknown>;
}

export async function quoteAndStoreFare(params: {
  supabase: any; // Supabase client (anon or service role)
  riderId: string;
  input: FareQuoteInput;
  engineName: string;
  ctx?: RequestContext;
}) {
  const { supabase, riderId, input, engineName, ctx } = params;

  const routeFetchedAt = new Date().toISOString();
  let route: OsrmRoute;
  try {
    route = await getOsrmRoute({
      pickupLat: input.pickup_lat,
      pickupLng: input.pickup_lng,
      dropoffLat: input.dropoff_lat,
      dropoffLng: input.dropoff_lng,
    });
  } catch (e) {
    ctx?.warn('osrm.route_failed', { error: String(e) });
    throw new FareEngineError('Routing unavailable', 503, 'ROUTING_UNAVAILABLE');
  }

  const weather = await getOpenMeteoCurrent(input.pickup_lat, input.pickup_lng);

  // Resolve pickup -> service area (zone-specific pricing).
  const { data: saData, error: saErr } = await supabase.rpc('resolve_service_area', {
    p_lat: input.pickup_lat,
    p_lng: input.pickup_lng,
  });
  if (saErr) {
    ctx?.warn('service_area.resolve_failed', { error: saErr.message });
    throw new FareEngineError('Unable to resolve service area', 400, 'SERVICE_AREA_RESOLVE_FAILED');
  }
  const saRow = Array.isArray(saData) ? saData[0] : saData;
  const serviceAreaId = saRow?.id ?? null;
  if (!serviceAreaId) {
    throw new FareEngineError('Pickup is outside supported service areas', 400, 'OUTSIDE_SERVICE_AREA');
  }

  // Load service area overrides + pricing config.
  let serviceArea: any = null;
  const { data: saFull } = await supabase
    .from('service_areas')
    .select('id,name,governorate,pricing_config_id,min_base_fare_iqd,surge_multiplier,surge_reason,cash_rounding_step_iqd')
    .eq('id', serviceAreaId)
    .maybeSingle();
  serviceArea = saFull ?? null;

  // Pricing config: service-area override if present, else latest active.
  let pricing: any = null;
  if (serviceArea?.pricing_config_id) {
    const { data } = await supabase
      .from('pricing_configs')
      .select(
        'id,name,version,effective_from,effective_to,currency,base_fare_iqd,per_km_iqd,per_min_iqd,minimum_fare_iqd,max_surge_multiplier',
      )
      .eq('id', serviceArea.pricing_config_id)
      .maybeSingle();
    pricing = data;
  }
  if (!pricing) {
    const { data } = await supabase
      .from('pricing_configs')
      .select(
        'id,name,version,effective_from,effective_to,currency,base_fare_iqd,per_km_iqd,per_min_iqd,minimum_fare_iqd,max_surge_multiplier',
      )
      .eq('active', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    pricing = data;
  }
  if (!pricing) {
    throw new FareEngineError('Pricing is not configured', 500, 'PRICING_NOT_CONFIGURED');
  }

  // Product multiplier.
  const { data: prod } = await supabase.from('ride_products').select('code,price_multiplier').eq('code', input.product_code).maybeSingle();
  const productMult = Number(prod?.price_multiplier ?? 1);

  // Fare computation (baseline; ML multiplier comes later).
  const distanceKm = Math.max(0, route.distance / 1000);
  const durationMin = Math.max(0, route.duration / 60);

  const baseFare = Math.max(
    Number(pricing.base_fare_iqd ?? 0),
    serviceArea?.min_base_fare_iqd != null ? Number(serviceArea.min_base_fare_iqd) : 0,
  );

  const perKm = Number(pricing.per_km_iqd ?? 0);
  const perMin = Number(pricing.per_min_iqd ?? 0);
  const minFare = Number(pricing.minimum_fare_iqd ?? 0);

  const distanceFare = ceilInt(distanceKm * perKm);
  const timeFare = ceilInt(durationMin * perMin);
  const basePlus = baseFare + distanceFare + timeFare;
  const subtotal = Math.max(basePlus, minFare);

  const surgeRaw = Math.max(1, Number(serviceArea?.surge_multiplier ?? 1));
  const surgeCap = Math.max(1, Number(pricing.max_surge_multiplier ?? 1.5));
  const surgeApplied = Math.min(surgeRaw, surgeCap);

  const totalRaw = ceilInt(subtotal * productMult * surgeApplied);

  const roundingStep = Number(serviceArea?.cash_rounding_step_iqd ?? 250);
  const totalRounded = roundToStep(totalRaw, roundingStep, 'nearest');

  const pricingSnapshot = {
    pricing_config_id: pricing?.id ?? null,
    pricing: pricing
      ? {
          id: pricing.id,
          currency: pricing.currency,
          base_fare_iqd: pricing.base_fare_iqd,
          per_km_iqd: pricing.per_km_iqd,
          per_min_iqd: pricing.per_min_iqd,
          minimum_fare_iqd: pricing.minimum_fare_iqd,
          max_surge_multiplier: pricing.max_surge_multiplier,
          name: pricing.name ?? null,
          version: pricing.version ?? null,
          effective_from: pricing.effective_from ?? null,
          effective_to: pricing.effective_to ?? null,
        }
      : null,
    service_area: serviceArea
      ? {
          id: serviceArea.id,
          name: serviceArea.name,
          governorate: serviceArea.governorate ?? null,
          pricing_config_id: serviceArea.pricing_config_id ?? null,
          min_base_fare_iqd: serviceArea.min_base_fare_iqd ?? null,
          surge_multiplier: serviceArea.surge_multiplier ?? null,
          surge_reason: serviceArea.surge_reason ?? null,
          cash_rounding_step_iqd: serviceArea.cash_rounding_step_iqd ?? null,
        }
      : null,
    ride_product: {
      code: input.product_code,
      price_multiplier: productMult,
    },
    route: {
      provider: 'osrm',
      profile: 'driving',
      fetched_at: routeFetchedAt,
    },
    weather,
  } as Record<string, unknown>;

  const quote = {
    currency: 'IQD',
    service_area_id: serviceArea?.id ?? null,
    product_code: input.product_code,

    // Route-based basis
    distance_km: distanceKm,
    duration_min: durationMin,

    base_fare_iqd: baseFare,
    distance_fare_iqd: distanceFare,
    time_fare_iqd: timeFare,
    minimum_fare_iqd: minFare,
    subtotal_iqd: subtotal,

    product_multiplier: productMult,
    surge_multiplier_raw: surgeRaw,
    max_surge_multiplier: surgeCap,
    surge_multiplier_applied: surgeApplied,
    surge_reason: serviceArea?.surge_reason ?? null,

    rounding_step_iqd: roundingStep,
    total_iqd_raw: totalRaw,
    total_iqd: totalRounded,
  } as Record<string, unknown>;

  const context = normalizeContext(input, { governorate: serviceArea?.governorate ?? null, name: serviceArea?.name ?? null });

  const { data: inserted, error: insErr } = await supabase
    .from('fare_quotes')
    .insert({
      rider_id: riderId,
      service_area_id: serviceArea?.id ?? null,
      product_code: input.product_code,
      pickup_lat: input.pickup_lat,
      pickup_lng: input.pickup_lng,
      dropoff_lat: input.dropoff_lat,
      dropoff_lng: input.dropoff_lng,
      route_distance_m: Math.trunc(route.distance),
      route_duration_s: Math.trunc(route.duration),
      weather: weather ?? {},
      context,
      breakdown: quote,
      total_iqd: totalRounded,
      currency: 'IQD',
      engine: engineName,
      pricing_config_id: pricing?.id ?? null,
      pricing_snapshot: pricingSnapshot,
      cash_rounding_step_iqd: roundingStep,
      service_area_name: serviceArea?.name ?? null,
      service_area_governorate: serviceArea?.governorate ?? null,
      route_provider: 'osrm',
      route_profile: 'driving',
      route_fetched_at: routeFetchedAt,
    })
    .select('id')
    .maybeSingle();

  if (insErr) {
    ctx?.warn('fare_quotes.insert_failed', { error: insErr.message });
    return {
      quote_id: null,
      quote,
      route,
      weather,
      stored: false,
      service_area_id: serviceArea?.id ?? null,
      pricing_config_id: pricing?.id ?? null,
      cash_rounding_step_iqd: roundingStep,
    };
  }

  return {
    quote_id: inserted?.id ?? null,
    quote,
    route,
    weather,
    stored: true,
    service_area_id: serviceArea?.id ?? null,
    pricing_config_id: pricing?.id ?? null,
    cash_rounding_step_iqd: roundingStep,
  };
}
