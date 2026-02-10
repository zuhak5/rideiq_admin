import { createServiceClient, requireUser } from '../_shared/supabase.ts';
import { errorJson, json } from '../_shared/json.ts';
import { withRequestContext } from '../_shared/requestContext.ts';
import { logAppEvent } from '../_shared/log.ts';
import { buildRateLimitHeaders, consumeRateLimit, getClientIp } from '../_shared/rateLimit.ts';
import { envTrim } from '../_shared/config.ts';
import { callOpenRouterResponses, extractOutputText, type ResponsesInputItem } from '../_shared/openrouter.ts';

/**
 * AI Earnings Coach
 *
 * Conversational AI assistant for driver earnings optimization.
 */

type CoachRequest = {
    session_id?: string;
    message: string;
};

function detectPreferredLanguage(msg: string): 'ar' | 'en' {
    return /\p{Script=Arabic}/u.test(msg) ? 'ar' : 'en';
}

function buildAiInput(params: {
    language: 'ar' | 'en';
    message: string;
    history: any[];
    earningsContext: Record<string, unknown>;
    hotspots: any[];
    forecasts: any[];
}): ResponsesInputItem[] {
    const system = params.language === 'ar'
        ? 'أنت مدرّب أرباح للسائق داخل RideIQ. قدّم نصائح عملية قابلة للتنفيذ لزيادة الدخل وتقليل الوقت الضائع. لا تخترع أرقاماً دقيقة؛ استخدم البيانات المرفقة (إن وجدت) أو قدّم إرشادات عامة مع أسئلة توضيحية قصيرة.'
        : 'You are an in-app RideIQ earnings coach for drivers. Give practical, actionable advice to increase earnings and reduce idle time. Do not invent precise numbers; use the provided data if present, or give general guidance and ask short clarifying questions.';

    const items: ResponsesInputItem[] = [
        { type: 'message', role: 'system', content: [{ type: 'input_text', text: system }] },
        { type: 'message', role: 'system', content: [{ type: 'input_text', text: `Earnings context (JSON): ${JSON.stringify(params.earningsContext ?? {})}` }] },
        { type: 'message', role: 'system', content: [{ type: 'input_text', text: `Active hotspots (JSON): ${JSON.stringify(params.hotspots ?? [])}` }] },
        { type: 'message', role: 'system', content: [{ type: 'input_text', text: `Earnings forecasts (JSON): ${JSON.stringify(params.forecasts ?? [])}` }] },
    ];

    const turns = Array.isArray(params.history) ? params.history.slice(-12) : [];
    for (const t of turns) {
        const role = t?.role === 'assistant' ? 'assistant' : 'user';
        const text = typeof t?.content === 'string' ? t.content : '';
        if (!text) continue;
        items.push({ type: 'message', role, content: [{ type: 'input_text', text }] });
    }

    items.push({ type: 'message', role: 'user', content: [{ type: 'input_text', text: params.message }] });
    return items;
}

