import { errorJson, json } from '../_shared/json.ts';
import { consumeRateLimit, getClientIp } from '../_shared/rateLimit.ts';
import { createUserClient, requireUser } from '../_shared/supabase.ts';
import { withRequestContext } from '../_shared/requestContext.ts';

type ValidVehicleType = 'car_private' | 'car_taxi' | 'motorcycle' | 'cargo';

const VALID_VEHICLE_TYPES = new Set<ValidVehicleType>(['car_private', 'car_taxi', 'motorcycle', 'cargo']);

function isFiniteNumber(x: unknown): x is number {
    return typeof x === 'number' && Number.isFinite(x);
}

function isValidVehicleType(x: unknown): x is ValidVehicleType {
    return typeof x === 'string' && (VALID_VEHICLE_TYPES as Set<string>).has(x);
}

type Body = {
    lat: number;
    lng: number;
    accuracy_m?: number;
    heading?: number;
    speed_mps?: number;
    vehicle_type: ValidVehicleType;
};

Deno.serve((req) => withRequestContext('driver-location-update', req, async (ctx) => {

    try {
        if (req.method !== 'POST') return errorJson('Method not allowed', 405);

        const { user, error: authErr } = await requireUser(req, ctx);
        if (authErr || !user) return errorJson('Unauthorized', 401, 'UNAUTHORIZED');

        const ip = getClientIp(req);

        // Rate Limit: 1 update per 3 seconds (approx 20 per minute)
        // This blocks DDOS attacks on the location table.
        const rl = await consumeRateLimit({
            key: `loc_up:${user.id}:${ip ?? 'noip'}`,
            windowSeconds: 60,
            limit: 20,
        });

        if (!rl.allowed) {
            // Just silently drop excess updates or return 429. 
            // For location tracking, 429 is fine as the client will just retry or send the next point later.
            return errorJson('Rate limit exceeded', 429, 'RATE_LIMIT');
        }

        const body = (await req.json().catch(() => ({}))) as Partial<Body>;
        const { lat, lng, accuracy_m, heading, speed_mps, vehicle_type } = body;

        if (!isFiniteNumber(lat) || !isFiniteNumber(lng)) {
            return errorJson('Invalid coordinates', 400, 'BAD_REQUEST');
        }
        if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
            return errorJson('Invalid coordinates', 400, 'BAD_REQUEST');
        }
        if (!isValidVehicleType(vehicle_type)) {
            return errorJson('Invalid vehicle_type', 400, 'BAD_REQUEST');
        }

        // Use the per-request (user-scoped) client so auth.uid()-bound RPC can enforce identity.
        const supabase = createUserClient(req);

        const params: Record<string, unknown> = {
            p_lat: lat,
            p_lng: lng,
            p_vehicle_type: vehicle_type,
        };
        if (isFiniteNumber(accuracy_m)) params.p_accuracy_m = accuracy_m;
        if (isFiniteNumber(heading)) params.p_heading = heading;
        if (isFiniteNumber(speed_mps)) params.p_speed_mps = speed_mps;

        const { error: rpcErr } = await supabase.rpc('driver_location_upsert_user_v1', params);

        if (rpcErr) {
            const rawMessage = rpcErr.message ?? 'Unknown error';
            const normalized = rawMessage.replace(/^RPC error:\s*/i, '').trim();

            if (normalized === 'unauthorized') return errorJson('Unauthorized', 401, 'UNAUTHORIZED');
            if (normalized === 'not_a_driver') return errorJson('Only drivers can update driver location.', 403, 'FORBIDDEN');
            if (normalized === 'invalid_coordinates') return errorJson('Invalid coordinates', 400, 'BAD_REQUEST');
            if (normalized === 'invalid_vehicle_type') return errorJson('Invalid vehicle_type', 400, 'BAD_REQUEST');

            ctx.log('RPC Error', { error: rpcErr });
            return errorJson('Database error', 500, 'DB_ERROR');
        }

        return json({ ok: true });

    } catch (e) {
        ctx.log('Unhandled error', { error: e instanceof Error ? { message: e.message, stack: e.stack } : e });
        return errorJson('Internal error', 500, 'INTERNAL_ERROR');
    }
}));
