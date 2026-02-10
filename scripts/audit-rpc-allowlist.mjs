#!/usr/bin/env node
/**
 * RPC allowlist audit (static).
 *
 * Goal:
 *  - Prevent runtime breakage after hardening DB function EXECUTE grants.
 *  - Ensure any `.rpc('name')` used by the web client is present in the
 *    allowlist re-grants inside the hardening migration.
 *
 * This is a best-effort static check.
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const ALLOWLIST = path.join(ROOT, 'config', 'security', 'rpc-allowlist.json');

function readText(p) {
  return fs.readFileSync(p, 'utf8');
}

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    // Ignore build artifacts and dependency trees. This audit should only scan source files.
    if (
      ent.name === 'node_modules' ||
      ent.name === '.supabase' ||
      ent.name === 'dist' ||
      ent.name === 'build' ||
      ent.name === '.next' ||
      ent.name === '.swc' ||
      ent.name === '.turbo' ||
      ent.name === 'coverage' ||
      ent.name === 'playwright-report'
    ) {
      continue;
    }
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

function extractUsedRpcNames(files) {
  const names = new Set();
  const rpcRe = /\.rpc\(\s*['"]([a-zA-Z0-9_]+)['"]/g;
  for (const f of files) {
    if (!/\.(ts|tsx|js|jsx)$/.test(f)) continue;
    const text = readText(f);
    let m;
    while ((m = rpcRe.exec(text))) {
      names.add(m[1]);
    }
  }
  return names;
}

function loadAllowlist() {
  if (!fs.existsSync(ALLOWLIST)) {
    throw new Error(`Missing allowlist: ${ALLOWLIST}`);
  }
  const parsed = JSON.parse(readText(ALLOWLIST));
  return {
    anon: new Set(parsed.anon ?? []),
    authenticated: new Set(parsed.authenticated ?? []),
  };
}

function isFrontendFile(p) {
  return (
    p.includes(`${path.sep}apps${path.sep}web${path.sep}`) ||
    p.includes(`${path.sep}admin_dashboard${path.sep}`)
  );
}

function isEdgeFunctionFile(p) {
  return p.includes(`${path.sep}supabase${path.sep}functions${path.sep}`);
}

function main() {
  const allow = loadAllowlist();

  const allFiles = walk(ROOT);
  const frontendFiles = allFiles.filter(isFrontendFile);
  const edgeFiles = allFiles.filter(isEdgeFunctionFile);

  const frontendRpc = extractUsedRpcNames(frontendFiles);
  const edgeRpc = extractUsedRpcNames(edgeFiles);

  const failures = [];
  const warnings = [];

  // Frontend RPCs must be callable either by anon or authenticated.
  for (const n of frontendRpc) {
    if (!allow.anon.has(n) && !allow.authenticated.has(n)) {
      failures.push({
        name: n,
        reason: 'RPC used in web client but missing from config/security/rpc-allowlist.json (and therefore not granted in DB hardening migration).',
      });
    }
  }

  // Edge functions usually run as service_role, so they can call anything.
  // But if an Edge function uses a user client (auth token) and calls RPC,
  // it will need authenticated EXECUTE. We can’t prove which client is used
  // statically, so we warn if the RPC is not in authenticated allowlist.
  for (const n of edgeRpc) {
    if (!allow.authenticated.has(n) && !allow.anon.has(n)) {
      warnings.push({
        name: n,
        reason: 'RPC used in Edge Functions but not in allowlist. If this call is made with user JWT (not service_role), it will fail.',
      });
    }
  }

  // Warn on allowlisted RPCs that are not referenced anywhere in code.
  const usedAll = new Set([...frontendRpc, ...edgeRpc]);
  for (const n of allow.anon) {
    if (!usedAll.has(n)) warnings.push({ name: n, reason: 'Allowlisted for anon but not referenced in code (review if still needed).' });
  }
  for (const n of allow.authenticated) {
    if (!usedAll.has(n)) warnings.push({ name: n, reason: 'Allowlisted for authenticated but not referenced in code (review if still needed).' });
  }

  console.log(`\nRPC allowlist audit:`);
  console.log(`  - Frontend RPCs found: ${frontendRpc.size}`);
  console.log(`  - Edge RPCs found:     ${edgeRpc.size}`);
  console.log(`  - Allowlist anon:      ${allow.anon.size}`);
  console.log(`  - Allowlist auth:      ${allow.authenticated.size}`);

  if (warnings.length) {
    console.log(`\nWarnings (${warnings.length}):`);
    for (const w of warnings) console.log(`  - ${w.name}: ${w.reason}`);
  }

  if (failures.length) {
    console.error(`\nFAIL (${failures.length}) — fix before merging:`);
    for (const f of failures) console.error(`  - ${f.name}: ${f.reason}`);
    process.exit(1);
  }

  console.log(`\nOK — RPC allowlist matches web usage.`);
}

try {
  main();
} catch (e) {
  console.error(`\nRPC allowlist audit crashed: ${(e && e.message) || e}`);
  process.exit(2);
}
