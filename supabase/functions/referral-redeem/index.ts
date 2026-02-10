import { createServiceClient, requireUser } from '../_shared/supabase.ts';
import { errorJson, json } from '../_shared/json.ts';
import { buildRateLimitHeaders, consumeRateLimit, getClientIp } from '../_shared/rateLimit.ts';
import { withRequestContext } from '../_shared/requestContext.ts';
import {
  expiresIso,
  ipPrefix,
  fraudEnforceActionBestEffort,
  fraudGetActiveActionBestEffort,
  fraudLogEventBestEffort,
  fraudOpenCaseBestEffort,
} from '../_shared/fraud.ts';

type Body = {
  code: string;
};

const ACTION_BLOCK = 'block_referral_redeem';

Deno.serve((req) =>
  withRequestContext('referral-redeem', req, async (ctx) => {

    if (req.method !== 'POST') return errorJson('Method not allowed', 405, 'METHOD_NOT_ALLOWED', undefined, ctx.headers);

    const { user, error: authErr } = await requireUser(req, ctx);
    if (!user) return errorJson(String(authErr ?? 'Unauthorized'), 401, 'UNAUTHORIZED', undefined, ctx.headers);
    ctx.setUserId(user.id);

    // Enforcement gate (best-effort; fails open)
    const active = await fraudGetActiveActionBestEffort({ actionType: ACTION_BLOCK, subjectKind: 'user', subjectId: user.id });
    if (active) {
      await fraudLogEventBestEffort({
        reason: 'promo_abuse_blocked',
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
        { ...ctx.headers, ...(active.expires_at ? { 'Retry-After': String(Math.max(1, Math.ceil((new Date(active.expires_at).getTime() - Date.now()) / 1000))) } : {}) },
      );
    }

    const ip = getClientIp(req);
    const limit = 5;
    const rl = await consumeRateLimit({ key: `referral_redeem:${user.id}:${ip ?? 'noip'}`, windowSeconds: 60, limit });
    if (!rl.allowed) {
      // Rate limit exceeded -> log + open case + temporary block (3 hours)
      const expiresAt = expiresIso(180);
      await fraudLogEventBestEffort({
        reason: 'promo_abuse_referral_redeem_velocity',
        subjectKind: 'user',
        subjectId: user.id,
        severity: 3,
        score: 50,
        metadata: { ip_present: !!ip, limit, window_seconds: 60 },
        req,
      });
      await fraudOpenCaseBestEffort({
        reason: 'promo_abuse_referral_redeem',
        subjectKind: 'user',
        subjectId: user.id,
        severity: 3,
        metadata: { ip_prefix: ip ? ipPrefix(ip) : null, limit, window_seconds: 60 },
      });
      await fraudEnforceActionBestEffort({
        actionType: ACTION_BLOCK,
        reason: 'promo_abuse_velocity',
        subjectKind: 'user',
        subjectId: user.id,
        severity: 3,
        expiresAt,
        metadata: { limit, window_seconds: 60 },
      });

      return json(
        { error: 'Rate limit exceeded', code: 'RATE_LIMITED', remaining: rl.remaining, reset_at: rl.resetAt },
        429,
        { ...ctx.headers, ...buildRateLimitHeaders({ limit, remaining: rl.remaining, resetAt: rl.resetAt }) },
      );
    }

    const body = (await req.json().catch(() => null)) as Body | null;
    if (!body?.code) return errorJson('invalid_body', 400, 'VALIDATION_ERROR', { required: ['code'] }, ctx.headers);

    const svc = createServiceClient();

    const { data: ref, error: refErr } = await svc
      .from('referral_codes')
      .select('code,owner_user_id,campaign_id')
      .eq('code', body.code)
      .maybeSingle();

    if (refErr) return errorJson('lookup_failed', 500, 'DB_ERROR', { message: refErr.message }, ctx.headers);
    if (!ref) return errorJson('invalid_code', 400, 'INVALID_CODE', undefined, ctx.headers);
    if (ref.owner_user_id === user.id) return errorJson('cannot_redeem_own_code', 400, 'VALIDATION_ERROR', undefined, ctx.headers);

    const { error } = await svc.from('referral_redemptions').insert({
      referred_user_id: user.id,
      referrer_user_id: ref.owner_user_id,
      referral_code: ref.code,
      campaign_id: ref.campaign_id,
    });

    if (error) {
      // unique(referred_user_id) means already redeemed
      const msg = String(error.message ?? '').toLowerCase();
      if (msg.includes('duplicate') || msg.includes('23505') || msg.includes('unique')) {
        return json({ ok: true, already_redeemed: true }, 200, ctx.headers);
      }
      ctx.error('db.redeem_failed', { err: error.message });
      return errorJson('redeem_failed', 500, 'DB_ERROR', { message: error.message }, ctx.headers);
    }

    return json({ ok: true }, 200, ctx.headers);
  }),
);
