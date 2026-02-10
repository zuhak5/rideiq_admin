import { createServiceClient } from '../_shared/supabase.ts';
import { errorJson, json } from '../_shared/json.ts';
import { requireCronSecret } from '../_shared/cronAuth.ts';
import { withRequestContext } from '../_shared/requestContext.ts';
import { SUPABASE_URL } from '../_shared/config.ts';

type Claimed = {
  id: number;
  function_name: string;
  payload: Record<string, unknown>;
  secret_name: string;
  secret: string;
  attempts: number;
};

function clampInt(v: unknown, min: number, max: number, fallback: number) {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function backoffSeconds(attempts: number) {
  // Exponential backoff with jitter; cap at 10 minutes.
  const exp = Math.min(Math.max(1, attempts), 6);
  const base = 15 * Math.pow(2, exp); // 30s, 60s, 120s, ...
  const cap = 600;
  const jitter = Math.floor(Math.random() * 10);
  return Math.min(cap, base + jitter);
}

async function fetchWithTimeout(input: RequestInfo, init: RequestInit, timeoutMs: number) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort('timeout'), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

Deno.serve((req) =>
  withRequestContext('edge-webhook-dispatcher', req, async (ctx) => {
    if (req.method !== 'POST') return errorJson('Method not allowed', 405, 'METHOD_NOT_ALLOWED', undefined, ctx.headers);

    // Cron-protected endpoint
    const cronAuth = requireCronSecret(req);
    if (cronAuth) return cronAuth;

    const url = new URL(req.url);
    const limit = clampInt(Number(url.searchParams.get('limit') ?? '25'), 1, 200, 25);

    const lockId = crypto.randomUUID();
    const service = createServiceClient();

    const { data, error } = await service.rpc('edge_webhook_outbox_claim', {
      p_limit: limit,
      p_lock_id: lockId,
    });

    if (error) {
      ctx.error('outbox.claim_failed', { error: error.message });
      return errorJson(error.message ?? 'Failed to claim outbox', 500, 'OUTBOX_CLAIM_FAILED', undefined, ctx.headers);
    }

    const rows = (Array.isArray(data) ? data : (data ? [data] : [])) as Claimed[];

    let sent = 0;
    let failed = 0;

    for (const row of rows) {
      const fn = String(row.function_name || '').trim();
      if (!fn) {
        failed++;
        await service.rpc('edge_webhook_outbox_mark', {
          p_outbox_id: row.id,
          p_lock_id: lockId,
          p_status: 'failed',
          p_error: 'missing_function_name',
          p_http_status: null,
          p_retry_seconds: backoffSeconds(row.attempts ?? 1),
        });
        continue;
      }

      const endpoint = `${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/${encodeURIComponent(fn)}`;

      try {
        const res = await fetchWithTimeout(
          endpoint,
          {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-webhook-secret': String(row.secret ?? ''),
              'x-outbox-id': String(row.id),
              'x-outbox-attempt': String(row.attempts ?? 1),
            },
            body: JSON.stringify(row.payload ?? {}),
          },
          20_000,
        );

        if (res.ok) {
          sent++;
          await service.rpc('edge_webhook_outbox_mark', {
            p_outbox_id: row.id,
            p_lock_id: lockId,
            p_status: 'sent',
            p_error: null,
            p_http_status: res.status,
            p_retry_seconds: null,
          });
          continue;
        }

        const text = await res.text().catch(() => '');
        failed++;
        await service.rpc('edge_webhook_outbox_mark', {
          p_outbox_id: row.id,
          p_lock_id: lockId,
          p_status: 'failed',
          p_error: (text || `http_${res.status}`).slice(0, 1000),
          p_http_status: res.status,
          p_retry_seconds: backoffSeconds(row.attempts ?? 1),
        });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        failed++;
        await service.rpc('edge_webhook_outbox_mark', {
          p_outbox_id: row.id,
          p_lock_id: lockId,
          p_status: 'failed',
          p_error: msg.slice(0, 1000),
          p_http_status: null,
          p_retry_seconds: backoffSeconds(row.attempts ?? 1),
        });
      }
    }

    return json(
      {
        ok: true,
        lock_id: lockId,
        claimed: rows.length,
        sent,
        failed,
      },
      200,
      ctx.headers,
    );
  }),
);
