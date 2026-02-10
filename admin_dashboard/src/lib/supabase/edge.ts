import type { SupabaseClient } from '@supabase/supabase-js';
import { getEnv } from '@/lib/env';
import { z } from 'zod';

type InvokeArgs = {
  path?: string;
  method?: 'GET' | 'POST';
  query?: Record<string, string | number | boolean | undefined | null>;
  body?: unknown;
  /** Optional request id propagated to Edge Functions (x-request-id). */
  requestId?: string;
  /** Optional domain correlation id (x-correlation-id). Must be a UUID. */
  correlationId?: string;
  /** Optional schema to validate the JSON response. */
  schema?: z.ZodTypeAny;
};

function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

export async function invokeEdgeFunction<T>(
  supabase: SupabaseClient,
  functionName: string,
  args: InvokeArgs = {},
): Promise<T> {
  const env = getEnv();

  const { data, error } = await supabase.auth.getSession();
  if (error) {
    throw new Error(`Failed to get session: ${error.message}`);
  }
  const token = data.session?.access_token;
  if (!token) {
    throw new Error('No active session');
  }

  const safePath = args.path ? String(args.path).replace(/^\/+/, '') : '';

  const url = new URL(
    `${env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/${functionName}${safePath ? `/${safePath}` : ''}`,
  );
  if (args.query) {
    for (const [k, v] of Object.entries(args.query)) {
      if (v === undefined || v === null) continue;
      url.searchParams.set(k, String(v));
    }
  }

  const requestId = args.requestId ?? (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : undefined);

  if (args.correlationId && !isUuid(args.correlationId)) {
    throw new Error('Invalid correlationId: must be a UUID');
  }

  const res = await fetch(url.toString(), {
    method: args.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      ...(requestId ? { 'x-request-id': requestId } : {}),
      ...(args.correlationId ? { 'x-correlation-id': args.correlationId } : {}),
      ...(args.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: args.body ? JSON.stringify(args.body) : undefined,
  });

  const json = await res
    .json()
    .catch(() => ({ ok: false, error: 'Invalid JSON response from edge function' }));

  const edgeRequestId =
    typeof json === 'object' && json && 'request_id' in json ? String((json as any).request_id) : undefined;
  const errMsg =
    typeof json === 'object' && json && 'error' in json ? String((json as any).error) : res.statusText;

  if (!res.ok) {
    const suffix = edgeRequestId ? ` (request_id=${edgeRequestId})` : requestId ? ` (x-request-id=${requestId})` : '';
    throw new Error(`${functionName} failed (${res.status}): ${errMsg}${suffix}`);
  }

  // Optional response validation (defense-in-depth against unsafe consumption).
  if (args.schema) {
    const parsed = args.schema.safeParse(json);
    if (!parsed.success) {
      const suffix = edgeRequestId ? ` (request_id=${edgeRequestId})` : '';
      throw new Error(
        `${functionName} returned invalid JSON shape${suffix} (issues=${parsed.error.issues.length})`,
      );
    }
    return parsed.data as T;
  }

  return json as T;
}
