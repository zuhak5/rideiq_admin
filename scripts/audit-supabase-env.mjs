#!/usr/bin/env node
/**
 * Supabase environment selection audit.
 *
 * Goal: prevent accidental deploys to the wrong Supabase project by validating that:
 *  - SUPABASE_PROJECT_REF is set (required for deploy)
 *  - Any *.supabase.(co|in) URLs embedded in supabase/config.toml match SUPABASE_PROJECT_REF
 *  - If SUPABASE_URL is provided, its host-derived project ref matches SUPABASE_PROJECT_REF
 *
 * This is intentionally dependency-free (no TOML parser) and uses best-effort heuristics.
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const CONFIG_TOML = path.join(ROOT, 'supabase', 'config.toml');

function fail(msg) {
  console.error(`\n❌ Supabase env audit failed: ${msg}`);
  process.exit(1);
}

function warn(msg) {
  console.warn(`\n⚠️  Supabase env audit warning: ${msg}`);
}

function projectRefFromSupabaseUrl(url) {
  // Matches: https://<ref>.supabase.co, https://<ref>.supabase.in
  // Also supports function URLs like https://<ref>.supabase.co/functions/v1/...
  const m = url.match(/^https?:\/\/([a-z0-9]{10,})\.supabase\.(co|in)(?:\b|\/)/i);
  return m ? m[1] : null;
}

function scanConfigForRefs(configText) {
  const refs = [];
  const lines = configText.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Find any embedded supabase host in a line.
    const matches = [...line.matchAll(/https?:\/\/([a-z0-9]{10,})\.supabase\.(co|in)\b/gi)];
    for (const match of matches) {
      refs.push({ ref: match[1], lineNo: i + 1, line: line.trim() });
    }
  }
  return refs;
}

function uniq(arr) {
  return [...new Set(arr)];
}

function main() {
  const projectRef = process.env.SUPABASE_PROJECT_REF?.trim();
  if (!projectRef) {
    fail('SUPABASE_PROJECT_REF is required but was not set.');
  }

  const supabaseUrl = process.env.SUPABASE_URL?.trim();
  if (supabaseUrl) {
    const derived = projectRefFromSupabaseUrl(supabaseUrl);
    if (!derived) {
      warn(`SUPABASE_URL did not match expected pattern (https://<ref>.supabase.(co|in)); value="${supabaseUrl}"`);
    } else if (derived !== projectRef) {
      fail(`SUPABASE_URL implies project ref "${derived}" but SUPABASE_PROJECT_REF is "${projectRef}".`);
    }
  } else {
    warn('SUPABASE_URL is not set. Consider setting it in CI to strengthen env mismatch detection.');
  }

  if (!fs.existsSync(CONFIG_TOML)) {
    // This repo should always have this file, but do not hard-fail for non-standard setups.
    warn(`Missing ${path.relative(ROOT, CONFIG_TOML)}; skipping config scan.`);
    return;
  }
  const config = fs.readFileSync(CONFIG_TOML, 'utf8');
  const found = scanConfigForRefs(config);
  if (!found.length) {
    // Acceptable, but uncommon (local-only config).
    console.log('\nSupabase env audit: no *.supabase.(co|in) URLs found in supabase/config.toml');
    return;
  }

  const distinct = uniq(found.map((x) => x.ref));
  if (distinct.length > 1) {
    const lines = found.map((x) => `  - ${x.ref} @ L${x.lineNo}: ${x.line}`).join('\n');
    fail(`supabase/config.toml references multiple Supabase project refs:\n${lines}`);
  }

  const configRef = distinct[0];
  if (configRef !== projectRef) {
    const example = found[0];
    fail(
      `supabase/config.toml references project ref "${configRef}" but SUPABASE_PROJECT_REF is "${projectRef}". ` +
      `(example at L${example.lineNo}: ${example.line})`
    );
  }

  console.log(`\n✅ Supabase env audit OK — project ref: ${projectRef}`);
}

try {
  main();
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  fail(msg);
}
