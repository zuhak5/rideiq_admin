import { requireCronSecret } from '../_shared/cronAuth.ts';
import { errorJson, json } from '../_shared/json.ts';
import { withRequestContext } from '../_shared/requestContext.ts';
import { createServiceClient } from '../_shared/supabase.ts';

function clampInt(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

Deno.serve(async (req) => {
  const url = new URL(req.url);

  return await withRequestContext('edge-webhook-prune', req, async (ctx) => {
    const authErr = requireCronSecret(req);
    if (authErr) return authErr;

    if (req.method !== 'POST' && req.method !== 'GET') {
      return errorJson('Method not allowed', 405, 'METHOD_NOT_ALLOWED', undefined, ctx.headers);
    }

    let body: Record<string, unknown> = {};
    if (req.method === 'POST') {
      try {
        body = (await req.json()) as Record<string, unknown>;
      } catch {
        body = {};
      }
    }

    const maxAgeDays = clampInt(url.searchParams.get('max_age_days') ?? body.max_age_days, 14, 1, 365);
    const batch = clampInt(url.searchParams.get('batch') ?? body.batch, 5000, 1, 50000);

    const service = createServiceClient();
    const { data, error } = await service.rpc('edge_webhook_outbox_prune', {
      p_max_age_days: maxAgeDays,
      p_batch: batch,
    });

    if (error) {
      ctx.error('outbox.prune_failed', { error: String(error), max_age_days: maxAgeDays, batch });
      return errorJson('Failed to prune outbox', 500, 'PRUNE_FAILED', undefined, ctx.headers);
    }

    const deleted = typeof data === 'number' ? data : Number(data ?? 0);
    ctx.log('outbox.pruned', { deleted, max_age_days: maxAgeDays, batch });

    return json({ ok: true, deleted, max_age_days: maxAgeDays, batch }, 200, ctx.headers);
  });
});
