import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock supabaseClient before importing aiGatewayStream.
vi.mock('./supabaseClient', () => {
  return {
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
    // Back-compat export
    SUPABASE_ANON_KEY: 'sb_publishable_test',
    supabase: {
      auth: {
        getSession: vi.fn(async () => ({
          data: { session: { access_token: 'token' } },
          error: null,
        })),
      },
    },
  };
});

function makeStream(chunks: string[]) {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
}

describe('aiGatewayStream SSE parsing', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('handles chunk boundaries and emits delta and done', async () => {
    const full =
      'event: meta\n' +
      'data: {"surface":"auto","request_id":"r1"}\n\n' +
      'event: delta\n' +
      'data: {"delta":"hel"}\n\n' +
      'event: delta\n' +
      'data: {"delta":"lo"}\n\n' +
      'event: done\n' +
      'data: {"ok":true}\n\n';

    const chunks = [full.slice(0, 7), full.slice(7, 29), full.slice(29, 63), full.slice(63)];

    globalThis.fetch = vi.fn(async () => {
      return new Response(makeStream(chunks), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    }) as any;

    const mod = await import('./aiGatewayStream');
    const aiGatewayStream = mod.aiGatewayStream;

    const deltas: string[] = [];
    let donePayload: any = null;

    await aiGatewayStream({
      surface: 'auto',
      message: 'hi',
      onDelta: (d) => deltas.push(d),
      onDone: (p) => {
        donePayload = p;
      },
      onError: (p) => {
        throw new Error('unexpected error: ' + JSON.stringify(p));
      },
    });

    expect(deltas.join('')).toBe('hello');
    expect(donePayload).toEqual({ ok: true });
  });

  it('flushes final event without a trailing blank line', async () => {
    const full =
      'event: delta\n' +
      'data: {"delta":"hello"}\n\n' +
      'event: done\n' +
      'data: {"ok":true}';

    const chunks = [full.slice(0, 5), full.slice(5, 20), full.slice(20)];

    globalThis.fetch = vi.fn(async () => {
      return new Response(makeStream(chunks), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    }) as any;

    const mod = await import('./aiGatewayStream');
    const aiGatewayStream = mod.aiGatewayStream;

    const deltas: string[] = [];
    let donePayload: any = null;

    await aiGatewayStream({
      surface: 'auto',
      message: 'hi',
      onDelta: (d) => deltas.push(d),
      onDone: (p) => {
        donePayload = p;
      },
      onError: (p) => {
        throw new Error('unexpected error: ' + JSON.stringify(p));
      },
    });

    expect(deltas.join('')).toBe('hello');
    expect(donePayload).toEqual({ ok: true });
  });
});
