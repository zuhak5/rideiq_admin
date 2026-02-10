import { createServiceClient, requireUser } from '../_shared/supabase.ts';
import { errorJson, json } from '../_shared/json.ts';
import { withRequestContext } from '../_shared/requestContext.ts';

/**
 * Hotspot Guidance
 *
 * Returns demand hotspots and earnings forecasts for drivers.
 */

Deno.serve((req) => withRequestContext('hotspot-guidance', req, async (ctx) => {

    if (req.method !== 'GET') {
        return errorJson('Method not allowed', 405, 'METHOD_NOT_ALLOWED', undefined, ctx.headers);
    }

    const { user, error: authError } = await requireUser(req, ctx);
    if (!user) {
        return errorJson(String(authError ?? 'Unauthorized'), 401, 'UNAUTHORIZED', undefined, ctx.headers);
    }

    const url = new URL(req.url);
    const lat = parseFloat(url.searchParams.get('lat') ?? '');
    const lng = parseFloat(url.searchParams.get('lng') ?? '');
    const radiusKm = parseInt(url.searchParams.get('radius_km') ?? '10');

    if (isNaN(lat) || isNaN(lng)) {
        return errorJson('lat and lng query parameters required', 400, 'VALIDATION_ERROR', undefined, ctx.headers);
    }

    const service = createServiceClient();

    // Get nearby hotspots
    const { data: hotspots, error: hotspotsError } = await service.rpc('get_nearby_hotspots', {
        p_lat: lat,
        p_lng: lng,
        p_radius_km: radiusKm,
    });

    if (hotspotsError) {
        return errorJson(hotspotsError.message, 400, 'HOTSPOTS_ERROR', undefined, ctx.headers);
    }

    // Get today's forecast
    const { data: forecast, error: forecastError } = await service.rpc('get_today_forecast', {
        p_zone_id: null,  // all zones
    });

    if (forecastError) {
        return errorJson(forecastError.message, 400, 'FORECAST_ERROR', undefined, ctx.headers);
    }

    // Get driver's active shift for context
    const { data: activeShift } = await service.rpc('get_active_shift', {
        p_driver_id: user.id,
    });

    return json({
        hotspots: hotspots ?? [],
        forecast: forecast ?? [],
        active_shift: activeShift?.[0] ?? null,
        timestamp: new Date().toISOString(),
    }, 200, ctx.headers);
}));
