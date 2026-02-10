#!/usr/bin/env node
/**
 * Edge Functions security audit (static).
 *
 * Primary goal:
 * - Ensure every function configured with verify_jwt = false has an explicit
 *   authorization / integrity check.
 *
 * Secondary goal:
 * - Warn when verify_jwt settings drift from the declared auth model in
 *   config/security/edge-auth-contract.json.
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const CONFIG_TOML = path.join(ROOT, 'supabase', 'config.toml');
const FUNCTIONS_DIR = path.join(ROOT, 'supabase', 'functions');
const AUTH_CONTRACT_PATH = path.join(ROOT, 'config', 'security', 'edge-auth-contract.json');

function readText(p) {
  return fs.readFileSync(p, 'utf8');
}

function loadAuthContract() {
  if (!fs.existsSync(AUTH_CONTRACT_PATH)) {
    throw new Error(`Missing auth contract: ${path.relative(ROOT, AUTH_CONTRACT_PATH)}`);
  }
  const raw = readText(AUTH_CONTRACT_PATH);
  const parsed = JSON.parse(raw);
  const functions = parsed?.functions && typeof parsed.functions === 'object' ? parsed.functions : null;
  if (!functions) {
    throw new Error(`Invalid auth contract format: ${path.relative(ROOT, AUTH_CONTRACT_PATH)} (missing functions map)`);
  }
  return functions;
}

function listVerifyJwtFalseFunctions(configToml) {
  const names = [];
  const lines = configToml.split(/\r?\n/);
  let current = null;
  for (const line of lines) {
    const sect = line.match(/^\s*\[functions\.([a-zA-Z0-9_-]+)\]\s*$/);
    if (sect) {
      current = sect[1];
      continue;
    }
    if (!current) continue;
    if (/^\s*verify_jwt\s*=\s*false\s*$/.test(line)) {
      names.push(current);
      current = null; // stop scanning until next section
    }
  }
  return names;
}

function parseVerifyJwtMap(configToml) {
  const map = new Map();
  const lines = configToml.split(/\r?\n/);
  let current = null;
  for (const line of lines) {
    const sect = line.match(/^\s*\[functions\.([a-zA-Z0-9_-]+)\]\s*$/);
    if (sect) {
      current = sect[1];
      map.set(current, null);
      continue;
    }
    if (!current) continue;
    const v = line.match(/^\s*verify_jwt\s*=\s*(true|false)\s*$/);
    if (v) {
      map.set(current, v[1] === 'true');
    }
  }
  return map;
}

function hasAny(patterns, text) {
  return patterns.some((re) => re.test(text));
}

const PATTERNS = {
  userAuth: [/\brequireUser\s*\(/, /\brequireAdmin\s*\(/, /\bauth\.getUser\b/i, /\bAuthorization\b/i],
  cronSecret: [/\brequireCronSecret\s*\(/, /CRON_SECRET/i, /x-cron/i, /cron/i],
  signature: [
    /webhook_token/i,
    /signature/i,
    /hmac/i,
    /timingSafeEqual/i,
    /crypto\.subtle/i,
    /verifyJwt/i,
    /requireWebhookSecret\s*\(/,
    /x-webhook-secret/i,
    /WEBHOOK_SECRET/i,
  ],
  token: [/\btoken\b/i, /token_hash/i, /sha-?256/i, /crypto\.subtle/i],
};

function getIndexPath(name) {
  return path.join(FUNCTIONS_DIR, name, 'index.ts');
}

function audit() {
  if (!fs.existsSync(CONFIG_TOML)) {
    throw new Error(`Missing supabase/config.toml at ${CONFIG_TOML}`);
  }

  const contract = loadAuthContract();
  const config = readText(CONFIG_TOML);
  const verifyJwtMap = parseVerifyJwtMap(config);
  const verifyJwtFalse = listVerifyJwtFalseFunctions(config);

  const failures = [];
  const warnings = [];

  // Auth types are defined in config/security/edge-auth-contract.json.
  const AUTH_TYPES = {
    user_jwt: { required: PATTERNS.userAuth },
    webhook_signature: { required: PATTERNS.signature },
    cron_secret: { required: PATTERNS.cronSecret },
    token_public: { required: PATTERNS.token },
    public_readonly: { readonly: true },
    return_handler: { warnPrivileged: true },
    passkey_login: { required: [/credential/i, /challenge/i] },
    optional_jwt: { required: [/\bauth/i] },
  };

  const EXPECT_VERIFY_JWT_FALSE = new Set([
    'webhook_signature',
    'cron_secret',
    'token_public',
    'public_readonly',
    'return_handler',
    'optional_jwt',
    'passkey_login',
  ]);

  // Enforce "no insecure webhook mode in production" (dev-only escape hatch must be guarded).
  const insecureFlagRe = /ALLOW_INSECURE_WEBHOOKS/i;
  const insecureProdGuardRe = /isProduction\s*\(/;

  // Primary audit: verify_jwt=false endpoints MUST be in the contract and include recognizable guard patterns.
  for (const name of verifyJwtFalse) {
    const indexPath = getIndexPath(name);
    if (!fs.existsSync(indexPath)) {
      failures.push({ name, reason: `Missing function entrypoint: ${indexPath}` });
      continue;
    }
    const src = readText(indexPath);

    const entry = contract[name];
    if (!entry) {
      failures.push({
        name,
        reason: `Missing auth contract entry for verify_jwt=false function (${path.relative(ROOT, AUTH_CONTRACT_PATH)})`,
      });
      continue;
    }

    const auth = entry?.auth;
    const rule = AUTH_TYPES[auth];
    if (!rule) {
      failures.push({ name, reason: `Invalid auth type in contract: ${auth}` });
      continue;
    }

    if (insecureFlagRe.test(src) && !insecureProdGuardRe.test(src)) {
      failures.push({ name, reason: 'Insecure webhook flag found without an isProduction() guard.' });
      continue;
    }

    if (rule.readonly) {
      // Public endpoints should not write to DB (best-effort heuristic).
      // Note: `.rpc()` can be used for read-only routines, so we only treat
      // explicit insert/update/delete calls as suspicious here.
      if (/\.insert\(/.test(src) || /\.update\(/.test(src) || /\.delete\(/.test(src)) {
        warnings.push({ name, reason: 'public_readonly endpoint appears to perform a write (insert/update/delete); verify this is intended.' });
      }
      continue;
    }

    if (rule.warnPrivileged) {
      if (/SUPABASE_SECRET_KEY|SUPABASE_SERVICE_ROLE_KEY/.test(src) || /\.rpc\(/.test(src) || /\.(insert|update|delete)\(/.test(src)) {
        warnings.push({ name, reason: 'return_handler appears to do privileged operations; verify this is intended.' });
      }
      continue;
    }

    if (rule.required && !hasAny(rule.required, src)) {
      failures.push({ name, reason: `Auth contract requires ${auth} guard, but no recognizable guard pattern was found.` });
      continue;
    }
  }

  // Secondary audit: config <-> contract drift (warning-only).
  for (const [fnName, entry] of Object.entries(contract)) {
    const auth = entry?.auth;
    if (!auth) continue;

    // If the function is not configured in config.toml, ignore (it might be deployed-only).
    if (!verifyJwtMap.has(fnName)) continue;

    const explicit = verifyJwtMap.get(fnName); // true | false | null
    const effective = explicit === null ? true : explicit; // Supabase default is verify_jwt=true
    if (EXPECT_VERIFY_JWT_FALSE.has(auth) && effective !== false) {
      warnings.push({
        name: fnName,
        reason: `Declared ${auth} (typically no user JWT). Prefer verify_jwt=false for predictable public/webhook/cron behavior.`,
      });
    }

    // Additional hygiene warning: user_jwt endpoints should avoid direct service-role usage.
    // Prefer calling Postgres using the caller's JWT (RLS/claims) and SECURITY DEFINER wrappers where needed.
    if (auth === 'user_jwt') {
      const indexPath = getIndexPath(fnName);
      if (fs.existsSync(indexPath)) {
        const src = readText(indexPath);
        if (/\bcreateServiceClient\s*\(/.test(src)) {
          warnings.push({
            name: fnName,
            reason:
              'user_jwt endpoint directly uses createServiceClient() (service role). Prefer createUserClient(req) and DB-side wrappers that bind auth.uid() to prevent ID spoofing and reduce privilege.',
          });
        }
      }
    }
  }

  return { verifyJwtFalse, failures, warnings };
}

try {
  const { verifyJwtFalse, failures, warnings } = audit();

  console.log(`\nEdge Functions audit: verify_jwt=false functions (${verifyJwtFalse.length})`);
  for (const n of verifyJwtFalse) console.log(`  - ${n}`);

  if (warnings.length) {
    console.log(`\nWarnings (${warnings.length}):`);
    for (const w of warnings) console.log(`  - ${w.name}: ${w.reason}`);
  }

  if (failures.length) {
    console.error(`\nFAIL (${failures.length}) — fix before merging:`);
    for (const f of failures) console.error(`  - ${f.name}: ${f.reason}`);
    process.exit(1);
  }

  console.log(`\n✅ Audit OK (no failures).`);
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  console.error(`\nEdge Functions audit crashed: ${msg}`);
  process.exit(1);
}
