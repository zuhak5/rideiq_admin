import { supabase, SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from './supabaseClient';

export type AiGatewaySurface = 'auto' | 'copilot' | 'merchant' | 'driver' | 'merchant_chat';

export type AiGatewayStreamArgs = {
  history?: Array<{ role: 'user' | 'assistant'; text: string }>;

  surface: AiGatewaySurface;
  message: string;
  thread_id?: string;
  merchant_id?: string;
  ui_path?: string;
  hours?: number;
  signal?: AbortSignal;
  onMeta?: (meta: any) => void;
  onDelta?: (delta: string) => void;
  onDone?: (payload: any) => void;
  onError?: (payload: any) => void;
};

/**
 * Minimal SSE parser.
 *
 * - Events are separated by a blank line.
 * - Multiple `data:` lines are joined with `\n`.
 * - Lines starting with `:` are comments / keep-alives.
 */
function createSseParser(onEvent: (event: string, data: any) => void) {
  let evt: string | null = null;
  let dataLines: string[] = [];
  let carry = '';

  function ensureEvent() {
    if (!evt) evt = 'message';
  }

  function flush() {
    if (!dataLines.length) {
      evt = null;
      dataLines = [];
      return;
    }

    const event = evt || 'message';
    const raw = dataLines.join('\n').trim();
    evt = null;
    dataLines = [];

    if (!raw) return;

    let data: any = raw;
    try {
      data = JSON.parse(raw);
    } catch {
      // keep raw string
    }
    onEvent(event, data);
  }

  function feedLine(rawLine: string) {
    const line = rawLine.replace(/\r$/, '');
    if (line.startsWith(':')) return; // comment / keep-alive

    if (line === '') {
      flush();
      return;
    }

    if (line.startsWith('event:')) {
      evt = line.slice('event:'.length).trim();
      return;
    }

    if (line.startsWith('data:')) {
      ensureEvent();
      dataLines.push(line.slice('data:'.length).trimStart());
      return;
    }
  }

  return {
    feed(chunk: string) {
      carry += chunk;
      const lines = carry.split('\n');
      carry = lines.pop() ?? '';
      for (const l of lines) feedLine(l);
    },
    end() {
      // If the stream ends without a trailing blank line, flush what we have.
      if (carry) {
        const tail = carry;
        carry = '';
        feedLine(tail);
      }
      flush();
    },
  };
}

export async function aiGatewayStream(args: AiGatewayStreamArgs): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) throw new Error('Supabase is not configured');

  const { data: sessData, error: sessErr } = await supabase.auth.getSession();
  if (sessErr) throw sessErr;

  const token = sessData.session?.access_token;
  if (!token) throw new Error('Not authenticated');

  const res = await fetch(`${SUPABASE_URL}/functions/v1/ai-gateway`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: SUPABASE_PUBLISHABLE_KEY,
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({
      history: args.history,
      surface: args.surface,
      message: args.message,
      thread_id: args.thread_id,
      merchant_id: args.merchant_id,
      ui_path: args.ui_path,
      hours: args.hours,
      stream: true,
    }),
    signal: args.signal,
  });

  // Pre-stream errors are normal JSON errors.
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `HTTP ${res.status}`);
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error('Missing response body');

  const dec = new TextDecoder();
  let finished = false;
  const parser = createSseParser((event, data) => {
    if (event === 'meta') args.onMeta?.(data);
    else if (event === 'delta') args.onDelta?.(String((data as any)?.delta ?? ''));
    else if (event === 'done') {
      finished = true;
      args.onDone?.(data);
    } else if (event === 'error') {
      finished = true;
      args.onError?.(data);
    }
  });

  while (!finished) {
    const { done, value } = await reader.read();
    if (done) break;
    parser.feed(dec.decode(value, { stream: true }));
  }

  parser.end();

  // If the server closes the connection without sending a terminal event,
  // treat it as an error (unless the caller aborted).
  if (!finished) {
    if (args.signal?.aborted) return;
    const payload = { code: "STREAM_EOF", message: "Stream ended unexpectedly" };
    args.onError?.(payload);
    throw new Error(payload.message);
  }
}

// Back-compat: some screens import callAiGatewayStream.
export const callAiGatewayStream = aiGatewayStream;
