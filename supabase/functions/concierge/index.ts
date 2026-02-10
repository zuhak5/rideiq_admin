import { createServiceClient, requireUser } from '../_shared/supabase.ts';
import { errorJson, json } from '../_shared/json.ts';
import { withRequestContext } from '../_shared/requestContext.ts';
import { logAppEvent } from '../_shared/log.ts';
import { buildRateLimitHeaders, consumeRateLimit, getClientIp } from '../_shared/rateLimit.ts';
import { envTrim } from '../_shared/config.ts';
import { callOpenRouterResponses, extractOutputText, type ResponsesInputItem } from '../_shared/openrouter.ts';

/**
 * AI Food Concierge
 *
 * Entry point for conversational food ordering assistance.
 * Supports chat mode (voice handled by client with transcription).
 */

type ConciergeRequest = {
    session_id?: string;  // existing session or null for new
    message: string;
    preferences?: Record<string, unknown>;  // dietary, allergies, budget, etc.
};

type ConciergeResponse = {
    session_id: string;
    reply: string;
    suggestions?: Array<{
        item_id: string;
        name: string;
        description: string;
        price_iqd: number;
        reason: string;
    }>;
    actions?: Array<{
        type: 'add_to_cart' | 'view_menu' | 'change_restaurant';
        label: string;
        payload: Record<string, unknown>;
    }>;
};

function detectPreferredLanguage(msg: string): 'ar' | 'en' {
    // Very small heuristic: if the message contains Arabic script, respond in Arabic.
    return /\p{Script=Arabic}/u.test(msg) ? 'ar' : 'en';
}

function buildAiInput(params: {
    language: 'ar' | 'en';
    message: string;
    history: any[];
    preferences: Record<string, unknown>;
}): ResponsesInputItem[] {
    const system = params.language === 'ar'
        ? 'أنت مساعد محادثة داخل تطبيق RideIQ لمساعدة المستخدم في اختيار الطعام وإتمام الطلب. لا تخترع عناصر قائمة أو أسعاراً إذا لم تكن متاحة في البيانات. اسأل أسئلة توضيحية قصيرة عند الحاجة. اجعل الرد مختصراً ومباشراً.'
        : 'You are an in-app RideIQ assistant helping the user choose food and complete an order. Do not invent menu items or prices unless they are provided. Ask short clarifying questions when needed. Keep replies concise and action-oriented.';

    const items: ResponsesInputItem[] = [
        {
            type: 'message',
            role: 'system',
            content: [{ type: 'input_text', text: system }],
        },
        {
            type: 'message',
            role: 'system',
            content: [{ type: 'input_text', text: `User preferences (JSON): ${JSON.stringify(params.preferences ?? {})}` }],
        },
    ];

    const turns = Array.isArray(params.history) ? params.history.slice(-12) : [];
    for (const t of turns) {
        const role = t?.role === 'assistant' ? 'assistant' : 'user';
        const text = typeof t?.content === 'string' ? t.content : '';
        if (!text) continue;
        items.push({
            type: 'message',
            role,
            content: [{ type: 'input_text', text }],
        });
    }

    items.push({
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: params.message }],
    });

    return items;
}

