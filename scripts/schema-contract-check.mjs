#!/usr/bin/env node
/**
 * Quick schema ↔ code contract check:
 * - Verifies all .from('table') references exist in schema
 * - Verifies all .rpc('fn') references exist in schema
 * - Verifies all .functions.invoke('edgeFn') have a folder in supabase/functions
 *
 * This is intentionally conservative and regex-based (no TS AST).
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SCHEMA = path.join(ROOT, 'supabase', 'schema.sql');
const MIGRATIONS_DIR = path.join(ROOT, 'supabase', 'migrations');
const CODE_ROOTS = [
  path.join(ROOT, 'apps'),
  path.join(ROOT, 'admin_dashboard'),
  path.join(ROOT, 'supabase', 'functions'),
];

function readFile(p) {
  return fs.readFileSync(p, 'utf8');
}

const IGNORE_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.next',
  '.turbo',
  '.cache',
]);

function walk(dir, exts) {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.isDirectory() && IGNORE_DIRS.has(ent.name)) continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walk(p, exts));
    else if (exts.some((e) => ent.name.endsWith(e))) out.push(p);
  }
  return out;
}

function parseSchema(sql) {
  const tables = new Set();
  const funcs = new Set();

  for (const m of sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?public\.([a-zA-Z0-9_]+)/gi)) {
    tables.add(m[1].toLowerCase());
  }
  // Treat views as relations for contract checks (code can query views via .from())
  for (const m of sql.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+public\.([a-zA-Z0-9_]+)/gi)) {
    tables.add(m[1].toLowerCase());
  }
  for (const m of sql.matchAll(/CREATE\s+MATERIALIZED\s+VIEW\s+public\.([a-zA-Z0-9_]+)/gi)) {
    tables.add(m[1].toLowerCase());
  }
  for (const m of sql.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.([a-zA-Z0-9_]+)\s*\(/gi)) {
    funcs.add(m[1].toLowerCase());
  }
  return { tables, funcs };
}

function scanCode() {
  const from = [];
  const rpc = [];
  const invoke = [];

  const fileList = [];
  for (const root of CODE_ROOTS) {
    if (fs.existsSync(root)) fileList.push(...walk(root, ['.ts', '.tsx', '.js', '.jsx', '.mjs']));
  }

  const fromRe = /(?<!\.storage)\.from\(\s*['"]([^'"]+)['"]\s*\)/g;
  const rpcRe = /\.rpc\(\s*['"]([^'"]+)['"]/g;
  const invRe = /\.functions\.invoke\(\s*['"]([^'"]+)['"]/g;

  for (const file of fileList) {
    const src = readFile(file);

    for (const m of src.matchAll(fromRe)) from.push({ name: m[1], file });
    for (const m of src.matchAll(rpcRe)) rpc.push({ name: m[1], file });
    for (const m of src.matchAll(invRe)) invoke.push({ name: m[1], file });
  }
  return { from, rpc, invoke };
}

function main() {
  let sql = '';
  if (fs.existsSync(SCHEMA)) sql += '\n\n' + readFile(SCHEMA);

  if (fs.existsSync(MIGRATIONS_DIR)) {
    const migFiles = fs.readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort((a, b) => a.localeCompare(b));

    for (const f of migFiles) {
      sql += '\n\n-- ===== migration: ' + f + ' =====\n';
      sql += readFile(path.join(MIGRATIONS_DIR, f));
    }
  }

  const schema = parseSchema(sql);
  const code = scanCode();

  const errors = [];

  for (const r of code.from) {
    if (!schema.tables.has(r.name.toLowerCase())) {
      errors.push(`Missing table "${r.name}" referenced in ${path.relative(ROOT, r.file)}`);
    }
  }
  for (const r of code.rpc) {
    if (!schema.funcs.has(r.name.toLowerCase())) {
      errors.push(`Missing function "${r.name}" referenced in ${path.relative(ROOT, r.file)}`);
    }
  }

  // NOTE: We intentionally do NOT statically parse GRANT statements for RPC allowlists.
  // This repo applies deny-by-default EXECUTE and re-grants via dynamic SQL in the
  // hardening migration. Correctness is enforced by:
  //  - scripts/generate-security-hardening.mjs --check (CI)
  //  - supabase/tests/005_security_hardening.test.sql (pgTAP)


  // Edge functions: folder name under supabase/functions
  const fnRoot = path.join(ROOT, 'supabase', 'functions');
  const fnDirs = fs.existsSync(fnRoot)
    ? new Set(fs.readdirSync(fnRoot, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name))
    : new Set();

  for (const r of code.invoke) {
    if (!fnDirs.has(r.name)) {
      errors.push(`Missing edge function folder "${r.name}" referenced in ${path.relative(ROOT, r.file)}`);
    }
  }

  if (errors.length) {
    console.error('❌ Schema contract check failed:\n');
    for (const e of errors) console.error(' - ' + e);
    process.exit(1);
  }

  console.log('✅ Schema contract check passed.');
}

main();
