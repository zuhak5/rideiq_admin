function getHeader(headers: Record<string, string>, key: string): string | undefined {
  // Our internal code tends to use lowercase header names, but be defensive.
  return headers[key] ?? headers[key.toLowerCase()] ?? headers[key.toUpperCase()];
}

function getRequestIdFromHeaders(headers: Record<string, string>): string | undefined {
  return getHeader(headers, 'x-request-id');
}

function getTraceIdFromHeaders(headers: Record<string, string>): string | undefined {
  return getHeader(headers, 'x-trace-id');
}

function getCorrelationIdFromHeaders(headers: Record<string, string>): string | undefined {
  return getHeader(headers, 'x-correlation-id');
}

function maybeAttachRequestMeta(data: unknown, headers: Record<string, string>) {
  // supabase-js Functions.invoke() does not expose response headers.
  // To make debugging easier in clients, also echo key trace headers in JSON bodies.
  const requestId = getRequestIdFromHeaders(headers);
  const traceId = getTraceIdFromHeaders(headers);
  const correlationId = getCorrelationIdFromHeaders(headers);
  if (!requestId && !traceId && !correlationId) return data;

  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const obj = data as Record<string, unknown>;
    const out: Record<string, unknown> = { ...obj };

    if (requestId) {
      if (!('requestId' in out)) out.requestId = requestId;
      if (!('request_id' in out)) out.request_id = requestId;
    }
    if (traceId) {
      if (!('traceId' in out)) out.traceId = traceId;
      if (!('trace_id' in out)) out.trace_id = traceId;
    }
    if (correlationId) {
      if (!('correlationId' in out)) out.correlationId = correlationId;
      if (!('correlation_id' in out)) out.correlation_id = correlationId;
    }

    return out;
  }
  return data;
}

export function json(data: unknown, status = 200, headers: Record<string, string> = {}) {
  const body = maybeAttachRequestMeta(data, headers);
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'Access-Control-Allow-Origin': '*', ...headers },
  });
}

export function errorJson(
  message: string,
  status = 400,
  code?: string,
  extra?: Record<string, unknown>,
  headers: Record<string, string> = {},
) {
  // Keep error envelope stable and machine-readable.
  // Many clients only look for `error`, but `ok: false` is helpful for debugging and parity with success payloads.
  const body: Record<string, unknown> = { ok: false, error: message };
  if (code) body.code = code;
  if (extra) Object.assign(body, extra);
  return json(body, status, headers);
}
