import { errorJson, json } from '../_shared/json.ts';
import { createAnonClient, requireUser } from '../_shared/supabase.ts';
import { withRequestContext } from '../_shared/requestContext.ts';
import { buildRateLimitHeaders, consumeRateLimit, getClientIp } from '../_shared/rateLimit.ts';
import {
  expiresIso,
  fraudEnforceActionBestEffort,
  fraudGetActiveActionBestEffort,
  fraudLogEventBestEffort,
  fraudOpenCaseBestEffort,
} from '../_shared/fraud.ts';

type Body = {
  ride_id?: string;
  text?: string | null;
  kind?: 'text' | 'image' | 'system';
  attachment_key?: string | null; // path in chat-media bucket
  metadata?: Record<string, unknown> | null;
  message_id?: string | null; // optional idempotency key (UUID)
};

const ACTION_BLOCK = 'block_ride_chat_send';

Deno.serve((req) =>
  withRequestContext('ride-chat-send', req, async (ctx) => {

    if (req.method !== 'POST') return errorJson('Method not allowed', 405, 'METHOD_NOT_ALLOWED', undefined, ctx.headers);

    const { user, error } = await requireUser(req, ctx);
    if (error || !user) return errorJson('Unauthorized', 401, 'UNAUTHORIZED', undefined, ctx.headers);
    ctx.setUserId(user.id);

    const active = await fraudGetActiveActionBestEffort({ actionType: ACTION_BLOCK, subjectKind: 'user', subjectId: user.id });
    if (active) {
      await fraudLogEventBestEffort({
        reason: 'harassment_blocked',
        subjectKind: 'user',
        subjectId: user.id,
        severity: 2,
        score: 20,
        metadata: { action_type: ACTION_BLOCK, action_id: active.id, expires_at: active.expires_at },
        req,
      });
      return json(
        { error: 'Temporarily blocked', code: 'BLOCKED', retry_at: active.expires_at ?? null },
        429,
        {
          ...ctx.headers,
          ...(active.expires_at
            ? {
                'Retry-After': String(
                  Math.max(1, Math.ceil((new Date(active.expires_at).getTime() - Date.now()) / 1000)),
                ),
              }
            : {}),
        },
      );
    }

    // Rate limit: message velocity
    const ip = getClientIp(req);
    const limit = 30;
    const rl = await consumeRateLimit({ key: `chat_send:${user.id}:${ip ?? 'noip'}`, windowSeconds: 60, limit });
    if (!rl.allowed) {
      const expiresAt = expiresIso(60);
      await fraudLogEventBestEffort({
        reason: 'harassment_chat_velocity',
        subjectKind: 'user',
        subjectId: user.id,
        severity: 3,
        score: 40,
        metadata: { limit, window_seconds: 60 },
        req,
      });
      await fraudOpenCaseBestEffort({
        reason: 'harassment_chat_velocity',
        subjectKind: 'user',
        subjectId: user.id,
        severity: 2,
        metadata: { source: 'ride-chat-send', limit, window_seconds: 60 },
      });
      await fraudEnforceActionBestEffort({
        actionType: ACTION_BLOCK,
        reason: 'velocity',
        subjectKind: 'user',
        subjectId: user.id,
        severity: 2,
        expiresAt,
        metadata: { limit, window_seconds: 60 },
      });

      return json(
        { error: 'Rate limit exceeded', code: 'RATE_LIMITED', remaining: rl.remaining, reset_at: rl.resetAt },
        429,
        { ...ctx.headers, ...buildRateLimitHeaders({ limit, remaining: rl.remaining, resetAt: rl.resetAt }) },
      );
    }

    let body: Body;
    try {
      body = (await req.json()) as Body;
    } catch {
      return errorJson('Invalid JSON', 400, 'INVALID_JSON', undefined, ctx.headers);
    }

    const rideId = (body.ride_id ?? '').trim();
    if (!rideId) return errorJson('ride_id is required', 400, 'VALIDATION_ERROR', undefined, ctx.headers);

    const kind = body.kind ?? 'text';
    const text = (body.text ?? '').toString();
    const attachmentKey = body.attachment_key ?? null;

    if (kind === 'text' && !text.trim()) return errorJson('text is required', 400, 'VALIDATION_ERROR', undefined, ctx.headers);
    if (kind === 'image' && !attachmentKey) {
      return errorJson('attachment_key is required for image', 400, 'VALIDATION_ERROR', undefined, ctx.headers);
    }

    const anon = createAnonClient(req);

    // Business-critical chat insertion + membership enforcement live in the DB RPC.
    const { data, error: rpcErr } = await anon.rpc('ride_chat_send_message', {
      p_ride_id: rideId,
      p_kind: kind,
      p_text: kind === 'text' ? text.trim() : null,
      p_attachment_bucket: attachmentKey ? 'chat-media' : null,
      p_attachment_key: attachmentKey,
      p_metadata: body.metadata ?? {},
      p_message_id: body.message_id ?? null,
    });

    if (rpcErr) {
      const msg = rpcErr.message ?? 'DB_ERROR';
      const code = msg.includes('not_a_participant') ? 'NOT_A_PARTICIPANT' : msg.includes('text_required') ? 'VALIDATION_ERROR' : 'DB_ERROR';
      const status = msg.includes('not_a_participant') ? 403 : msg.includes('text_required') || msg.includes('attachment_key_required') ? 400 : 400;
      return errorJson(msg, status, code, undefined, ctx.headers);
    }

    // RPC returns { ok, message }
    const message = (data as any)?.message ?? null;
    return json({ ok: true, message, rate_limit: { remaining: rl.remaining, reset_at: rl.resetAt } }, 200, ctx.headers);
  }),
);
