import { errorJson } from './json.ts';

function toInt(v: string | null): number | null {
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.floor(n) : null;
}

/**
 * Optional replay protection.
 *
 * If the provider includes a unix timestamp header, we can reject very old
 * deliveries (mitigates some replay attacks when an attacker obtains a signed
 * request, but mostly protects against misconfigured retries or stuck queues).
 *
 * This is best-effort and only applied when a timestamp header is present.
 *
 * Configure with WEBHOOK_MAX_AGE_SECONDS (default 300). Set <=0 to disable.
 */
export function requireFreshWebhookTimestamp(req: Request, headers: Record<string, string> = {}): Response | null {
  const maxAge = toInt(Deno.env.get('WEBHOOK_MAX_AGE_SECONDS') ?? null) ?? 300;
  if (maxAge <= 0) return null;

  const names = [
    'x-webhook-timestamp',
    'webhook-timestamp',
    'x-timestamp',
    'x-signature-timestamp',
    'stripe-timestamp',
  ];

  let raw: string | null = null;
  for (const n of names) {
    raw = req.headers.get(n);
    if (raw) break;
  }
  if (!raw) return null;

  raw = raw.trim();
  let ts: number | null = null;

  // Common formats:
  // - unix seconds
  // - unix milliseconds
  // - RFC3339 / HTTP-date
  const asInt = toInt(raw);
  if (asInt !== null) {
    ts = asInt > 1_000_000_000_000 ? Math.floor(asInt / 1000) : asInt;
  } else {
    const parsed = Date.parse(raw);
    if (!Number.isNaN(parsed)) ts = Math.floor(parsed / 1000);
  }

  if (ts === null) return null;

  const now = Math.floor(Date.now() / 1000);
  const skew = Math.abs(now - ts);
  if (skew > maxAge) {
    return errorJson('Stale webhook delivery', 401, 'STALE_WEBHOOK', undefined, headers);
  }
  return null;
}
