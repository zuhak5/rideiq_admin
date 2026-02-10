import { envTrim } from './config.ts';

export type ResponsesInputItem =
  | {
      type: 'message';
      role: 'system' | 'user' | 'assistant';
      content: Array<{ type: 'input_text' | 'output_text'; text: string; annotations?: unknown[] }>;
      id?: string;
      status?: string;
    }
  | {
      type: 'function_call';
      id: string;
      call_id: string;
      name: string;
      arguments: string;
    }
  | {
      type: 'function_call_output';
      id: string;
      call_id: string;
      output: string;
    };

export type ToolDef = {
  type: 'function';
  name: string;
  description?: string;
  strict?: null | boolean;
  parameters: Record<string, unknown>;
};

export type Reasoning = { effort?: 'minimal' | 'low' | 'medium' | 'high' };

function isAbortError(e: unknown): boolean {
  const anyE = e as any;
  const name = anyE?.name ?? anyE?.constructor?.name;
  return name === 'AbortError' || (name === 'DOMException' && String(anyE?.message ?? '').toLowerCase().includes('abort'));
}

function applyModelDefaults(args: CallResponsesArgs): CallResponsesArgs {
  const model = String(args?.model ?? '').toLowerCase();
  const isTrinityMini = model.includes('arcee-ai/trinity-mini');
  if (!isTrinityMini) return args;

  // Arcee/Trinity Mini recommended inference parameters.
  // Keep any explicitly provided values.
  return {
    ...args,
    temperature: args.temperature ?? 0.15,
    top_p: args.top_p ?? 0.75,
    top_k: args.top_k ?? 50,
    min_p: args.min_p ?? 0.06,
    parallel_tool_calls: args.parallel_tool_calls ?? false,
    max_tool_calls: args.max_tool_calls ?? 50,
  };
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function createTimeoutSignal(timeoutMs: number): { signal: AbortSignal; cancel: () => void } {
  const ac = new AbortController();
  const id = setTimeout(() => {
    try {
      ac.abort();
    } catch {
      // ignore
    }
  }, Math.max(0, timeoutMs));
  return { signal: ac.signal, cancel: () => clearTimeout(id) };
}

function mergeSignals(a?: AbortSignal, b?: AbortSignal): AbortSignal | undefined {
  if (!a) return b;
  if (!b) return a;
  const ac = new AbortController();
  const onAbort = () => {
    try {
      ac.abort();
    } catch {
      // ignore
    }
  };
  try {
    a.addEventListener('abort', onAbort, { once: true });
    b.addEventListener('abort', onAbort, { once: true });
  } catch {
    // ignore
  }
  return ac.signal;
}

function getHeaders(extra?: Record<string, string>) {
  const apiKey = envTrim('OPENROUTER_API_KEY');
  if (!apiKey) throw new Error('OPENROUTER_API_KEY not configured');

  // OpenRouter recommends providing a referer/title for analytics.
  const referer = envTrim('OPENROUTER_HTTP_REFERER') || envTrim('APP_BASE_URL') || '';
  const title = envTrim('OPENROUTER_APP_TITLE') || 'RideIQ';

  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    ...(referer ? { 'HTTP-Referer': referer } : {}),
    ...(title ? { 'X-Title': title } : {}),
    ...(extra ?? {}),
  } as Record<string, string>;
}

export type CallResponsesArgs = {
  signal?: AbortSignal;
  model: string;
  input: string | ResponsesInputItem[];
  tools?: ToolDef[];
  tool_choice?: 'auto' | 'none' | { type: 'function'; name: string };
  reasoning?: Reasoning;
  parallel_tool_calls?: boolean;
  max_tool_calls?: number;
  max_output_tokens?: number;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  min_p?: number;
  presence_penalty?: number;
  frequency_penalty?: number;
  // Optional tracing context for OpenRouter Broadcast (<=128 chars each)
  user?: string;
  session_id?: string;
  // OpenRouter structured outputs (compatible models): https://openrouter.ai/docs/guides/features/structured-outputs
  response_format?: any;
  // OpenRouter plugins (e.g., response-healing): https://openrouter.ai/docs/guides/features/plugins/response-healing
  plugins?: Array<{ id: string; [k: string]: any }>;
  // Safety: fetch timeout to avoid hung requests.
  timeout_ms?: number;
  stream?: boolean;
};

