import { envTrim } from './config.ts';

/**
 * CORS helper for Edge Functions.
 *
 * Best-practice behavior for browser calls:
 * - If the request includes an Origin header and it is allowlisted (CORS_ALLOW_ORIGINS + defaults),
 *   echo it back (needed for credentialed requests).
 * - If Origin is present but not allowlisted, fall back to '*' (works for non-credentialed requests)
 *   so callers get a real HTTP status/body instead of a hard CORS failure.
 * - If Origin is absent (server-to-server), use APP_ORIGIN / APP_BASE_URL if configured, else '*'.
 *
 * Note: CORS is not an authentication mechanism. If you need to restrict access, enforce it in code.
 */
const DEFAULT_ALLOWLIST = new Set<string>([
  'https://movinesta.github.io',
  'http://localhost:5173',
  'http://localhost:3000',
]);

function parseAllowlist(): Set<string> {
  const raw = envTrim('CORS_ALLOW_ORIGINS');
  if (!raw) return new Set(DEFAULT_ALLOWLIST);
  const set = new Set<string>();
  for (const part of raw.split(',')) {
    const v = part.trim();
    if (!v) continue;
    try {
      set.add(new URL(v).origin);
    } catch {
      // Ignore invalid values.
    }
  }
  // Always include defaults to keep local dev working unless explicitly disabled.
  for (const d of DEFAULT_ALLOWLIST) set.add(d);
  return set;
}

const allowlist = parseAllowlist();

function deriveConfiguredOrigin(): string | null {
  const explicit = envTrim('APP_ORIGIN');
  if (explicit) {
    try {
      return new URL(explicit).origin;
    } catch {
      // allow raw origin as-is
      return explicit;
    }
  }

  const base = envTrim('APP_BASE_URL');
  if (base) {
    try {
      return new URL(base).origin;
    } catch {
      // fall through
    }
  }

  return null;
}

export function getCorsHeadersForRequest(req: Request): Record<string, string> {
  const configured = deriveConfiguredOrigin();
  const origin = req.headers.get('origin') ?? '';

  // Prefer echoing the browser Origin when it is allowlisted.
  // This avoids accidental CORS breakage when APP_ORIGIN is set for production
  // but developers/test environments call from localhost or another allowed origin.
  let allowOrigin = '*';

  if (origin) {
    if (allowlist.has(origin)) {
      allowOrigin = origin;
    } else if (configured && origin === configured) {
      // If the request origin matches configured origin, allow it.
      allowOrigin = origin;
    } else {
      // Unknown origin: non-credentialed requests can still proceed.
      // Credentialed requests must explicitly allowlist their origin.
      allowOrigin = '*';
    }
  } else {
    // Server-to-server (no Origin): use configured origin if present.
    allowOrigin = configured ?? '*';
  }

  const headers: Record<string, string> = {
    'Access-Control-Allow-Origin': allowOrigin,
    // Include tracing / correlation headers used by the web app (invokeEdge).
    // If a browser preflight includes Access-Control-Request-Headers, the server must
    // explicitly allow them, otherwise the actual request will be blocked.
    // Ref: MDN Access-Control-Allow-Headers.
    'Access-Control-Allow-Headers':
      'authorization, x-client-info, apikey, content-type, x-request-id, x-trace-id, x-correlation-id, traceparent, tracestate, baggage, accept',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Expose-Headers': 'x-request-id',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };

  // Only set Allow-Credentials when origin is explicit (not '*').
  if (allowOrigin !== '*') {
    headers['Access-Control-Allow-Credentials'] = 'true';
  }

  return headers;
}

/**
 * Back-compat: older modules import `corsHeaders`.
 * This is env-based (no request) and is OK for server-to-server calls.
 */
export function getCorsHeaders(): Record<string, string> {
  const configured = deriveConfiguredOrigin();
  const allowOrigin = configured ?? '*';
  const headers: Record<string, string> = {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers':
      'authorization, x-client-info, apikey, content-type, x-request-id, x-trace-id, x-correlation-id, traceparent, tracestate, baggage, accept',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Expose-Headers': 'x-request-id',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
  if (allowOrigin !== '*') headers['Access-Control-Allow-Credentials'] = 'true';
  return headers;
}

export const corsHeaders: Record<string, string> = getCorsHeaders();

export function handleOptions(req: Request): Response | null {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: getCorsHeadersForRequest(req) });
  }
  return null;
}
/**
 * Convenience wrapper: ensure a response has CORS headers derived from the incoming request.
 *
 * Useful for handlers that don't use withRequestContext().
 */
export function withCors(req: Request, res: Response): Response {
  const headers = new Headers(res.headers);
  const cors = getCorsHeadersForRequest(req);

  // Merge/override CORS headers. Prefer a concrete allow-origin over '*'.
  for (const [k, v] of Object.entries(cors)) {
    const existing = headers.get(k);

    if (!existing) {
      headers.set(k, v);
      continue;
    }

    if (k.toLowerCase() === 'access-control-allow-origin' && existing === '*' && v !== '*') {
      headers.set(k, v);
      continue;
    }

    if (k.toLowerCase() === 'vary') {
      const parts = new Set(existing.split(',').map((s) => s.trim()).filter(Boolean));
      for (const p of String(v).split(',').map((s) => s.trim()).filter(Boolean)) parts.add(p);
      headers.set('Vary', Array.from(parts).join(', '));
      continue;
    }
  }

  return new Response(res.body, { status: res.status, headers });
}
