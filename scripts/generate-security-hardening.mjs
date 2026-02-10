#!/usr/bin/env node
/**
 * Single-source-of-truth generator for DB hardening allowlists.
 *
 * Why:
 *  - DB uses deny-by-default EXECUTE on public functions.
 *  - The app needs a small allowlist of RPCs for anon/authenticated.
 *  - Keeping allowlists in multiple places is error-prone.
 *
 * Source of truth:
 *  - config/security/rpc-allowlist.json
 *
 * Targets:
 *  - supabase/migrations/20260208130000_p0_security_hardening.sql (REQUIRED)
 *    Source of truth for deny-by-default EXECUTE posture.
 *  - supabase/schema.sql (OPTIONAL)
 *    If present AND it contains marker blocks, this generator will update it too.
 *
 * Also keeps pgTAP regression test allowlists in sync:
 *  - supabase/tests/005_security_hardening.test.sql
 *
 * Usage:
 *   node scripts/generate-security-hardening.mjs
 *   node scripts/generate-security-hardening.mjs --check
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const ALLOWLIST_PATH = path.join(ROOT, 'config', 'security', 'rpc-allowlist.json');

// Optional: some repos keep a curated schema.sql with marker blocks.
// In this repo we treat schema.sql as OPTIONAL because it may be a raw pg_dump
// without stable marker anchors.
const SCHEMA_SQL_PATH = path.join(ROOT, 'supabase', 'schema.sql');
// Keep deny-by-default grants in sync for migrations (required).
const MIGRATION_PATH = path.join(ROOT, 'supabase', 'migrations', '20260208130000_p0_security_hardening.sql');
// Security hardening is re-applied as the last migration to avoid accidental re-exposure
// when later migrations create/replace functions.
const MIGRATION_REFRESH_PATH = path.join(
  ROOT,
  'supabase',
  'migrations',
  '20260209145000_security_hardening_refresh.sql'
);
const SECURITY_TEST_PATH = path.join(ROOT, 'supabase', 'tests', '005_security_hardening.test.sql');

function readText(p) {
  // Normalize line endings so `--check` behaves consistently on Windows clones
  // where Git may check out text files with CRLF (core.autocrlf).
  return fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
}

function loadAllowlist() {
  const raw = readText(ALLOWLIST_PATH);
  const parsed = JSON.parse(raw);
  const anon = Array.from(new Set(parsed.anon ?? [])).sort();
  const authenticated = Array.from(new Set(parsed.authenticated ?? [])).sort();
  return { anon, authenticated };
}

function formatSqlStringArray(items, indent = '        ') {
  return items
    .map((n, i) => `${indent}'${n}'${i === items.length - 1 ? '' : ','}`)
    .join('\n');
}

function replaceBlockInText(text, marker, newBody, fileLabel) {
  const begin = `-- BEGIN ${marker}`;
  const end = `-- END ${marker}`;
  const re = new RegExp(`${begin}[\\s\\S]*?${end}`, 'm');
  if (!re.test(text)) {
    throw new Error(`Missing marker block: ${marker} in ${fileLabel}`);
  }
  return text.replace(re, `${begin}\n${newBody}\n${end}`);
}

function hasMarkerBlock(text, marker) {
  return text.includes(`-- BEGIN ${marker}`) && text.includes(`-- END ${marker}`);
}

function buildAnonBlock(anon) {
  return [
    '        -- Generated from config/security/rpc-allowlist.json',
    formatSqlStringArray(anon, '        '),
  ].join('\n');
}

function buildAuthBlock(authenticated) {
  return [
    '        -- Generated from config/security/rpc-allowlist.json',
    formatSqlStringArray(authenticated, '        '),
  ].join('\n');
}

function buildTestList(items) {
  return items
    .map((n, i) => `        '${n}'${i === items.length - 1 ? '' : ','}`)
    .join('\n');
}

function updateTargetFile(targetPath, markerAnon, markerAuth) {
  const label = path.relative(ROOT, targetPath);
  if (!fs.existsSync(targetPath)) {
    return { label, exists: false };
  }

  const { anon, authenticated } = loadAllowlist();
  if (!anon.length) throw new Error('Allowlist anon is empty — refuses to generate.');
  if (!authenticated.length) throw new Error('Allowlist authenticated is empty — refuses to generate.');

  let text = readText(targetPath);

  // If a file exists but lacks marker blocks, treat it as a no-op target.
  // This is primarily to allow schema.sql to be a raw dump.
  if (!hasMarkerBlock(text, markerAnon) || !hasMarkerBlock(text, markerAuth)) {
    return { label, exists: true, skipped: true, nextText: text };
  }

  text = replaceBlockInText(text, markerAnon, buildAnonBlock(anon), label);
  text = replaceBlockInText(text, markerAuth, buildAuthBlock(authenticated), label);

  return { label, exists: true, nextText: text };
}

function generate() {
  if (!fs.existsSync(ALLOWLIST_PATH)) {
    throw new Error(`Missing allowlist: ${ALLOWLIST_PATH}`);
  }
  if (!fs.existsSync(SECURITY_TEST_PATH)) {
    throw new Error(`Missing required test file: ${SECURITY_TEST_PATH}`);
  }
  if (!fs.existsSync(MIGRATION_PATH)) {
    throw new Error(`Missing required migration file: ${MIGRATION_PATH}`);
  }
  if (!fs.existsSync(MIGRATION_REFRESH_PATH)) {
    throw new Error(`Missing required migration file: ${MIGRATION_REFRESH_PATH}`);
  }

  const { anon, authenticated } = loadAllowlist();

  // Update supabase/schema.sql (optional)
  const schemaOut = updateTargetFile(SCHEMA_SQL_PATH, 'RPC_ALLOWLIST_ANON', 'RPC_ALLOWLIST_AUTHENTICATED');

  // Update migration (required)
  const migrationOut = updateTargetFile(MIGRATION_PATH, 'RPC_ALLOWLIST_ANON', 'RPC_ALLOWLIST_AUTHENTICATED');
  if (!migrationOut.exists || migrationOut.skipped) {
    throw new Error(`Missing marker blocks in required migration: ${MIGRATION_PATH}`);
  }

  const refreshOut = updateTargetFile(MIGRATION_REFRESH_PATH, 'RPC_ALLOWLIST_ANON', 'RPC_ALLOWLIST_AUTHENTICATED');
  if (!refreshOut.exists || refreshOut.skipped) {
    throw new Error(`Missing marker blocks in required migration: ${MIGRATION_REFRESH_PATH}`);
  }

  // Update pgTAP test allowlists
  let testSql = readText(SECURITY_TEST_PATH);
  testSql = replaceBlockInText(testSql, 'RPC_ALLOWLIST_ANON_TEST', buildTestList(anon), path.relative(ROOT, SECURITY_TEST_PATH));
  testSql = replaceBlockInText(
    testSql,
    'RPC_ALLOWLIST_AUTHENTICATED_TEST',
    buildTestList(authenticated),
    path.relative(ROOT, SECURITY_TEST_PATH)
  );

  return { schemaOut, migrationOut, refreshOut, testSql };
}

function main() {
  const check = process.argv.includes('--check');
  const next = generate();

  const currentSchema = fs.existsSync(SCHEMA_SQL_PATH) ? readText(SCHEMA_SQL_PATH) : '';
  const currentTest = readText(SECURITY_TEST_PATH);

  const currentMigration = readText(MIGRATION_PATH);
  const currentRefreshMigration = readText(MIGRATION_REFRESH_PATH);

  if (check) {
    const schemaMismatch = next.schemaOut.exists && !next.schemaOut.skipped ? currentSchema !== next.schemaOut.nextText : false;
    const testMismatch = currentTest !== next.testSql;

    const migrationMismatch = currentMigration !== next.migrationOut.nextText;
    const refreshMismatch = currentRefreshMigration !== next.refreshOut.nextText;

    if (schemaMismatch || testMismatch || migrationMismatch || refreshMismatch) {
      console.error('\nFAIL — Security allowlists are out of sync with config/security/rpc-allowlist.json');
      console.error('Run: node scripts/generate-security-hardening.mjs');
      process.exit(1);
    }

    console.log('OK — Security allowlists are in sync (migrations + pgTAP tests)');
    if (next.schemaOut.exists && next.schemaOut.skipped) {
      console.log('NOTE — schema.sql exists but has no marker blocks; skipped (OK).');
    }
    return;
  }

  fs.writeFileSync(SECURITY_TEST_PATH, next.testSql);
  console.log(`Updated: ${path.relative(ROOT, SECURITY_TEST_PATH)}`);

  if (next.schemaOut.exists && !next.schemaOut.skipped) {
    fs.writeFileSync(SCHEMA_SQL_PATH, next.schemaOut.nextText);
    console.log(`Updated: ${path.relative(ROOT, SCHEMA_SQL_PATH)}`);
  }

  fs.writeFileSync(MIGRATION_PATH, next.migrationOut.nextText);
  console.log(`Updated: ${path.relative(ROOT, MIGRATION_PATH)}`);

  fs.writeFileSync(MIGRATION_REFRESH_PATH, next.refreshOut.nextText);
  console.log(`Updated: ${path.relative(ROOT, MIGRATION_REFRESH_PATH)}`);
}

try {
  main();
} catch (e) {
  console.error(`\nGenerator failed: ${(e && e.message) || e}`);
  process.exit(2);
}
