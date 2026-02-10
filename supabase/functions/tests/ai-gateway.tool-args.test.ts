import { assertEquals, assert } from 'jsr:@std/assert';

type ToolArgsValidation =
  | { ok: true; args: Record<string, any> }
  | { ok: false; error: string };

// Copied from supabase/functions/ai-gateway/index.ts (pure helper).
function validateToolArgs(name: string, raw: any): ToolArgsValidation {
  const args = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? { ...raw } : {};
  const keys = Object.keys(args);

  const failUnknown = (allowed: string[]) => {
    const set = new Set(allowed);
    const bad = keys.filter((k) => !set.has(k));
    if (bad.length) return { ok: false as const, error: `unknown_fields:${bad.join(',')}` };
    return null;
  };

  const getStr = (k: string, max = 160) => {
    const v = args[k];
    if (v == null) return null;
    const s = String(v).trim();
    return s ? (s.length > max ? s.slice(0, max) : s) : null;
  };

  const getInt = (k: string, def: number, min: number, max: number) => {
    const v = args[k];
    const n = Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : def;
    return Math.max(min, Math.min(max, n));
  };

  if (name === 'search_catalog') {
    const unk = failUnknown(['query', 'merchant_id', 'limit']);
    if (unk) return unk;
    const query = getStr('query', 120);
    if (!query) return { ok: false, error: 'missing_query' };
    const merchant_id = getStr('merchant_id', 64);
    const limit = getInt('limit', 10, 1, 50);
    return { ok: true, args: { query, ...(merchant_id ? { merchant_id } : {}), limit } };
  }

  if (name === 'search_merchants') {
    const unk = failUnknown(['query', 'limit']);
    if (unk) return unk;
    const query = getStr('query', 120);
    if (!query) return { ok: false, error: 'missing_query' };
    const limit = getInt('limit', 10, 1, 25);
    return { ok: true, args: { query, limit } };
  }

  if (name === 'merchant_sales_summary') {
    const unk = failUnknown(['days']);
    if (unk) return unk;
    const days = getInt('days', 14, 1, 90);
    return { ok: true, args: { days } };
  }

  if (name === 'driver_hotspots') {
    const unk = failUnknown(['hours', 'limit']);
    if (unk) return unk;
    const hours = getInt('hours', 3, 1, 24);
    const limit = getInt('limit', 5, 1, 10);
    return { ok: true, args: { hours, limit } };
  }

  return { ok: false, error: 'unknown_tool' };
}

Deno.test('validateToolArgs rejects unknown fields', () => {
  const v = validateToolArgs('search_catalog', { query: 'x', foo: 'bar' });
  assertEquals(v.ok, false);
  if (v.ok) return;
  assert(v.error.startsWith('unknown_fields:'));
});

Deno.test('validateToolArgs requires query for search_* tools', () => {
  const v = validateToolArgs('search_merchants', { limit: 10 });
  assertEquals(v.ok, false);
  if (v.ok) return;
  assertEquals(v.error, 'missing_query');
});

Deno.test('validateToolArgs clamps numeric ranges', () => {
  const v1 = validateToolArgs('search_merchants', { query: 'x', limit: 999 });
  assertEquals(v1.ok, true);
  if (!v1.ok) return;
  assertEquals(v1.args.limit, 25);

  const v2 = validateToolArgs('merchant_sales_summary', { days: 999 });
  assertEquals(v2.ok, true);
  if (!v2.ok) return;
  assertEquals(v2.args.days, 90);

  const v3 = validateToolArgs('driver_hotspots', { hours: 0, limit: 0 });
  assertEquals(v3.ok, true);
  if (!v3.ok) return;
  assertEquals(v3.args.hours, 1);
  assertEquals(v3.args.limit, 1);
});

Deno.test('validateToolArgs trims and clamps string length', () => {
  const long = 'a'.repeat(500);
  const v = validateToolArgs('search_catalog', { query: `  ${long}  ` });
  assertEquals(v.ok, true);
  if (!v.ok) return;
  assertEquals(typeof v.args.query, 'string');
  assertEquals((v.args.query as string).length, 120);
});