function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

async function postResponses(args: CallResponsesArgs): Promise<Response> {
  const applied = applyModelDefaults(args);
  const { signal, timeout_ms, stream, user, session_id, ...payload } = applied;

  const defaultTimeout = stream ? 45_000 : 25_000;
  const { signal: tSig, cancel } = createTimeoutSignal(Number(timeout_ms ?? defaultTimeout));
  const merged = mergeSignals(signal, tSig);

  try {
    return await fetch('https://openrouter.ai/api/v1/responses', {
      method: 'POST',
      headers: getHeaders(session_id ? { 'x-session-id': String(session_id).slice(0, 128) } : undefined),
      body: JSON.stringify({ ...payload, stream, ...(user ? { user: String(user).slice(0, 128) } : {}), ...(session_id ? { session_id: String(session_id).slice(0, 128) } : {}) }),
      signal: merged,
    });
  } finally {
    cancel();
  }
}

export async function callOpenRouterResponses(args: CallResponsesArgs) {
  // Single retry for transient provider failures.
  let lastErr: unknown = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await postResponses({ ...args, stream: false });

      const json = await res.json().catch(async () => ({ error: { message: await res.text() } }));
      if (!res.ok) {
        const msg = json?.error?.message ?? `OpenRouter error (${res.status})`;
        const code = json?.error?.code ?? 'OPENROUTER_ERROR';

        if (attempt === 0 && isRetryableStatus(res.status)) {
          await sleep(350);
          continue;
        }

        throw new Error(`${code}:${msg}`);
      }

      return json as any;
    } catch (e) {
      lastErr = e;
      // Abort / timeout should not be retried if caller explicitly aborted.
      if (args.signal?.aborted || isAbortError(e)) throw e;
      if (attempt === 0) {
        // Best-effort: retry once for transient network errors.
        await sleep(350);
        continue;
      }
      throw e;
    }
  }

  throw lastErr ?? new Error('OPENROUTER_ERROR:unknown');
}

/**
 * Stream a Responses API request. Returns the raw fetch Response (SSE body).
 * Caller must parse the SSE stream.
 */
export async function callOpenRouterResponsesStream(args: CallResponsesArgs): Promise<Response> {
  let lastErr: unknown = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await postResponses({ ...args, stream: true });

      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        if (attempt === 0 && isRetryableStatus(res.status)) {
          await sleep(350);
          continue;
        }
        throw new Error(`OPENROUTER_ERROR:stream_failed:${res.status}:${txt}`);
      }

      return res;
    } catch (e) {
      lastErr = e;
      if (args.signal?.aborted || isAbortError(e)) throw e;
      if (attempt === 0) {
        await sleep(350);
        continue;
      }
      throw e;
    }
  }

  throw lastErr ?? new Error('OPENROUTER_ERROR:stream_failed');
}

export function extractOutputText(resp: any): string {
  const out = resp?.output;
  if (!Array.isArray(out)) return '';
  const chunks: string[] = [];
  for (const item of out) {
    if (item?.type === 'message' && Array.isArray(item?.content)) {
      for (const c of item.content) {
        if (c?.type === 'output_text' && typeof c?.text === 'string') chunks.push(c.text);
        if (c?.type === 'output_json') {
          if (typeof c?.json === 'string') {
            chunks.push(c.json);
          } else if (c?.json != null) {
            try {
              chunks.push(JSON.stringify(c.json));
            } catch {
              // ignore non-serializable payloads
            }
          }
        }
      }
    }
  }
  if (!chunks.length && typeof resp?.output_text === 'string') {
    chunks.push(resp.output_text);
  }
  return chunks.join('\n').trim();
}

export type FunctionCall = { id: string; call_id: string; name: string; arguments: string };

export function extractFunctionCalls(resp: any): FunctionCall[] {
  const out = resp?.output;
  if (!Array.isArray(out)) return [];
  const calls: FunctionCall[] = [];
  for (const item of out) {
    if (item?.type === 'function_call' && item?.call_id && item?.name) {
      calls.push({
        id: String(item.id ?? crypto.randomUUID()),
        call_id: String(item.call_id),
        name: String(item.name),
        arguments: String(item.arguments ?? '{}'),
      });
    }
  }
  return calls;
}
