import { createServiceClient } from '../_shared/supabase.ts';
import { errorJson, json } from '../_shared/json.ts';
import { withRequestContext } from '../_shared/requestContext.ts';
import { requireCronSecret } from '../_shared/cronAuth.ts';
import { logAppEvent } from '../_shared/log.ts';
import { envTrim } from '../_shared/config.ts';

/**
 * Trip Broadcast Runner
 *
 * This cron-protected endpoint claims pending trip status transitions
 * and sends push updates to registered live activity tokens.
 *
 * Uses SKIP LOCKED pattern to safely handle concurrent invocations.
 */

type PushPayload = {
    trip_id: string;
    status: string;
    eta_minutes?: number;
    distance_remaining_m?: number;
};

async function sendApnsPush(_token: string, _payload: PushPayload): Promise<boolean> {
    // NOTE: Push delivery is infrastructure-dependent. Until APNS credentials and
    // an implementation are provided, we do not claim delivery success.
    // Set PUSH_NOTIFICATIONS_ENABLED=true only after implementing the provider calls.
    const enabled = envTrim('PUSH_NOTIFICATIONS_ENABLED').toLowerCase() === 'true';
    if (!enabled) {
        console.log('APNS push skipped (disabled).', { token_prefix: _token.slice(0, 12), payload: _payload });
        return false;
    }
    console.log('APNS push not implemented but enabled. Refusing to claim success.', { token_prefix: _token.slice(0, 12) });
    return false;
}

async function sendFcmPush(_token: string, _payload: PushPayload): Promise<boolean> {
    const enabled = envTrim('PUSH_NOTIFICATIONS_ENABLED').toLowerCase() === 'true';
    if (!enabled) {
        console.log('FCM push skipped (disabled).', { token_prefix: _token.slice(0, 12), payload: _payload });
        return false;
    }
    console.log('FCM push not implemented but enabled. Refusing to claim success.', { token_prefix: _token.slice(0, 12) });
    return false;
}

Deno.serve((req) => withRequestContext('trip-broadcast-runner', req, async (ctx) => {

    if (req.method !== 'POST') {
        return errorJson('Method not allowed', 405, 'METHOD_NOT_ALLOWED', undefined, ctx.headers);
    }

    // Require cron secret for this endpoint
    const cronError = requireCronSecret(req);
    if (cronError) {
        return cronError;
    }

    const service = createServiceClient();

    // Claim pending broadcasts using SKIP LOCKED
    const { data: transitions, error: claimError } = await service.rpc('trip_claim_pending_broadcasts', {
        p_limit: 100,
    });

    if (claimError) {
        await logAppEvent({
            event_type: 'trip_broadcast_claim_error',
            payload: { error: claimError.message },
        });
        return errorJson(claimError.message, 500, 'CLAIM_ERROR', undefined, ctx.headers);
    }

    if (!transitions || transitions.length === 0) {
        return json({ processed: 0, message: 'No pending broadcasts' }, 200, ctx.headers);
    }

    let successCount = 0;
    let failCount = 0;

    for (const transition of transitions) {
        // Get registered tokens for this trip
        const { data: tokens, error: tokenError } = await service.rpc('trip_live_activity_get_tokens', {
            p_trip_id: transition.trip_id,
        });

        if (tokenError || !tokens || tokens.length === 0) {
            continue;
        }

        const payload: PushPayload = {
            trip_id: transition.trip_id,
            status: transition.new_status,
            eta_minutes: transition.eta_minutes,
            distance_remaining_m: transition.distance_remaining_m,
        };

        for (const token of tokens) {
            try {
                const success = token.platform === 'ios'
                    ? await sendApnsPush(token.token, payload)
                    : await sendFcmPush(token.token, payload);

                if (success) {
                    // Record push
                    await service.rpc('trip_live_activity_record_push', {
                        p_activity_id: token.id,
                    });
                    successCount++;
                } else {
                    failCount++;
                }
            } catch (e) {
                console.error('Push failed:', e);
                failCount++;
            }
        }
    }

    await logAppEvent({
        event_type: 'trip_broadcast_runner_complete',
        payload: { transitions_processed: transitions.length, pushes_sent: successCount, pushes_failed: failCount },
    });

    return json({
        processed: transitions.length,
        pushes_sent: successCount,
        pushes_failed: failCount,
    }, 200, ctx.headers);
}));
