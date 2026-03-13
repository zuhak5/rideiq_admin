import { envTrim } from "./config.ts";

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
  "https://movinesta.github.io",
  "https://rideiqadmin.vercel.app",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:3001",
  "http://localhost:5173",
  "http://localhost:3000",
  "http://localhost:3001",
]);

function normalizeOrigin(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    return new URL(trimmed).origin;
  } catch {
    return trimmed;
  }
}

export function parseOriginList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const out = new Set<string>();
  for (const part of raw.split(",")) {
    const normalized = normalizeOrigin(part);
    if (normalized) out.add(normalized);
  }
  return [...out];
}

export function resolveOriginAllowlist(params: {
  corsAllowOrigins?: string | null;
  appOrigin?: string | null;
  appBaseUrl?: string | null;
  extraOrigins?: Array<string | null | undefined>;
  includeDefaultOrigins?: boolean;
} = {}): string[] {
  const out = new Set<string>();

  if (params.includeDefaultOrigins !== false) {
    for (const origin of DEFAULT_ALLOWLIST) out.add(origin);
  }

  for (
    const raw of [
      params.corsAllowOrigins,
      params.appOrigin,
      params.appBaseUrl,
      ...(params.extraOrigins ?? []),
    ]
  ) {
    for (const origin of parseOriginList(raw)) out.add(origin);
  }

  return [...out];
}

function shouldIncludeDefaultOrigins(
  rawOrigins: Array<string | null | undefined>,
): boolean {
  const explicit = envTrim("CORS_INCLUDE_DEFAULTS");
  if (explicit) return /^(1|true|yes|on)$/i.test(explicit);
  return !rawOrigins.some((value) => Boolean(value?.trim()));
}

export function getConfiguredOriginAllowlist(
  extraOrigins: Array<string | null | undefined> = [],
): string[] {
  const corsAllowOrigins = envTrim("CORS_ALLOW_ORIGINS");
  const appOrigin = envTrim("APP_ORIGIN");
  const appBaseUrl = envTrim("APP_BASE_URL");
  return resolveOriginAllowlist({
    corsAllowOrigins,
    appOrigin,
    appBaseUrl,
    extraOrigins,
    includeDefaultOrigins: shouldIncludeDefaultOrigins([
      corsAllowOrigins,
      appOrigin,
      appBaseUrl,
      ...extraOrigins,
    ]),
  });
}

const allowlist = new Set(getConfiguredOriginAllowlist());

function deriveConfiguredOrigin(): string | null {
  const explicit = envTrim("APP_ORIGIN");
  if (explicit) {
    try {
      return new URL(explicit).origin;
    } catch {
      // allow raw origin as-is
      return explicit;
    }
  }

  const base = envTrim("APP_BASE_URL");
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
  const origin = req.headers.get("origin") ?? "";

  // Prefer echoing the browser Origin when it is allowlisted.
  // This avoids accidental CORS breakage when APP_ORIGIN is set for production
  // but developers/test environments call from localhost or another allowed origin.
  let allowOrigin = "*";

  if (origin) {
    if (allowlist.has(origin)) {
      allowOrigin = origin;
    } else if (configured && origin === configured) {
      // If the request origin matches configured origin, allow it.
      allowOrigin = origin;
    } else {
      // Unknown origin: non-credentialed requests can still proceed.
      // Credentialed requests must explicitly allowlist their origin.
      allowOrigin = "*";
    }
  } else {
    // Server-to-server (no Origin): use configured origin if present.
    allowOrigin = configured ?? "*";
  }

  const headers: Record<string, string> = {
    "Access-Control-Allow-Origin": allowOrigin,
    // Include tracing / correlation headers used by the web app (invokeEdge).
    // If a browser preflight includes Access-Control-Request-Headers, the server must
    // explicitly allow them, otherwise the actual request will be blocked.
    // Ref: MDN Access-Control-Allow-Headers.
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-request-id, x-trace-id, x-correlation-id, traceparent, tracestate, baggage, accept",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Expose-Headers": "x-request-id",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };

  // Only set Allow-Credentials when origin is explicit (not '*').
  if (allowOrigin !== "*") {
    headers["Access-Control-Allow-Credentials"] = "true";
  }

  return headers;
}

/**
 * Back-compat: older modules import `corsHeaders`.
 * This is env-based (no request) and is OK for server-to-server calls.
 */
export function getCorsHeaders(): Record<string, string> {
  const configured = deriveConfiguredOrigin();
  const allowOrigin = configured ?? "*";
  const headers: Record<string, string> = {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-request-id, x-trace-id, x-correlation-id, traceparent, tracestate, baggage, accept",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Expose-Headers": "x-request-id",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
  if (allowOrigin !== "*") headers["Access-Control-Allow-Credentials"] = "true";
  return headers;
}

export const corsHeaders: Record<string, string> = getCorsHeaders();

export function handleOptions(req: Request): Response | null {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: getCorsHeadersForRequest(req),
    });
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

    if (
      k.toLowerCase() === "access-control-allow-origin" && existing === "*" &&
      v !== "*"
    ) {
      headers.set(k, v);
      continue;
    }

    if (k.toLowerCase() === "vary") {
      const parts = new Set(
        existing.split(",").map((s) => s.trim()).filter(Boolean),
      );
      for (
        const p of String(v).split(",").map((s) => s.trim()).filter(Boolean)
      ) parts.add(p);
      headers.set("Vary", Array.from(parts).join(", "));
      continue;
    }
  }

  return new Response(res.body, { status: res.status, headers });
}
