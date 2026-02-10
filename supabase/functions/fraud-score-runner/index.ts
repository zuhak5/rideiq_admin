import { withRequestContext } from '../_shared/requestContext.ts';
import { errorJson, json } from '../_shared/json.ts';

import { requireCronSecret } from '../_shared/cronAuth.ts';
import { createServiceClient } from '../_shared/supabase.ts';

/**
 * Fraud score runner (cron).
 *
 * Responsibilities:
 * - Expire enforcement actions whose expires_at has passed
 * - Generate anomaly candidates (route deviation, repeated short rides)
 * - Log events and open cases; apply conservative automatic actions
 *
 * Auth: verify_jwt=false + CRON_SECRET.
 */
Deno.serve((req) =>
  withRequestContext('fraud-score-runner', req, async (ctx) => {

    if (req.method !== 'POST') return errorJson('Method not allowed', 405, 'METHOD_NOT_ALLOWED', undefined, ctx.headers);

    const authRes = requireCronSecret(req);
    if (authRes) return authRes;

    const svc = createServiceClient();

    // 1) Expire actions
    const { data: expiredCount, error: expErr } = await svc.rpc('fraud_expire_actions');
    if (expErr) {
      ctx.error('fraud.expire_actions_failed', { err: expErr.message });
      return errorJson('Failed to expire actions', 500, 'DB_ERROR', { message: expErr.message }, ctx.headers);
    }

    // 2) Route deviation candidates (safety signal; no auto-block)
    const { data: route, error: routeErr } = await svc.rpc('fraud_find_route_deviation_candidates', {
      p_min_streak: 3,
      p_seen_since: '30 minutes',
    });

    if (routeErr) {
      ctx.warn('fraud.route_candidates_failed', { err: routeErr.message });
    }

    let routeLogged = 0;
    for (const r of Array.isArray(route) ? route.slice(0, 200) : []) {
      const ride_id = String((r as any).ride_id ?? '');
      const driver_id = String((r as any).driver_id ?? '');
      const rider_id = String((r as any).rider_id ?? '');
      const streak = Number((r as any).distance_increase_streak ?? 0);
      const last_seen_at = String((r as any).last_seen_at ?? '');

      if (!ride_id || !driver_id || !rider_id) continue;

      const dedupe = `route_dev:${ride_id}:${last_seen_at.slice(0, 16)}`;
      await svc.rpc('fraud_log_event', {
        p_reason: 'route_deviation_candidate',
        p_subject_kind: 'driver',
        p_subject_key: `driver:${driver_id}`,
        p_severity: 2,
        p_score: 10,
        p_dedupe_key: dedupe,
        p_ip_prefix: null,
        p_device_hash: null,
        p_metadata: { ride_id, rider_id, distance_increase_streak: streak, last_seen_at },
      });
      await svc.rpc('fraud_open_case', {
        p_reason: 'route_deviation_review',
        p_subject_kind: 'driver',
        p_subject_key: `driver:${driver_id}`,
        p_severity: 2,
        p_metadata: { ride_id, rider_id, distance_increase_streak: streak, last_seen_at },
        p_opened_by: 'system:fraud-score-runner',
      });

      routeLogged += 1;
    }

    // 3) Collusion candidates (repeated short rides)
    const { data: collusion, error: colErr } = await svc.rpc('fraud_find_collusion_candidates', {
      p_since: '7 days',
      p_min_count: 5,
      p_max_trip_distance_m: 2000,
    });

    if (colErr) {
      ctx.warn('fraud.collusion_candidates_failed', { err: colErr.message });
    }

    let collusionLogged = 0;
    let payoutsHeld = 0;

    for (const c of Array.isArray(collusion) ? collusion.slice(0, 200) : []) {
      const driver_id = String((c as any).driver_id ?? '');
      const rider_id = String((c as any).rider_id ?? '');
      const ride_count = Number((c as any).ride_count ?? 0);
      const last_ride_at = String((c as any).last_ride_at ?? '');

      if (!driver_id || !rider_id) continue;

      const dedupe = `collusion:${driver_id}:${rider_id}:${last_ride_at.slice(0, 10)}`;
      await svc.rpc('fraud_log_event', {
        p_reason: 'collusion_candidate',
        p_subject_kind: 'driver',
        p_subject_key: `driver:${driver_id}`,
        p_severity: 3,
        p_score: 40,
        p_dedupe_key: dedupe,
        p_ip_prefix: null,
        p_device_hash: null,
        p_metadata: { rider_id, ride_count, last_ride_at },
      });
      await svc.rpc('fraud_open_case', {
        p_reason: 'collusion_review',
        p_subject_kind: 'driver',
        p_subject_key: `driver:${driver_id}`,
        p_severity: 3,
        p_metadata: { rider_id, ride_count, last_ride_at },
        p_opened_by: 'system:fraud-score-runner',
      });

      // Conservative automatic action: hold driver payouts for 7 days (human can resolve earlier).
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      const { error: actErr } = await svc.rpc('fraud_enforce_action', {
        p_action_type: 'hold_driver_payouts',
        p_subject_kind: 'driver',
        p_subject_key: `driver:${driver_id}`,
        p_reason: 'collusion_candidate',
        p_severity: 3,
        p_expires_at: expiresAt,
        p_metadata: { rider_id, ride_count, last_ride_at },
      });
      if (!actErr) payoutsHeld += 1;

      collusionLogged += 1;
    }

    return json(
      {
        ok: true,
        expired_actions: expiredCount ?? 0,
        route_candidates_logged: routeLogged,
        collusion_candidates_logged: collusionLogged,
        payouts_held: payoutsHeld,
      },
      200,
      ctx.headers,
    );
  }),
);
