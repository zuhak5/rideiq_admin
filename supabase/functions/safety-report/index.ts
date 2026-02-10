import { createServiceClient, requireUser } from '../_shared/supabase.ts';
import { errorJson, json } from '../_shared/json.ts';
import { withRequestContext } from '../_shared/requestContext.ts';
import { logAppEvent } from '../_shared/log.ts';
import { buildRateLimitHeaders, consumeRateLimit, getClientIp } from '../_shared/rateLimit.ts';

type SafetyReportBody = {
    reported_user_id: string;
    ride_id?: string;
    report_type: 'mismatch' | 'harassment' | 'safety_concern' | 'other';
    description?: string;
    evidence_urls?: string[];
};

Deno.serve((req) => withRequestContext('safety-report', req, async (ctx) => {

    if (req.method !== 'POST') {
        return errorJson('Method not allowed', 405, 'METHOD_NOT_ALLOWED', undefined, ctx.headers);
    }

    const { user, error: authError } = await requireUser(req, ctx);
    if (!user) {
        return errorJson(String(authError ?? 'Unauthorized'), 401, 'UNAUTHORIZED', undefined, ctx.headers);
    }

    // Rate limit safety reports to prevent abuse
    const ip = getClientIp(req);
    const rl = await consumeRateLimit({
        key: `safety-report:${user.id}:${ip ?? 'noip'}`,
        windowSeconds: 3600,  // 1 hour window
        limit: 10,  // max 10 reports per hour
    });

    if (!rl.allowed) {
        return json(
            { error: 'Rate limit exceeded. Please try again later.', code: 'RATE_LIMITED' },
            429,
            {
                ...ctx.headers,
                ...buildRateLimitHeaders({ limit: 10, remaining: rl.remaining, resetAt: rl.resetAt }),
            },
        );
    }

    const body: SafetyReportBody = await req.json().catch(() => ({} as SafetyReportBody));

    if (!body.reported_user_id) {
        return errorJson('reported_user_id is required', 400, 'VALIDATION_ERROR', undefined, ctx.headers);
    }
    if (!body.report_type || !['mismatch', 'harassment', 'safety_concern', 'other'].includes(body.report_type)) {
        return errorJson('report_type must be one of: mismatch, harassment, safety_concern, other', 400, 'VALIDATION_ERROR', undefined, ctx.headers);
    }

    // Prevent self-reporting
    if (body.reported_user_id === user.id) {
        return errorJson('Cannot report yourself', 400, 'VALIDATION_ERROR', undefined, ctx.headers);
    }

    const service = createServiceClient();

    const { data, error } = await service
        .from('safety_mismatch_reports')
        .insert({
            reporter_id: user.id,
            reported_user_id: body.reported_user_id,
            ride_id: body.ride_id ?? null,
            report_type: body.report_type,
            description: body.description ?? null,
            evidence_urls: body.evidence_urls ?? null,
        })
        .select()
        .single();

    if (error) {
        await logAppEvent({
            event_type: 'safety_report_error',
            actor_id: user.id,
            actor_type: 'rider',
            payload: { reported_user_id: body.reported_user_id, error: error.message },
        });
        return errorJson(error.message, 400, 'REPORT_ERROR', undefined, ctx.headers);
    }

    await logAppEvent({
        event_type: 'safety_report_created',
        actor_id: user.id,
        actor_type: 'rider',
        payload: {
            report_id: data.id,
            reported_user_id: body.reported_user_id,
            report_type: body.report_type,
            ride_id: body.ride_id,
        },
    });

    return json(
        { report: { id: data.id, created_at: data.created_at } },
        201,
        { ...ctx.headers, ...buildRateLimitHeaders({ limit: 10, remaining: rl.remaining, resetAt: rl.resetAt }) },
    );
}));
