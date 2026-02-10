import { requireCronSecret } from '../_shared/cronAuth.ts';
import { createServiceClient } from '../_shared/supabase.ts';
import { errorJson, json } from '../_shared/json.ts';
import { withRequestContext } from '../_shared/requestContext.ts';
import { runWebhookJobs } from '../_shared/webhookJobs.ts';

function toInt(v: string | null, fallback: number) {
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.floor(n) : fallback;
}

Deno.serve(async (req) => {
  // verify_jwt=false in config.toml (cron endpoint)

  const auth = requireCronSecret(req);
  if (auth) return auth;

  return await withRequestContext('webhook-job-runner', req, async (ctx) => {
    try {
      const url = new URL(req.url);
      const limit = toInt(url.searchParams.get('limit'), 10);

      const service = createServiceClient();
      const results = await runWebhookJobs(service, { ctx, limit, lockSeconds: toInt(url.searchParams.get('lockSeconds'), 300) });

      const okCount = results.filter((r) => r?.ok).length;
      ctx.log('Processed webhook jobs', { processed: results.length, ok: okCount, failed: results.length - okCount });

      return json({ ok: true, processed: results.length, results }, 200, ctx.headers);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return errorJson(msg, 500, 'INTERNAL_ERROR', undefined, ctx.headers);
    }
  });
});