Deno.serve((req) => withRequestContext('concierge', req, async (ctx) => {

    if (req.method !== 'POST') {
        return errorJson('Method not allowed', 405, 'METHOD_NOT_ALLOWED', undefined, ctx.headers);
    }

    const { user, error: authError } = await requireUser(req, ctx);
    if (!user) {
        return errorJson(String(authError ?? 'Unauthorized'), 401, 'UNAUTHORIZED', undefined, ctx.headers);
    }

    // Rate limit concierge requests (AI is expensive)
    const ip = getClientIp(req);
    const rl = await consumeRateLimit({
        key: `concierge:${user.id}:${ip ?? 'noip'}`,
        windowSeconds: 60,
        limit: 20,  // max 20 messages per minute
    });

    if (!rl.allowed) {
        return json(
            { error: 'Rate limit exceeded', code: 'RATE_LIMITED' },
            429,
            { ...ctx.headers, ...buildRateLimitHeaders({ limit: 20, remaining: rl.remaining, resetAt: rl.resetAt }) },
        );
    }

    const body: ConciergeRequest = await req.json().catch(() => ({} as ConciergeRequest));

    if (!body.message) {
        return errorJson('message is required', 400, 'VALIDATION_ERROR', undefined, ctx.headers);
    }

    const service = createServiceClient();
    let sessionId = body.session_id;

    // Get or create session
    if (!sessionId) {
        const { data: newSession, error: createError } = await service
            .from('concierge_sessions')
            .insert({
                user_id: user.id,
                mode: 'chat',
                preferences: body.preferences ?? {},
                history: [],
            })
            .select()
            .single();

        if (createError) {
            return errorJson(createError.message, 400, 'SESSION_CREATE_ERROR', undefined, ctx.headers);
        }
        sessionId = newSession.id;
    }
    if (!sessionId) {
        return errorJson('Session is required', 400, 'SESSION_REQUIRED', undefined, ctx.headers);
    }

    // Get session
    const { data: session, error: sessionError } = await service
        .from('concierge_sessions')
        .select('*')
        .eq('id', sessionId)
        .eq('user_id', user.id)
        .single();

    if (sessionError || !session) {
        return errorJson('Session not found', 404, 'SESSION_NOT_FOUND', undefined, ctx.headers);
    }

    if (session.status !== 'active') {
        return errorJson('Session is no longer active', 400, 'SESSION_EXPIRED', undefined, ctx.headers);
    }

    // AI response (OpenRouter). If not configured, return a deterministic, safe fallback.
    const language = detectPreferredLanguage(body.message);
    const model = envTrim('OPENROUTER_CONCIERGE_MODEL') || envTrim('OPENROUTER_MODEL') || 'openai/gpt-4o-mini';

    let aiReply = language === 'ar'
        ? 'تم. ما نوع الأكل الذي تفضّله (مثلاً شاورما/برغر/بيتزا)، وما هو الحدّ الأقصى للسعر؟'
        : 'Got it. What kind of food are you in the mood for (shawarma/burger/pizza), and what is your max budget?';

    try {
        const input = buildAiInput({
            language,
            message: body.message,
            history: (session.history as unknown[]) ?? [],
            preferences: (body.preferences ?? {}) as Record<string, unknown>,
        });

        const resp = await callOpenRouterResponses({
            model,
            input,
            max_output_tokens: 350,
            temperature: 0.3,
            user: user.id,
            session_id: sessionId,
        });

        const out = extractOutputText(resp).trim();
        if (out) aiReply = out;
    } catch (e) {
        // If AI is not configured or provider errors, keep a safe fallback.
        console.warn('[concierge] AI call failed:', (e as any)?.message ?? e);
    }

    // Update session history
    const newHistory = [
        ...(session.history as unknown[]),
        { role: 'user', content: body.message, timestamp: new Date().toISOString() },
        { role: 'assistant', content: aiReply, timestamp: new Date().toISOString() },
    ].slice(-20);  // keep last 20 turns

    await service
        .from('concierge_sessions')
        .update({
            history: newHistory,
            preferences: { ...session.preferences, ...body.preferences },
            updated_at: new Date().toISOString(),
        })
        .eq('id', sessionId);

    await logAppEvent({
        event_type: 'concierge_message',
        actor_id: user.id,
        actor_type: 'rider',
        payload: { session_id: sessionId },
    });

    const response: ConciergeResponse = {
        session_id: sessionId,
        reply: aiReply,
    };

    return json(response, 200, {
        ...ctx.headers,
        ...buildRateLimitHeaders({ limit: 20, remaining: rl.remaining, resetAt: rl.resetAt }),
    });
}));
