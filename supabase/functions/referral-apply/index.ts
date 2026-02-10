import { createAnonClient, requireUser } from '../_shared/supabase.ts';
import { errorJson, json } from '../_shared/json.ts';
import { consumeRateLimit, getClientIp } from '../_shared/rateLimit.ts';
import { withRequestContext } from '../_shared/requestContext.ts';

type Body = {
  code?: string;
};

Deno.serve((req) =>
  withRequestContext('referral-apply', req, async (_ctx) => {

  if (req.method !== 'POST') return errorJson('Method not allowed', 405);

  const { user, error: authError } = await requireUser(req);
  if (!user) return errorJson(String(authError ?? 'Unauthorized'), 401, 'UNAUTHORIZED');

  const ip = getClientIp(req);
  const rl = await consumeRateLimit({
    key: `refapply:${user.id}:${ip ?? 'noip'}`,
    windowSeconds: 60,
    limit: 10,
  });
  if (!rl.allowed) {
    return json({ error: 'Rate limit exceeded', code: 'RATE_LIMITED', reset_at: rl.resetAt, remaining: rl.remaining }, 429);
  }

  const body: Body = await req.json().catch(() => ({}));
  const code = (body.code ?? '').trim();
  if (!code) return errorJson('code is required', 400, 'VALIDATION_ERROR');

  const anon = createAnonClient(req);
  const { data, error } = await anon.rpc('referral_apply_code', { p_code: code });

  if (error) return errorJson(error.message, 400, 'REFERRAL_ERROR');

  return json({ ok: true, result: data, rate_limit: { remaining: rl.remaining, reset_at: rl.resetAt } });
  }),
);
