#!/usr/bin/env node

/**
 * Edge Function Supabase-key requirement audit.
 *
 * Contract:
 * - Every function under supabase/functions (except _shared + tests) must be declared
 *   in supabase/functions/key-requirements.json.
 * - key must be one of:
 *     - "anon"         (publishable key only, RLS enforced)
 *     - "service_role" (secret/service_role key required)
 *     - "none"         (does not use Supabase API keys)
 * - Any function that imports/uses createServiceClient() MUST be declared "service_role".
 * - Any function declared "service_role" MUST include a non-empty human justification.
 */

import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = process.cwd();
const FUNCTIONS_ROOT = path.join(REPO_ROOT, 'supabase', 'functions');
const REQUIREMENTS_PATH = path.join(FUNCTIONS_ROOT, 'key-requirements.json');

const ALLOWED = new Set(['anon', 'service_role', 'none']);

function die(msg) {
  console.error(`\n❌ ${msg}\n`);
  process.exit(1);
}

function warn(msg) {
  console.warn(`⚠️  ${msg}`);
}

function readJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    die(`Failed to read ${p}: ${e?.message ?? String(e)}`);
  }
}

function normalizeRequirements(raw) {
  // v2 format: { version: 2, functions: { fn: { key, reason? } } }
  if (raw && typeof raw === 'object' && !Array.isArray(raw) && raw.version === 2 && raw.functions) {
    const fns = raw.functions;
    if (typeof fns !== 'object' || Array.isArray(fns)) {
      die('key-requirements.json: "functions" must be an object map');
    }
    return { version: 2, map: fns };
  }

  // v1 legacy format: { "fn": "anon|service_role|none" }
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return { version: 1, map: raw };
  }

  die('key-requirements.json must be an object map (v1) or { version: 2, functions: {...} } (v2)');
}

function listFunctionDirs() {
  return fs
    .readdirSync(FUNCTIONS_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((n) => n !== '_shared' && n !== 'tests')
    .sort();
}

function readFunctionSrc(fnName) {
  const dir = path.join(FUNCTIONS_ROOT, fnName);
  const idx = path.join(dir, 'index.ts');
  if (!fs.existsSync(idx)) {
    die(`Function "${fnName}" is missing index.ts at ${path.relative(REPO_ROOT, idx)}`);
  }

  const chunks = [];
  const stack = [dir];

  while (stack.length) {
    const cur = stack.pop();
    const entries = fs.readdirSync(cur, { withFileTypes: true });
    for (const e of entries) {
      const p = path.join(cur, e.name);
      if (e.isDirectory()) {
        // ignore vendored deps if any
        if (e.name === 'node_modules') continue;
        stack.push(p);
      } else if (e.isFile() && e.name.endsWith('.ts')) {
        chunks.push(fs.readFileSync(p, 'utf8'));
      }
    }
  }

  return chunks.join('\n');
}

function usesServiceClient(src) {
  // Local string checks are sufficient because our shared client helpers have stable names.
  return src.includes('createServiceClient') || src.includes('requireSupabaseSecret');
}

function usesUserOrPublicClient(src) {
  return (
    src.includes('createUserClient') ||
    src.includes('createAnonClient') ||
    src.includes('createPublicClient') ||
    src.includes('requireUser') ||
    src.includes('requireUserStrict')
  );
}

function main() {
  if (!fs.existsSync(REQUIREMENTS_PATH)) {
    die(
      `Missing ${path.relative(
        REPO_ROOT,
        REQUIREMENTS_PATH
      )}. Session 05 requires a key requirement declaration for every Edge Function.`
    );
  }

  const normalized = normalizeRequirements(readJson(REQUIREMENTS_PATH));
  const req = normalized.map;

  const dirs = listFunctionDirs();
  const missing = dirs.filter((n) => !(n in req));
  if (missing.length) {
    die(
      `key-requirements.json is missing ${missing.length} function(s): ${missing
        .map((x) => `"${x}"`)
        .join(', ')}`
    );
  }

  const unknownKeys = Object.keys(req)
    .filter((k) => !dirs.includes(k))
    .sort();
  if (unknownKeys.length) {
    die(
      `key-requirements.json contains unknown function(s): ${unknownKeys
        .map((x) => `"${x}"`)
        .join(', ')}`
    );
  }

  const invalid = Object.entries(req)
    .filter(([, v]) => {
      const key = normalized.version === 2 ? String(v?.key ?? '') : String(v);
      return !ALLOWED.has(key);
    })
    .map(([k, v]) => {
      const key = normalized.version === 2 ? v?.key : v;
      return `${k}=${JSON.stringify(key)}`;
    });
  if (invalid.length) {
    die(`key-requirements.json has invalid values: ${invalid.join(', ')}`);
  }

  let errors = 0;
  const warnings = [];

  for (const fn of dirs) {
    const entry = req[fn];
    const declared = normalized.version === 2 ? String(entry?.key ?? '') : String(entry);
    const reason = normalized.version === 2 ? String(entry?.reason ?? '') : '';
    const src = readFunctionSrc(fn);

    const service = usesServiceClient(src);
    const userish = usesUserOrPublicClient(src);

    if (service && declared !== 'service_role') {
      console.error(
        `❌ ${fn}: uses createServiceClient()/requireSupabaseSecret but is declared "${declared}" (must be "service_role")`
      );
      errors++;
    }

    if (!service && declared === 'service_role') {
      warnings.push(`${fn}: declared service_role but does not appear to use createServiceClient() (verify intent)`);
    }

    if (declared === 'service_role') {
      if (normalized.version !== 2) {
        errors++;
        console.error(`❌ ${fn}: declared "service_role" but key-requirements.json is legacy format. Upgrade to v2 and add a justification.`);
      } else {
        const trimmed = reason.trim();
        if (!trimmed || trimmed.length < 12) {
          errors++;
          console.error(`❌ ${fn}: declared "service_role" but is missing a meaningful reason (min 12 chars).`);
        }
        if (/\bTODO\b|\bTBD\b|\bFIXME\b/i.test(trimmed)) {
          warnings.push(`${fn}: service_role reason contains TODO/TBD/FIXME; replace with a concrete justification.`);
        }
      }
    }

    if ((service || userish) && declared === 'none') {
      console.error(`❌ ${fn}: declared "none" but appears to use Supabase client helpers`);
      errors++;
    }

    if (!service && !userish && declared !== 'none') {
      warnings.push(
        `${fn}: declared "${declared}" but does not appear to use Supabase client helpers (consider "none")`
      );
    }
  }

  for (const w of warnings) warn(w);

  if (errors) {
    die(`Key requirement audit failed with ${errors} error(s).`);
  }

  console.log(`✅ Key requirement audit passed for ${dirs.length} Edge Functions.`);
}

main();
