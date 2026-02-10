import { createServiceClient, requireUser } from '../_shared/supabase.ts';
import { errorJson, json } from '../_shared/json.ts';
import { buildRateLimitHeaders, consumeRateLimit, getClientIp } from '../_shared/rateLimit.ts';
import { withRequestContext } from '../_shared/requestContext.ts';

function randomCode(len = 8) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < len; i++) out += chars[bytes[i] % chars.length];
  return out;
}

Deno.serve((req) =>
  withRequestContext('referral-code', req, async (ctx) => {

  const ip = getClientIp(req);
  const rl = await consumeRateLimit({
    key: `refcode:${ip ?? 'noip'}`,
    windowSeconds: 60,
    limit: 20,
  });
  if (!rl.allowed) {
    return json(
      { error: 'Rate limit exceeded' },
      429,
      { ...ctx.headers, ...buildRateLimitHeaders({ limit: 20, remaining: rl.remaining, resetAt: rl.resetAt }) },
    );
  }

  try {
    if (req.method !== 'POST') return errorJson('method_not_allowed', 405, 'METHOD_NOT_ALLOWED', undefined, ctx.headers);

    const { user } = await requireUser(req);
    const svc = createServiceClient();

    // Return existing
    const { data: existing, error: exErr } = await svc
      .from('referral_codes')
      .select('code,campaign_id')
      .eq('owner_user_id', user.id)
      .maybeSingle();

    if (exErr) return errorJson('read_failed', 500, 'READ_FAILED', { message: exErr.message }, ctx.headers);
    if (existing?.code) return json({ ok: true, code: existing.code }, 200, ctx.headers);

    // Active campaign
    const { data: campaign, error: campErr } = await svc
      .from('referral_campaigns')
      .select('id,code_prefix')
      .eq('active', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (campErr) return errorJson('campaign_failed', 500, 'CAMPAIGN_FAILED', { message: campErr.message }, ctx.headers);

    const prefix = campaign?.code_prefix ?? 'RIQ';

    // Try a few times to avoid collisions
    for (let i = 0; i < 5; i++) {
      const code = `${prefix}-${randomCode(8)}`;
      const { error: insErr } = await svc.from('referral_codes').insert({
        code,
        owner_user_id: user.id,
        campaign_id: campaign?.id ?? null,
      });

      if (!insErr) return json({ ok: true, code }, 200, ctx.headers);
      // collision: try again
      if (!String(insErr.message).toLowerCase().includes('duplicate')) {
        return errorJson('insert_failed', 500, 'INSERT_FAILED', { message: insErr.message }, ctx.headers);
      }
    }

    return errorJson('code_generation_failed', 500, 'CODE_GENERATION_FAILED', { message: 'too_many_collisions' }, ctx.headers);
  } catch (e) {
    return errorJson('server_error', 500, 'SERVER_ERROR', { message: String(e) }, ctx.headers);
  }
  }),
);
