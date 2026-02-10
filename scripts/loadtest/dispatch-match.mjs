#!/usr/bin/env node
/**
 * Session 08: Dispatch matching load test wrapper.
 *
 * Wraps scripts/loadtest-http.mjs with sensible defaults for the match-ride Edge Function.
 *
 * Required env vars (recommended):
 *   SUPABASE_URL
 *   SUPABASE_ANON_KEY (or SUPABASE_PUBLISHABLE_KEY)
 *   RIDER_JWT (a valid rider access token)
 *
 * Required args:
 *   --request-id <uuid>
 *
 * Example:
 *   node scripts/loadtest/dispatch-match.mjs \
 *     --request-id <uuid> \
 *     --concurrency 20 \
 *     --duration-seconds 30 \
 *     --target-p95-ms 250
 */

import { spawnSync } from 'node:child_process';

function die(msg, code = 1) {
  console.error(msg);
  process.exit(code);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      out[key] = true;
      continue;
    }
    out[key] = next;
    i++;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));

const requestId = String(args['request-id'] ?? '').trim();
if (!requestId) die('Missing required --request-id <uuid>');

const supabaseUrl = String(args.url ?? process.env.SUPABASE_URL ?? '').replace(/\/$/, '');
if (!supabaseUrl) die('Missing SUPABASE_URL (or pass --url)');

const anonKey = String(process.env.SUPABASE_ANON_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY ?? '').trim();
if (!anonKey) die('Missing SUPABASE_ANON_KEY (or SUPABASE_PUBLISHABLE_KEY)');

const riderJwt = String(process.env.RIDER_JWT ?? '').trim();
if (!riderJwt) die('Missing RIDER_JWT (rider access token)');

const radiusM = Number(args['radius-m'] ?? 5000);
const limitN = Number(args['limit-n'] ?? 20);

const url = args.url ? String(args.url) : `${supabaseUrl}/functions/v1/match-ride`;

const payload = JSON.stringify({ request_id: requestId, radius_m: radiusM, limit_n: limitN });

const passthrough = [];
for (const k of ['concurrency', 'duration-seconds', 'warmup-seconds', 'target-p95-ms']) {
  if (args[k] !== undefined) {
    passthrough.push(`--${k}`, String(args[k]));
  }
}

const cmd = [
  'scripts/loadtest-http.mjs',
  '--url',
  url,
  '--method',
  'POST',
  '--header',
  `Authorization: Bearer ${riderJwt}`,
  '--header',
  `apikey: ${anonKey}`,
  '--json',
  payload,
  ...passthrough,
];

const res = spawnSync(process.execPath, cmd, { stdio: 'inherit' });
process.exit(res.status ?? 1);
