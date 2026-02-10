import { createServiceClient } from './supabase.ts';

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetAt: string;
};

export async function consumeRateLimit(params: {
  key: string;
  windowSeconds: number;
  limit: number;
  /**
   * If true (default), failures in the rate-limit RPC will allow the request.
   * Use failOpen=false for non-core/costly endpoints (e.g., AI) to avoid
   * unbounded spend during partial outages.
   */
  failOpen?: boolean;
}): Promise<RateLimitResult> {
  const service = createServiceClient();

  const { data, error } = await service.rpc('rate_limit_consume', {
    p_key: params.key,
    p_window_seconds: params.windowSeconds,
    p_limit: params.limit,
  });

  if (error) {
    const resetAt = new Date(Date.now() + params.windowSeconds * 1000).toISOString();
    // Default: fail open (core flows). For AI/costly endpoints prefer fail closed.
    if (params.failOpen !== false) {
      return { allowed: true, remaining: 0, resetAt };
    }
    return { allowed: false, remaining: 0, resetAt };
  }

  const row = Array.isArray(data) ? data[0] : data;
  return {
    allowed: !!row?.allowed,
    remaining: Number(row?.remaining ?? 0),
    resetAt: String(row?.reset_at ?? new Date(Date.now() + params.windowSeconds * 1000).toISOString()),
  };
}

export function getClientIp(req: Request): string | null {
  // Prefer trusted single-IP headers when available.
  const candidates = [
    req.headers.get('cf-connecting-ip'),
    req.headers.get('true-client-ip'),
    req.headers.get('x-real-ip'),
    req.headers.get('x-forwarded-for'),
  ];

  for (const raw of candidates) {
    if (!raw) continue;

    // x-forwarded-for may be a comma-separated list; take the first hop.
    const first = raw.split(',')[0]?.trim();
    if (!first) continue;

    // Basic sanity check: avoid clearly invalid tokens.
    if (first.length > 80) continue;
    if (!/^[0-9a-fA-F:.]+$/.test(first)) continue;

    return first;
  }

  return null;
}



function secondsUntilReset(resetAt: string): number {
  const ms = new Date(resetAt).getTime() - Date.now();
  // At least 1 second to avoid "0" which can cause retry loops.
  return Math.max(1, Math.ceil(ms / 1000));
}

/**
 * Standard rate limit headers for 429 responses.
 * - Retry-After: RFC 9110 (used widely by clients/proxies)
 * - RateLimit-Limit/Remaining/Reset: commonly used draft headers (delta seconds reset)
 * - X-RateLimit-*: de-facto compatibility with many clients (epoch reset)
 */
export function buildRateLimitHeaders(params: { limit: number; remaining: number; resetAt: string }): Record<string, string> {
  const retryAfter = secondsUntilReset(params.resetAt);
  const resetEpoch = Math.floor(new Date(params.resetAt).getTime() / 1000);

  return {
    'Retry-After': String(retryAfter),
    'RateLimit-Limit': String(params.limit),
    'RateLimit-Remaining': String(Math.max(0, params.remaining)),
    'RateLimit-Reset': String(retryAfter),

    'X-RateLimit-Limit': String(params.limit),
    'X-RateLimit-Remaining': String(Math.max(0, params.remaining)),
    'X-RateLimit-Reset': String(resetEpoch),
  };
}
