/**
 * Upstream HTTP error helper.
 *
 * Goals:
 * - Preserve the existing error message suffix pattern `*_http_<status>` so
 *   legacy parsing still works.
 * - Attach structured metadata (status + Retry-After) so the orchestrator can
 *   honor provider throttling and set accurate cooldowns.
 */

export type UpstreamRateLimitMeta = {
  /** Seconds to wait before retrying, if known. */
  retryAfterSeconds?: number;
  /** Epoch seconds when the limiter resets (vendor headers). */
  resetAtUnixSeconds?: number;
  /** Raw vendor headers surfaced for debugging (best-effort). */
  headers?: Record<string, string>;
};

export class UpstreamHttpError extends Error {
  readonly httpStatus: number;
  readonly rateLimit?: UpstreamRateLimitMeta;
  readonly rawBody?: unknown;

  constructor(message: string, httpStatus: number, rateLimit?: UpstreamRateLimitMeta, rawBody?: unknown) {
    super(message);
    this.name = 'UpstreamHttpError';
    this.httpStatus = httpStatus;
    this.rateLimit = rateLimit;
    this.rawBody = rawBody;
  }
}

function clampInt(n: number, min: number, max: number): number {
  const v = Math.trunc(n);
  return Math.max(min, Math.min(max, v));
}

/**
 * RFC / MDN: Retry-After can be either seconds or an HTTP-date.
 */
export function parseRetryAfterSeconds(headers: Headers, nowMs: number = Date.now()): number | null {
  const v = (headers.get('retry-after') ?? '').trim();
  if (!v) return null;

  // delay-seconds
  if (/^\d+$/.test(v)) {
    const s = Number(v);
    if (!Number.isFinite(s)) return null;
    return clampInt(s, 0, 86400);
  }

  // http-date
  const ms = Date.parse(v);
  if (!Number.isFinite(ms)) return null;
  const delta = Math.ceil((ms - nowMs) / 1000);
  return clampInt(delta, 0, 86400);
}

function parseUnixSecondsMaybe(v: string): number | null {
  const t = v.trim();
  if (!t) return null;
  // Some APIs return a full Unix timestamp; others return seconds-until-reset.
  if (!/^-?\d+$/.test(t)) return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

export function computeResetAtUnixSecondsFromHeaders(headers: Headers, nowMs: number = Date.now()): number | null {
  // Mapbox: X-Rate-Limit-Reset is an epoch seconds timestamp.
  const mapboxReset = parseUnixSecondsMaybe(headers.get('x-rate-limit-reset') ?? '');
  if (mapboxReset && mapboxReset > 1_000_000_000) return mapboxReset;

  // HERE and others sometimes use X-RateLimit-Reset as seconds until reset.
  const genericReset = parseUnixSecondsMaybe(headers.get('x-ratelimit-reset') ?? headers.get('x-rate-limit-reset') ?? '');
  if (genericReset && genericReset > 0 && genericReset < 1_000_000_000) {
    const nowUnix = Math.floor(nowMs / 1000);
    return nowUnix + genericReset;
  }

  return null;
}

export function computeRetryAfterFromVendorHeaders(headers: Headers, nowMs: number = Date.now()): number | null {
  const resetAt = computeResetAtUnixSecondsFromHeaders(headers, nowMs);
  if (!resetAt) return null;
  const nowUnix = Math.floor(nowMs / 1000);
  const delta = resetAt - nowUnix;
  if (!Number.isFinite(delta)) return null;
  return clampInt(delta, 0, 86400);
}

function pickDebugHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of ['retry-after', 'x-rate-limit-reset', 'x-rate-limit-limit', 'x-rate-limit-interval', 'x-ratelimit-reset', 'x-ratelimit-limit']) {
    const v = headers.get(k);
    if (v) out[k] = v;
  }
  return out;
}

/**
 * Build an UpstreamHttpError from a fetch Response.
 */
export function upstreamHttpError(prefix: string, res: Response, rawBody?: unknown): UpstreamHttpError {
  const nowMs = Date.now();
  const retryAfter = parseRetryAfterSeconds(res.headers, nowMs) ?? computeRetryAfterFromVendorHeaders(res.headers, nowMs);
  const resetAt = computeResetAtUnixSecondsFromHeaders(res.headers, nowMs);

  const rateLimit: UpstreamRateLimitMeta | undefined = (retryAfter != null || resetAt != null)
    ? {
      retryAfterSeconds: retryAfter ?? undefined,
      resetAtUnixSeconds: resetAt ?? undefined,
      headers: pickDebugHeaders(res.headers),
    }
    : undefined;

  // Keep the historical suffix format for compatibility with existing parsing.
  const msg = `${prefix}_http_${res.status}`;
  return new UpstreamHttpError(msg, res.status, rateLimit, rawBody);
}
