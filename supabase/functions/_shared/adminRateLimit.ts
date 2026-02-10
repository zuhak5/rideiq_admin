import type { RequestContext } from './requestContext.ts';
import { errorJson } from './json.ts';
import { buildRateLimitHeaders, consumeRateLimit } from './rateLimit.ts';

export type AdminRateLimitOptions = {
  /** Logical action name, e.g. "rides_list" or "ride_cancel". */
  action: string;
  adminId: string;
  windowSeconds: number;
  limit: number;
  /**
   * If true (default), allow requests when the rate-limit RPC fails.
   * For high-impact admin mutations, prefer failOpen=false (fail closed).
   */
  failOpen?: boolean;
};

export async function enforceAdminRateLimit(ctx: RequestContext, opts: AdminRateLimitOptions): Promise<Response | null> {
  const action = String(opts.action ?? '').trim().replace(/\s+/g, '_');
  const adminId = String(opts.adminId ?? '').trim();
  if (!action || !adminId) {
    // If inputs are missing, do not rate limit. This is a programming error.
    ctx.warn('admin.rate_limit.misconfigured', { action, adminId });
    return null;
  }

  const rl = await consumeRateLimit({
    key: `admin:${action}:${adminId}`,
    windowSeconds: opts.windowSeconds,
    limit: opts.limit,
    failOpen: opts.failOpen,
  });

  if (rl.allowed) return null;

  const headers = {
    ...ctx.headers,
    ...buildRateLimitHeaders({ limit: opts.limit, remaining: rl.remaining, resetAt: rl.resetAt }),
  };

  return errorJson(
    'Rate limit exceeded',
    429,
    'RATE_LIMITED',
    { reset_at: rl.resetAt, remaining: rl.remaining },
    headers,
  );
}
