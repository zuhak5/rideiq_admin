import { requireCronSecret } from '../_shared/cronAuth.ts';
import { errorJson, json } from '../_shared/json.ts';
import { withRequestContext } from '../_shared/requestContext.ts';
import { createServiceClient } from '../_shared/supabase.ts';
import { emitMetricBestEffort } from '../_shared/metrics.ts';

type Body = {
  grace_seconds?: number;
};

function clampInt(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

Deno.serve(async (req) => {

  const url = new URL(req.url);

  return await withRequestContext('rate-limit-prune', req, async (ctx) => {
    const authErr = requireCronSecret(req);
    if (authErr) return authErr;

    if (req.method !== 'POST' && req.method !== 'GET') {
      return errorJson('Method not allowed', 405, 'METHOD_NOT_ALLOWED', undefined, ctx.headers);
    }

    let body: Body = {};
    if (req.method === 'POST') {
      try {
        body = (await req.json()) as Body;
      } catch {
        // Allow empty/invalid JSON (treat as empty body); avoids breaking cron calls.
        body = {};
      }
    }

    const graceSeconds = clampInt(
      url.searchParams.get('grace_seconds') ?? body.grace_seconds,
      300,
      0,
      86400,
    );

    const service = createServiceClient();
    const { data, error } = await service.rpc('rate_limit_prune', { p_grace_seconds: graceSeconds });

    if (error) {
      ctx.error('rate_limit.prune_failed', { error: String(error) });
      emitMetricBestEffort(ctx, {
        event_type: 'metric.rate_limit.prune_failed',
        level: 'error',
        payload: { grace_seconds: graceSeconds, error: String(error) },
      });
      return errorJson('Failed to prune rate limit windows', 500, 'PRUNE_FAILED', undefined, ctx.headers);
    }

    const deleted = typeof data === 'number' ? data : Number(data ?? 0);

    ctx.log('rate_limit.pruned', { grace_seconds: graceSeconds, deleted });

    emitMetricBestEffort(ctx, {
      event_type: 'metric.rate_limit.pruned',
      payload: { grace_seconds: graceSeconds, deleted },
    });

    return json({ ok: true, deleted, grace_seconds: graceSeconds }, 200, ctx.headers);
  });
});