Deno.serve((req) => withRequestContext('earnings-coach', req, async (ctx) => {

    if (req.method !== 'POST') {
        return errorJson('Method not allowed', 405, 'METHOD_NOT_ALLOWED', undefined, ctx.headers);
    }

    const { user, error: authError } = await requireUser(req, ctx);
    if (!user) {
        return errorJson(String(authError ?? 'Unauthorized'), 401, 'UNAUTHORIZED', undefined, ctx.headers);
    }

    // Rate limit AI requests
    const ip = getClientIp(req);
    const rl = await consumeRateLimit({
        key: `earnings-coach:${user.id}:${ip ?? 'noip'}`,
        windowSeconds: 60,
        limit: 15,
    });

    if (!rl.allowed) {
        return json(
            { error: 'Rate limit exceeded', code: 'RATE_LIMITED' },
            429,
            { ...ctx.headers, ...buildRateLimitHeaders({ limit: 15, remaining: rl.remaining, resetAt: rl.resetAt }) },
        );
    }

    const body: CoachRequest = await req.json().catch(() => ({} as CoachRequest));

    if (!body.message) {
        return errorJson('message is required', 400, 'VALIDATION_ERROR', undefined, ctx.headers);
    }

    const service = createServiceClient();
    let sessionId = body.session_id;

    // Get or create session
    if (!sessionId) {
        // Gather context for the coach
        const { data: recentEarnings } = await service
            .from('driver_stats')
            .select('total_earnings_iqd, total_trips, avg_rating')
            .eq('driver_id', user.id)
            .single();

        const earningsContext = recentEarnings ?? { total_earnings_iqd: 0, total_trips: 0, avg_rating: null };

        const { data: newSession, error: createError } = await service
            .from('earnings_coach_sessions')
            .insert({
                driver_id: user.id,
                status: 'active',
                history: [],
                earnings_context: earningsContext,
            })
            .select()
            .single();

        if (createError) {
            return errorJson(createError.message, 400, 'SESSION_CREATE_ERROR', undefined, ctx.headers);
        }
        sessionId = newSession.id;
    }

    // Get session
    const { data: session, error: sessionError } = await service
        .from('earnings_coach_sessions')
        .select('*')
        .eq('id', sessionId)
        .eq('driver_id', user.id)
        .single();

    if (sessionError || !session) {
        return errorJson('Session not found', 404, 'SESSION_NOT_FOUND', undefined, ctx.headers);
    }

    // AI response (OpenRouter). If not configured or provider fails, fall back to a deterministic heuristic.
    const language = detectPreferredLanguage(body.message);
    const model = envTrim('OPENROUTER_EARNINGS_COACH_MODEL') || envTrim('OPENROUTER_MODEL') || 'openai/gpt-4o-mini';

    // Pull lightweight live context that the coach can reference.
    const nowIso = new Date().toISOString();
    const utcNow = new Date();
    const todayUtc = utcNow.toISOString().slice(0, 10);
    const hourUtc = utcNow.getUTCHours();

    const { data: hotspots } = await service
        .from('demand_hotspots')
        .select('zone_id, zone_name, demand_level, surge_multiplier, expected_wait_minutes, valid_until')
        .gt('valid_until', nowIso)
        .order('demand_level', { ascending: false })
        .order('valid_until', { ascending: true })
        .limit(5);

    const { data: forecasts } = await service
        .from('earnings_forecasts')
        .select('forecast_date, hour_of_day, zone_id, expected_earnings_iqd, expected_trips, confidence_pct')
        .eq('forecast_date', todayUtc)
        .gte('hour_of_day', hourUtc)
        .lte('hour_of_day', Math.min(23, hourUtc + 3))
        .order('hour_of_day', { ascending: true })
        .limit(15);

    let aiReply = language === 'ar'
        ? 'تم. ما هي منطقتك الآن وما هو هدفك اليوم (عدد الرحلات أو مبلغ IQD)؟'
        : 'Got it. Where are you driving right now, and what’s your target for today (trips or IQD)?';

    try {
        const input = buildAiInput({
            language,
            message: body.message,
            history: (session.history as unknown[]) ?? [],
            earningsContext: (session.earnings_context ?? {}) as Record<string, unknown>,
            hotspots: (hotspots ?? []) as any[],
            forecasts: (forecasts ?? []) as any[],
        });

        const resp = await callOpenRouterResponses({
            model,
            input,
            max_output_tokens: 400,
            temperature: 0.25,
            user: user.id,
            session_id: sessionId,
        });

        const out = extractOutputText(resp).trim();
        if (out) aiReply = out;
    } catch (e) {
        // Keep fallback reply.
        console.warn('[earnings-coach] AI call failed:', (e as any)?.message ?? e);
    }

    // Provide lightweight structured tips even when the reply is freeform.
    const tips: Array<{ type: string; title: string; message: string }> = [];
    const topHotspot = (hotspots ?? [])[0] as any;
    if (topHotspot?.zone_name) {
        tips.push({
            type: 'hotspot',
            title: language === 'ar' ? 'منطقة طلب مرتفع' : 'High-demand zone',
            message:
                language === 'ar'
                    ? `${topHotspot.zone_name}: مستوى الطلب ${topHotspot.demand_level}/5` + (topHotspot.surge_multiplier ? ` (سيرج ×${topHotspot.surge_multiplier})` : '')
                    : `${topHotspot.zone_name}: demand ${topHotspot.demand_level}/5` + (topHotspot.surge_multiplier ? ` (surge ×${topHotspot.surge_multiplier})` : ''),
        });
    }
    const nextForecast = (forecasts ?? [])[0] as any;
    if (nextForecast?.expected_earnings_iqd != null) {
        tips.push({
            type: 'forecast',
            title: language === 'ar' ? 'توقعات قريبة' : 'Near-term forecast',
            message:
                language === 'ar'
                    ? `الساعة ${nextForecast.hour_of_day}: ${nextForecast.expected_earnings_iqd} IQD متوقعة (${nextForecast.expected_trips} رحلات)`
                    : `Hour ${nextForecast.hour_of_day}: ~${nextForecast.expected_earnings_iqd} IQD (${nextForecast.expected_trips} trips)`,
        });
    }

    // Update session history
    const newHistory = [
        ...(session.history as unknown[]),
        { role: 'user', content: body.message, timestamp: new Date().toISOString() },
        { role: 'assistant', content: aiReply, timestamp: new Date().toISOString() },
    ].slice(-20);

    await service
        .from('earnings_coach_sessions')
        .update({
            history: newHistory,
            updated_at: new Date().toISOString(),
        })
        .eq('id', sessionId);

    await logAppEvent({
        event_type: 'earnings_coach_message',
        actor_id: user.id,
        actor_type: 'driver',
        payload: { session_id: sessionId },
    });

    return json({
        session_id: sessionId,
        reply: aiReply,
        tips,
    }, 200, {
        ...ctx.headers,
        ...buildRateLimitHeaders({ limit: 15, remaining: rl.remaining, resetAt: rl.resetAt }),
    });
}));
