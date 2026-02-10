#!/usr/bin/env node
/**
 * Simple HTTP load tester (no deps).
 *
 * Designed for Edge Function latency checks (e.g. dispatch matching).
 *
 * Example:
 *   node scripts/loadtest-http.mjs \
 *     --url "$SUPABASE_URL/functions/v1/match-ride" \
 *     --method POST \
 *     --header "Authorization: Bearer $RIDER_JWT" \
 *     --header "apikey: $SUPABASE_ANON_KEY" \
 *     --json '{"request_id":"<uuid>","radius_m":5000,"limit_n":20}' \
 *     --concurrency 20 \
 *     --duration-seconds 30 \
 *     --target-p95-ms 250
 */

import { performance } from 'node:perf_hooks';

function die(msg, code = 1) {
  console.error(msg);
  process.exit(code);
}

function parseArgs(argv) {
  const out = { headers: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (key === 'header') {
      if (!next) die('Missing value for --header');
      out.headers.push(next);
      i++;
      continue;
    }
    if (!next || next.startsWith('--')) {
      out[key] = true;
      continue;
    }
    out[key] = next;
    i++;
  }
  return out;
}

function toInt(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function toNum(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function formatMs(ms) {
  if (!Number.isFinite(ms)) return 'n/a';
  return `${ms.toFixed(1)}ms`;
}

function parseHeaders(headerPairs) {
  const h = {};
  for (const pair of headerPairs ?? []) {
    const idx = pair.indexOf(':');
    if (idx <= 0) die(`Invalid --header value (expected "Key: Value"): ${pair}`);
    const k = pair.slice(0, idx).trim();
    const v = pair.slice(idx + 1).trim();
    if (!k) die(`Invalid --header value (empty key): ${pair}`);
    h[k] = v;
  }
  return h;
}

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

async function worker({ id, until, url, method, headers, body, results, counters }) {
  while (performance.now() < until) {
    const t0 = performance.now();
    let ok = false;
    let status = 0;
    try {
      const res = await fetch(url, {
        method,
        headers,
        body,
      });
      status = res.status;
      ok = res.ok;
      // Drain response to avoid connection issues.
      await res.arrayBuffer().catch(() => null);
    } catch (e) {
      ok = false;
      status = 0;
    }
    const dt = performance.now() - t0;

    results.push(dt);
    counters.total++;
    if (ok) counters.ok++;
    else counters.err++;
    if (status) counters.status[status] = (counters.status[status] ?? 0) + 1;

    // Slight jitter to avoid lockstep request bursts.
    await sleep(5 + (id % 7));
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const url = args.url;
  if (!url) die('Missing required --url');

  const method = String(args.method ?? 'GET').toUpperCase();
  const durationSeconds = Math.max(1, toInt(args['duration-seconds'], 15));
  const warmupSeconds = Math.max(0, toInt(args['warmup-seconds'], 0));
  const concurrency = Math.max(1, Math.min(500, toInt(args.concurrency, 10)));
  const targetP95 = args['target-p95-ms'] ? Math.max(0, toNum(args['target-p95-ms'], 0)) : null;

  const headers = parseHeaders(args.headers);

  let body = undefined;
  if (args.json) {
    body = String(args.json);
    headers['Content-Type'] = headers['Content-Type'] ?? 'application/json';
  }

  console.log(`\nLoad test: ${method} ${url}`);
  console.log(`  duration: ${durationSeconds}s (warmup: ${warmupSeconds}s)`);
  console.log(`  concurrency: ${concurrency}`);
  if (targetP95 !== null) console.log(`  target p95: ${targetP95}ms`);
  console.log('');

  // Warmup (optional)
  if (warmupSeconds > 0) {
    const warmResults = [];
    const warmCounters = { total: 0, ok: 0, err: 0, status: {} };
    const warmUntil = performance.now() + warmupSeconds * 1000;
    await Promise.all(
      Array.from({ length: concurrency }, (_, i) => worker({
        id: i,
        until: warmUntil,
        url,
        method,
        headers,
        body,
        results: warmResults,
        counters: warmCounters,
      })),
    );
    console.log(`Warmup complete: ${warmCounters.total} requests (${warmCounters.ok} ok, ${warmCounters.err} err)`);
    console.log('');
  }

  const results = [];
  const counters = { total: 0, ok: 0, err: 0, status: {} };
  const until = performance.now() + durationSeconds * 1000;

  await Promise.all(
    Array.from({ length: concurrency }, (_, i) => worker({
      id: i,
      until,
      url,
      method,
      headers,
      body,
      results,
      counters,
    })),
  );

  const sorted = results.slice().sort((a, b) => a - b);
  const p50 = percentile(sorted, 50);
  const p90 = percentile(sorted, 90);
  const p95 = percentile(sorted, 95);
  const p99 = percentile(sorted, 99);

  const rps = counters.total / durationSeconds;

  console.log('Results');
  console.log(`  requests: ${counters.total} (${counters.ok} ok, ${counters.err} err)`);
  console.log(`  throughput: ${rps.toFixed(1)} req/s`);
  console.log(`  latency: p50 ${formatMs(p50)} | p90 ${formatMs(p90)} | p95 ${formatMs(p95)} | p99 ${formatMs(p99)}`);

  const topStatuses = Object.entries(counters.status)
    .sort((a, b) => Number(b[1]) - Number(a[1]))
    .slice(0, 8)
    .map(([k, v]) => `${k}:${v}`)
    .join(' ');
  if (topStatuses) console.log(`  statuses: ${topStatuses}`);

  if (targetP95 !== null) {
    const ok = p95 <= targetP95;
    console.log(`\nTarget check: p95 ${formatMs(p95)} ${ok ? '<=' : '>'} ${targetP95}ms`);
    process.exit(ok ? 0 : 2);
  }
}

await main().catch((e) => {
  die(e instanceof Error ? e.stack ?? e.message : String(e));
});
