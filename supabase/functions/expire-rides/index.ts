import { createServiceClient } from '../_shared/supabase.ts';
import { errorJson, json } from '../_shared/json.ts';
import { logAppEvent } from '../_shared/log.ts';
import { requireCronSecret } from '../_shared/cronAuth.ts';
import { withRequestContext } from '../_shared/requestContext.ts';


// System actor used for automatic state transitions.
const SYSTEM_ACTOR_ID = '00000000-0000-0000-0000-000000000000';

function clampInt(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.floor(v)));
}

function parseBool(v: string | null) {
  if (!v) return false;
  const s = v.trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'y' || s === 'on';
}

Deno.serve((req) =>
  withRequestContext('expire-rides', req, async (_ctx) => {

  if (req.method !== 'POST') {
    return errorJson('Method not allowed', 405);
  }

  // Cron-protected endpoint
  const cronAuth = requireCronSecret(req);
  if (cronAuth) return cronAuth;

  try {
    const url = new URL(req.url);

    // Safety: allow running in read-only mode.
    const dryRun = parseBool(url.searchParams.get('dry_run')) || parseBool(req.headers.get('x-dry-run'));

    // Defaults: cancel rides that are stuck
    // - assigned > 15 min
    // - arrived > 60 min
    const assignedAfterSeconds = clampInt(Number(url.searchParams.get('assigned_after_seconds') ?? '900'), 60, 24 * 3600);
    const arrivedAfterSeconds = clampInt(Number(url.searchParams.get('arrived_after_seconds') ?? '3600'), 60, 7 * 24 * 3600);
    const limit = clampInt(Number(url.searchParams.get('limit') ?? '200'), 1, 500);

    // Mark drivers offline if they haven't sent a location update recently.
    // This keeps the 'available' pool honest and reduces wasted matching.
    const staleDriverAfterSeconds = clampInt(
      Number(url.searchParams.get('stale_driver_after_seconds') ?? '120'),
      30,
      24 * 3600,
    );
    const staleDriverLimit = clampInt(
      Number(url.searchParams.get('stale_driver_limit') ?? String(limit)),
      1,
      500,
    );

    const service = createServiceClient();

    const cutoffAssigned = new Date(Date.now() - assignedAfterSeconds * 1000).toISOString();
    const cutoffArrived = new Date(Date.now() - arrivedAfterSeconds * 1000).toISOString();

    // Query stuck rides (best effort; we'll re-check version at RPC time).
    const { data: assignedRides, error: q1Err } = await service
      .from('rides')
      .select('id,status,version,updated_at')
      .eq('status', 'assigned')
      .lt('updated_at', cutoffAssigned)
      .order('updated_at', { ascending: true })
      .limit(limit);

    if (q1Err) return errorJson(q1Err.message ?? 'Query failed', 500, 'QUERY_FAILED');

    const remaining = Math.max(0, limit - (assignedRides?.length ?? 0));

    const { data: arrivedRides, error: q2Err } = remaining > 0
      ? await service
        .from('rides')
        .select('id,status,version,updated_at')
        .eq('status', 'arrived')
        .lt('updated_at', cutoffArrived)
        .order('updated_at', { ascending: true })
        .limit(remaining)
      : { data: [], error: null };

    if (q2Err) return errorJson(q2Err.message ?? 'Query failed', 500, 'QUERY_FAILED');

    const rides = [...(assignedRides ?? []), ...(arrivedRides ?? [])] as Array<{ id: string; status: string; version: number; updated_at: string }>;

    const results: Array<Record<string, unknown>> = [];

    for (const r of rides) {
      if (dryRun) {
        results.push({ ride_id: r.id, from: r.status, action: 'would_cancel', updated_at: r.updated_at });
        continue;
      }

      const { error: upErr } = await service.rpc('transition_ride_v2', {
        p_ride_id: r.id,
        p_to_status: 'canceled',
        p_actor_id: SYSTEM_ACTOR_ID,
        p_actor_type: 'system',
        p_expected_version: r.version,
      });

      if (upErr) {
        results.push({ ride_id: r.id, from: r.status, action: 'skip', error: upErr.message });
        continue;
      }

      results.push({ ride_id: r.id, from: r.status, action: 'canceled' });
    }


    // NEW: Expire ride requests stuck in 'matched' past match_deadline (LOGIC-02 fix)
    const expireMatchedLimit = clampInt(
      Number(url.searchParams.get('expire_matched_limit') ?? String(limit)),
      1,
      500,
    );
    let expiredMatchedRequests = 0;
    if (!dryRun) {
      const { data: expiredCount, error: expErr } = await service.rpc('expire_matched_ride_requests_v1', {
        p_limit: expireMatchedLimit,
      });

      if (expErr) {
        results.push({ action: 'expire_matched_ride_requests', status: 'error', error: expErr.message });
      } else {
        expiredMatchedRequests = Number(expiredCount ?? 0) || 0;
        results.push({ action: 'expire_matched_ride_requests', status: 'ok', expired: expiredMatchedRequests });
      }
    } else {
      results.push({ action: 'expire_matched_ride_requests', status: 'dry_run', limit: expireMatchedLimit });
    }

    let staleDriversMarkedOffline = 0;
    if (!dryRun) {
      const { data: markedCount, error: staleErr } = await service.rpc('admin_mark_stale_drivers_offline', {
        p_stale_after_seconds: staleDriverAfterSeconds,
        p_limit: staleDriverLimit,
      });

      if (staleErr) {
        results.push({ action: 'mark_stale_drivers_offline', status: 'error', error: staleErr.message });
      } else {
        staleDriversMarkedOffline = Number(markedCount ?? 0) || 0;
        results.push({ action: 'mark_stale_drivers_offline', status: 'ok', marked: staleDriversMarkedOffline });
      }
    } else {
      results.push({ action: 'mark_stale_drivers_offline', status: 'dry_run', stale_after_seconds: staleDriverAfterSeconds, limit: staleDriverLimit });
    }

    // NEW: Release drivers stuck in 'reserved' status (LOGIC-01 fix)
    const reservedStaleSeconds = clampInt(
      Number(url.searchParams.get('reserved_stale_seconds') ?? '120'),
      30,
      600,
    );
    let stuckReservedReleased = 0;
    if (!dryRun) {
      const { data: releasedCount, error: reservedErr } = await service.rpc('admin_release_stuck_reserved_drivers', {
        p_stale_after_seconds: reservedStaleSeconds,
        p_limit: staleDriverLimit,
      });

      if (reservedErr) {
        results.push({ action: 'release_stuck_reserved_drivers', status: 'error', error: reservedErr.message });
      } else {
        stuckReservedReleased = Number(releasedCount ?? 0) || 0;
        results.push({ action: 'release_stuck_reserved_drivers', status: 'ok', released: stuckReservedReleased });
      }
    } else {
      results.push({ action: 'release_stuck_reserved_drivers', status: 'dry_run', stale_after_seconds: reservedStaleSeconds, limit: staleDriverLimit });
    }


    await logAppEvent({
      event_type: 'expire_rides',
      actor_type: 'system',
      payload: {
        dry_run: dryRun,
        assigned_after_seconds: assignedAfterSeconds,
        arrived_after_seconds: arrivedAfterSeconds,
        stale_driver_after_seconds: staleDriverAfterSeconds,
        stale_driver_limit: staleDriverLimit,
        stale_drivers_marked_offline: staleDriversMarkedOffline,
        expired_matched_requests: expiredMatchedRequests,
        stuck_reserved_released: stuckReservedReleased,
        processed: results.length,
        results,
      },

    });

    return json({ ok: true, dry_run: dryRun, processed: results.length, results });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await logAppEvent({ event_type: 'expire_rides_error', actor_type: 'system', payload: { message: msg } });
    return errorJson(msg, 500, 'INTERNAL');
  }
  }),
);
