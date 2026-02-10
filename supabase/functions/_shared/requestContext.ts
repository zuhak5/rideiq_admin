import { getCorsHeadersForRequest } from './cors.ts';

export type RequestContext = {
  fn: string;
  requestId: string;
  /** Canonical name for the edge function (used in logs/metrics). */
  component: string;
  /** Canonical snake_case request id for log pipelines. */
  request_id: string;
  /** W3C trace context compatible trace id (32 hex chars). */
  trace_id: string;
  /** Domain correlation id (trip_id / intent_id / withdraw_id). */
  correlation_id?: string;
  startedAtMs: number;
  headers: Record<string, string>;
  userId?: string;
  /** Canonical actor id for log pipelines. */
  actor_id?: string;
  log: (message: string, extra?: Record<string, unknown>) => void;
  warn: (message: string, extra?: Record<string, unknown>) => void;
  error: (message: string, extra?: Record<string, unknown>) => void;
  setUserId: (userId: string) => void;
  setCorrelationId: (correlationId: string | null) => void;
};

function createRequestId(incoming: string | null): string {
  if (incoming && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(incoming)) {
    return incoming;
  }

  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.randomUUID) {
    try {
      return cryptoApi.randomUUID();
    } catch {
      // Ignore and fall back.
    }
  }

  if (cryptoApi?.getRandomValues) {
    try {
      const bytes = new Uint8Array(16);
      cryptoApi.getRandomValues(bytes);
      const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
      return `req-${hex}`;
    } catch {
      // Ignore and fall back.
    }
  }

  return `req-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function makeLogger(
  level: 'info' | 'warn' | 'error',
  component: string,
  requestId: string,
  traceId: string,
  getUserId: () => string | undefined,
  getCorrelationId: () => string | undefined,
) {
  return (message: string, extra: Record<string, unknown> = {}) => {
    const payload = {
      // Canonical fields
      level,
      component,
      request_id: requestId,
      trace_id: traceId,
      correlation_id: getCorrelationId(),
      actor_id: getUserId(),

      // Backwards-compat (older log consumers)
      fn: component,
      requestId,
      userId: getUserId(),

      message,
      ...extra,
      ts: new Date().toISOString(),
    };
    if (level === 'error') console.error(JSON.stringify(payload));
    else if (level === 'warn') console.warn(JSON.stringify(payload));
    else console.log(JSON.stringify(payload));
  };
}

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

function isTraceIdHex(v: string) {
  return /^[0-9a-f]{32}$/i.test(v) && !/^0{32}$/i.test(v);
}

function normalizeTraceIdValue(raw: string | null): string | null {
  if (!raw) return null;
  const v = raw.trim();
  if (!v) return null;
  if (isTraceIdHex(v)) return v.toLowerCase();
  if (isUuid(v)) return v.replace(/-/g, '').toLowerCase();
  return null;
}

function traceIdFromTraceparent(header: string | null): string | null {
  if (!header) return null;
  const raw = header.trim();
  // W3C traceparent: version-traceid-parentid-flags
  const parts = raw.split('-');
  if (parts.length < 4) return null;
  const traceId = parts[1] ?? '';
  return normalizeTraceIdValue(traceId);
}

function random32Hex(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.getRandomValues) {
    try {
      const bytes = new Uint8Array(16);
      cryptoApi.getRandomValues(bytes);
      return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    } catch {
      // ignore
    }
  }

  if (cryptoApi?.randomUUID) {
    try {
      return cryptoApi.randomUUID().replace(/-/g, '').toLowerCase();
    } catch {
      // ignore
    }
  }

  // Last resort: not cryptographically strong; only for tracing continuity.
  const s = `${Date.now()}-${Math.random()}-${Math.random()}`;
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const x = (h >>> 0).toString(16).padStart(8, '0');
  return (x + x + x + x).slice(0, 32);
}

function createTraceId(req: Request): string {
  return (
    normalizeTraceIdValue(req.headers.get('x-trace-id')) ??
    traceIdFromTraceparent(req.headers.get('traceparent')) ??
    random32Hex()
  );
}

function normalizeCorrelationId(raw: string | null): string | undefined {
  if (!raw) return undefined;
  const v = raw.trim();
  if (!v) return undefined;
  return isUuid(v) ? v : undefined;
}

function attachCors(headers: Headers, req: Request) {
  const cors = getCorsHeadersForRequest(req);
  for (const [k, v] of Object.entries(cors)) {
    const key = k.toLowerCase();
    const existing = headers.get(k);

    if (!existing) {
      headers.set(k, v);
      continue;
    }

    // Prefer the request-derived allow-origin when it's concrete.
    // This ensures request-based allowlisting (localhost/staging) works even if individual handlers
    // set a default APP_ORIGIN-based value.
    if (key === 'access-control-allow-origin' && v !== '*' && existing !== v) {
      headers.set(k, v);
      continue;
    }

    // Merge Vary headers instead of overwriting.
    if (key === 'vary') {
      const parts = new Set(existing.split(',').map((s) => s.trim()).filter(Boolean));
      for (const p of String(v).split(',').map((s) => s.trim()).filter(Boolean)) parts.add(p);
      headers.set('Vary', Array.from(parts).join(', '));
      continue;
    }
  }
}

export async function withRequestContext(
  fn: string,
  req: Request,
  handler: (ctx: RequestContext) => Promise<Response>,
): Promise<Response> {
  const requestId = createRequestId(req.headers.get('x-request-id'));
  const traceId = createTraceId(req);
  const startedAtMs = Date.now();

  // Mutable fields set after authentication / domain routing
  let actorId: string | undefined;
  let correlationId: string | undefined = normalizeCorrelationId(req.headers.get('x-correlation-id'));
  const getActorId = () => actorId;
  const getCorrelationId = () => correlationId;

  const ctx: RequestContext = {
    fn,
    requestId,
    component: fn,
    request_id: requestId,
    trace_id: traceId,
    get correlation_id() { return correlationId; },
    startedAtMs,
    headers: {
      'x-request-id': requestId,
      'x-trace-id': traceId,
      ...(correlationId ? { 'x-correlation-id': correlationId } : {}),
    },
    get userId() { return actorId; },
    get actor_id() { return actorId; },
    log: makeLogger('info', fn, requestId, traceId, getActorId, getCorrelationId),
    warn: makeLogger('warn', fn, requestId, traceId, getActorId, getCorrelationId),
    error: makeLogger('error', fn, requestId, traceId, getActorId, getCorrelationId),
    setUserId: (id: string) => {
      actorId = id;
    },
    setCorrelationId: (id: string | null) => {
      const next = id ? normalizeCorrelationId(id) : undefined;
      correlationId = next;
      if (next) ctx.headers['x-correlation-id'] = next;
      else delete ctx.headers['x-correlation-id'];
    },
  };

  const isOptions = req.method === 'OPTIONS';

  // Handle CORS preflight centrally so individual functions don't need boilerplate.
  if (isOptions) {
    const headers = new Headers(getCorsHeadersForRequest(req));
    headers.set('x-request-id', requestId);
    headers.set('x-trace-id', traceId);
    if (correlationId) headers.set('x-correlation-id', correlationId);
    return new Response(null, { status: 204, headers });
  }

  ctx.log('request.start', { method: req.method, path: new URL(req.url).pathname });

  try {
    const res = await handler(ctx);

    // Always attach request id + trace ids for traceability + ensure CORS is present.
    const headers = new Headers(res.headers);
    headers.set('x-request-id', requestId);
    headers.set('x-trace-id', traceId);
    if (correlationId) headers.set('x-correlation-id', correlationId);
    attachCors(headers, req);

    const wrapped = new Response(res.body, { status: res.status, headers });
    const durationMs = Date.now() - startedAtMs;

    if (!isOptions) {
      // Warn on slow requests (>3 seconds)
      const SLOW_THRESHOLD_MS = 3000;
      if (durationMs > SLOW_THRESHOLD_MS) {
        ctx.warn('request.slow', { status: res.status, duration_ms: durationMs });
      }
      ctx.log('request.end', { status: res.status, duration_ms: durationMs });
    }
    return wrapped;
  } catch (err) {
    ctx.error('request.unhandled_error', {
      error: String(err),
      duration_ms: Date.now() - startedAtMs,
      trace_id: traceId,
      correlation_id: correlationId,
    });
    const headers = new Headers({ 'content-type': 'application/json', 'x-request-id': requestId, 'x-trace-id': traceId });
    if (correlationId) headers.set('x-correlation-id', correlationId);
    attachCors(headers, req);
    return new Response(JSON.stringify({ error: 'Internal server error', requestId, request_id: requestId, trace_id: traceId, correlation_id: correlationId ?? null }), {
      status: 500,
      headers,
    });
  }
}
