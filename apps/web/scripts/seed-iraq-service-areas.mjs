/**
 * Robust Iraq COD-AB seeder (ADM3 sub-districts by default).
 *
 * Fixes missing governorates by:
 *  - merging ALL GeoJSON/JSON FeatureCollections in the ZIP (avoids picking partial layers)
 *  - resolving target ADM1 PCODES using both English + Arabic name fields + aliases
 *  - filtering by ADM1 PCODE (stable key) rather than fragile name matching
 *
 * Required env:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY (preferred; may be `sb_secret_...` or legacy `service_role` JWT)
 *     -or-
 *   SUPABASE_SECRET_KEY (alias)
 *
 * Optional env:
 *   CODAB_DATASET_ID=cod-ab-irq
 *   CODAB_RESOURCE_ID=<uuid>   // force a specific resource
 *   SEED_ADMIN_LEVEL=3         // 1=ADM1 governorates, 2=ADM2 districts, 3=ADM3 sub-districts (default 3)
 *   DRY_RUN=1                  // logs only
 *   PRICING_CONFIG_ID=<uuid>   // force pricing config; else auto-pick default active
 *   CASH_STEP_IQD=250
 *   CASH_STEP_BAGHDAD=250, CASH_STEP_BABIL=..., etc
 *   TARGET_ADM1_PCODES="IQGxx,IQGyy,..." // optional hard-lock
 */

import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

const required = ['SUPABASE_URL'];
for (const k of required) {
  if (!process.env[k]) {
    console.error(`Missing env var: ${k}`);
    process.exit(1);
  }
}

const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing env var: SUPABASE_SERVICE_ROLE_KEY (or alias SUPABASE_SECRET_KEY)');
  process.exit(1);
}

const SUPABASE_URL = process.env.SUPABASE_URL;

if (SUPABASE_SERVICE_ROLE_KEY.startsWith('sb_publishable_')) {
  console.error('Refusing to run: SUPABASE_SERVICE_ROLE_KEY looks like a publishable key (sb_publishable_...).');
  process.exit(1);
}

const DATASET_ID = process.env.CODAB_DATASET_ID || 'cod-ab-irq';
const FORCED_RESOURCE_ID = process.env.CODAB_RESOURCE_ID || null;

const SEED_ADMIN_LEVEL = Number(process.env.SEED_ADMIN_LEVEL || 3);
if (![1, 2, 3].includes(SEED_ADMIN_LEVEL)) {
  console.error(`SEED_ADMIN_LEVEL must be 1, 2, or 3 (got ${SEED_ADMIN_LEVEL})`);
  process.exit(1);
}

const DRY_RUN = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';
const DEFAULT_CASH_STEP = Math.trunc(Number(process.env.CASH_STEP_IQD || 250));

// Default priorities ensure more granular polygons win when multiple areas overlap.
// resolve_service_area() orders by priority DESC. (See supabase/schema.sql)
const PRIORITY_ADM1 = Number(process.env.PRIORITY_ADM1 || 10);
const PRIORITY_ADM2 = Number(process.env.PRIORITY_ADM2 || 20);
const PRIORITY_ADM3 = Number(process.env.PRIORITY_ADM3 || 30);

// Canonical names used by the app.
const TARGET_GOVS = ['Baghdad', 'Babil', 'Al-Qadisiyyah', 'Najaf', 'Muthanna', 'Karbala'];

function norm(s) {
  return String(s ?? '')
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[`´’'"]/g, '')
    .replace(/-/g, ' ')
    .replace(/\b(governorate|province)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function pickProp(props, keys) {
  for (const k of keys) {
    if (
      props &&
      Object.prototype.hasOwnProperty.call(props, k) &&
      props[k] != null &&
      String(props[k]).trim() !== ''
    ) {
      return props[k];
    }
  }
  return null;
}

// Expanded aliasing: Al-Qadisiyyah is often labeled as "Al-Diwaniyah".
const GOV_ALIASES = new Map([
  ['Baghdad', new Set(['baghdad', 'بغداد'])],
  ['Babil', new Set(['babil', 'babylon', 'بابل'])],
  [
    'Al-Qadisiyyah',
    new Set([
      'al qadisiyyah',
      'al qadisiyah',
      'qadisiyyah',
      'qadisiyah',
      'al qadisiyya',
      'qadisiyya',
      // Alternate label
      'al diwaniyah',
      'diwaniyah',
      'diwaniya',
      // Arabic
      'القادسية',
      'الديوانية',
    ]),
  ],
  ['Najaf', new Set(['najaf', 'an najaf', 'al najaf', 'النجف'])],
  ['Muthanna', new Set(['muthanna', 'al muthanna', 'al muthana', 'المثنى'])],
  ['Karbala', new Set(['karbala', 'karbalaa', 'kerbala', 'كربلاء', 'كربلا'])],
]);

function canonicalGovFromAnyName(maybeName) {
  const n = norm(maybeName);
  for (const [canon, set] of GOV_ALIASES.entries()) {
    if (set.has(n)) return canon;
  }
  return null;
}

function cashStepForGov(canonGov) {
  const key = `CASH_STEP_${canonGov.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
  const v = process.env[key];
  if (!v) return DEFAULT_CASH_STEP;
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_CASH_STEP;
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return await res.json();
}

async function download(url, outFile) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.writeFile(outFile, buf);
}

function resourceIsGeoCandidate(r) {
  const fmt = String(r.format ?? '').toLowerCase();
  const url = String(r.url ?? '').toLowerCase();
  return (
    r.url &&
    (fmt.includes('geojson') ||
      url.endsWith('.geojson') ||
      url.endsWith('.json') ||
      url.endsWith('.zip'))
  );
}

function resourceSort(a, b) {
  const aGeo =
    String(a.format ?? '').toLowerCase().includes('geojson') ||
    String(a.url ?? '').toLowerCase().endsWith('.geojson');
  const bGeo =
    String(b.format ?? '').toLowerCase().includes('geojson') ||
    String(b.url ?? '').toLowerCase().endsWith('.geojson');
  if (aGeo !== bGeo) return aGeo ? -1 : 1;
  return String(b.last_modified ?? '').localeCompare(String(a.last_modified ?? ''));
}

async function discoverCodabResource() {
  const pkg = await fetchJson(
    `https://data.humdata.org/api/3/action/package_show?id=${encodeURIComponent(DATASET_ID)}`,
  );
  if (!pkg?.success) throw new Error(`CKAN package_show failed for ${DATASET_ID}`);

  const resources = (pkg.result?.resources ?? [])
    .map((r) => ({
      id: r.id,
      name: r.name,
      format: String(r.format ?? ''),
      url: r.url,
      last_modified: r.last_modified,
    }))
    .filter(resourceIsGeoCandidate)
    .sort(resourceSort);

  if (FORCED_RESOURCE_ID) {
    const forced = resources.find((r) => r.id === FORCED_RESOURCE_ID);
    if (!forced) throw new Error(`CODAB_RESOURCE_ID ${FORCED_RESOURCE_ID} not found`);
    return forced;
  }

  if (resources.length === 0) {
    throw new Error(`No GeoJSON/ZIP resources found in dataset ${DATASET_ID}`);
  }
  return resources[0];
}

/**
 * Load geojson:
 * - If ZIP: unzip, parse ALL .geojson/.json FeatureCollections, merge features.
 * - If single: parse as JSON.
 */
async function loadAndMergeGeojson(resource) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codab-irq-'));
  const url = resource.url;
  const outPath = path.join(
    tmpDir,
    path.basename(new URL(url).pathname) || `codab_${resource.id}`,
  );

  await download(url, outPath);

  const merged = { type: 'FeatureCollection', features: [] };
  const addFC = (fc) => {
    if (!fc || fc.type !== 'FeatureCollection' || !Array.isArray(fc.features)) return;
    merged.features.push(...fc.features);
  };

  if (outPath.toLowerCase().endsWith('.zip')) {
    execFileSync('unzip', ['-q', outPath, '-d', tmpDir], { stdio: 'inherit' });
    const entries = await fs.readdir(tmpDir, { recursive: true });
    const jsonFiles = entries
      .map((e) => String(e))
      .filter((f) => f.toLowerCase().endsWith('.geojson') || f.toLowerCase().endsWith('.json'));

    if (jsonFiles.length === 0) throw new Error(`ZIP had no .geojson/.json files: ${url}`);

    for (const rel of jsonFiles) {
      const p = path.join(tmpDir, rel);
      try {
        const fc = JSON.parse(await fs.readFile(p, 'utf8'));
        addFC(fc);
      } catch {
        // ignore
      }
    }
  } else {
    addFC(JSON.parse(await fs.readFile(outPath, 'utf8')));
  }

  if (merged.features.length === 0) throw new Error('No features loaded from COD-AB resource');
  return merged;
}

async function resolvePricingConfigId(supabase) {
  if (process.env.PRICING_CONFIG_ID) return process.env.PRICING_CONFIG_ID;

  const def = await supabase
    .from('pricing_configs')
    .select('id')
    .eq('is_default', true)
    .eq('active', true)
    .order('effective_from', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (def.error) throw def.error;
  if (def.data?.id) return def.data.id;

  const any = await supabase
    .from('pricing_configs')
    .select('id')
    .eq('active', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (any.error) throw any.error;
  if (any.data?.id) return any.data.id;

  throw new Error('No active pricing config found. Create one in Admin → Pricing first.');
}

function resolveTargetsByPcode(geojson) {
  const pcodeToCanon = new Map();
  const canonToPcode = new Map();
  const catalog = new Map();

  for (const f of geojson.features) {
    const p = f.properties ?? {};
    const adm1Pcode = pickProp(p, ['adm1_pcode', 'ADM1_PCODE']);
    if (!adm1Pcode) continue;

    const adm1En = pickProp(p, ['adm1_name', 'ADM1_EN', 'ADM1', 'adm1_ref_n']);
    const adm1Ar = pickProp(p, ['adm1_name1']);
    if (!catalog.has(String(adm1Pcode))) {
      catalog.set(String(adm1Pcode), { en: adm1En ?? null, ar: adm1Ar ?? null });
    }

    const canon = canonicalGovFromAnyName(adm1En) || canonicalGovFromAnyName(adm1Ar) || null;
    if (canon && !canonToPcode.has(canon)) {
      canonToPcode.set(canon, String(adm1Pcode));
      pcodeToCanon.set(String(adm1Pcode), canon);
    } else if (canon) {
      pcodeToCanon.set(String(adm1Pcode), canon);
    }
  }

  const envPcodes = process.env.TARGET_ADM1_PCODES
    ? process.env.TARGET_ADM1_PCODES.split(',').map((s) => s.trim()).filter(Boolean)
    : null;

  const targetPcodes = envPcodes?.length
    ? new Set(envPcodes)
    : new Set(TARGET_GOVS.map((g) => canonToPcode.get(g)).filter(Boolean));

  const missing = TARGET_GOVS.filter((g) => !canonToPcode.get(g));

  return { targetPcodes, pcodeToCanon, canonToPcode, catalog, missing };
}

function uniqKeyADM2(p) {
  return String(p?.adm2_pcode ?? p?.ADM2_PCODE ?? '');
}

function uniqKeyADM3(p) {
  return String(p?.adm3_pcode ?? p?.ADM3_PCODE ?? '');
}

async function main() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const pricingConfigId = await resolvePricingConfigId(supabase);
  console.log(`Using pricing_config_id=${pricingConfigId}`);
  console.log(`SEED_ADMIN_LEVEL=ADM${SEED_ADMIN_LEVEL} DRY_RUN=${DRY_RUN ? '1' : '0'}`);

  const resource = await discoverCodabResource();
  console.log(`COD-AB resource: ${resource.name} (${resource.format})`);
  console.log(`Downloading: ${resource.url}`);

  const geojson = await loadAndMergeGeojson(resource);
  const { targetPcodes, pcodeToCanon, catalog, missing } = resolveTargetsByPcode(geojson);

  if (missing.length) {
    console.warn(`[warn] Missing governorate resolution for: ${missing.join(', ')}`);
    console.warn('[warn] ADM1 catalog sample (pcode -> en | ar):');
    console.warn(
      [...catalog.entries()]
        .slice(0, 60)
        .map(([pc, v]) => `- ${pc} -> ${v.en ?? '?'} | ${v.ar ?? '?'}`)
        .join('\n'),
    );
    console.warn('[warn] You can hard-lock with TARGET_ADM1_PCODES="..." if needed.');
  }

  console.log(`Target ADM1 PCODES: ${[...targetPcodes].join(', ')}`);

  if (!targetPcodes || targetPcodes.size === 0) {
    throw new Error('No target ADM1 PCODES resolved. Use TARGET_ADM1_PCODES override.');
  }

  let total = 0;
  let matchedAdm1 = 0;
  let matchedLevel = 0;
  let upserted = 0;

  const seenAdm2 = new Set();
  const seenAdm3 = new Set();

  // Prevent rare name collisions (e.g., repeated subdistrict names) from incorrectly upserting.
  // We keep names human-friendly, only appending P-code when necessary.
  const seenNamesByGov = new Map(); // governorate -> Set(normalizedName)

  for (const f of geojson.features) {
    total++;
    const p = f.properties ?? {};

    const adm1Pcode = pickProp(p, ['adm1_pcode', 'ADM1_PCODE']);
    if (!adm1Pcode || !targetPcodes.has(String(adm1Pcode))) continue;
    matchedAdm1++;

    const canonGov = pcodeToCanon.get(String(adm1Pcode)) || 'Unknown';
    const geom = f.geometry;
    if (!geom) continue;

    if (SEED_ADMIN_LEVEL === 1) {
      const adm2Pcode = pickProp(p, ['adm2_pcode', 'ADM2_PCODE']);
      const adm3Pcode = pickProp(p, ['adm3_pcode', 'ADM3_PCODE']);
      if (adm2Pcode || adm3Pcode) continue;
      matchedLevel++;

      const name = `${canonGov} (ADM1)`;
      const cashStep = cashStepForGov(canonGov);
      const priority = Number.isFinite(PRIORITY_ADM1) ? PRIORITY_ADM1 : 10;

      if (DRY_RUN) {
        console.log(`[dry-run] upsert ADM1 ${name} priority=${priority} cash_step=${cashStep}`);
        continue;
      }

      const { error } = await supabase.rpc('admin_upsert_service_area_geojson_v1', {
        p_name: name,
        p_governorate: canonGov,
        p_geojson: geom,
        p_priority: priority,
        p_is_active: true,
        p_pricing_config_id: pricingConfigId,
        p_min_base_fare_iqd: null,
        p_surge_multiplier: 1.0,
        p_surge_reason: null,
        p_cash_rounding_step_iqd: cashStep,
      });
      if (error) console.error(`Failed upserting ${name}:`, error);
      else upserted++;
      continue;
    }

    if (SEED_ADMIN_LEVEL === 2) {
      // ADM2 districts only
      const adm2Name =
        pickProp(p, ['adm2_name', 'ADM2_EN', 'ADM2']) || pickProp(p, ['adm2_name1']) || null;
      const adm2Pcode = pickProp(p, ['adm2_pcode', 'ADM2_PCODE']);
      const adm3Pcode = pickProp(p, ['adm3_pcode', 'ADM3_PCODE']);
      if (!adm2Name || !adm2Pcode) continue;
      if (adm3Pcode) continue;
      matchedLevel++;

      const k = uniqKeyADM2(p);
      if (k) {
        if (seenAdm2.has(k)) continue;
        seenAdm2.add(k);
      }

      const priority = Number.isFinite(PRIORITY_ADM2) ? PRIORITY_ADM2 : 20;
      const cashStep = cashStepForGov(canonGov);
      const baseName = `${canonGov} / ${String(adm2Name).trim()}`;
      const normalized = norm(baseName);
      const set = seenNamesByGov.get(canonGov) ?? new Set();
      seenNamesByGov.set(canonGov, set);
      const name = set.has(normalized) ? `${baseName} (${String(adm2Pcode).trim()})` : baseName;
      set.add(norm(name));

      if (DRY_RUN) {
        console.log(`[dry-run] upsert ADM2 ${name} priority=${priority} cash_step=${cashStep}`);
        continue;
      }

      const { error } = await supabase.rpc('admin_upsert_service_area_geojson_v1', {
        p_name: name,
        p_governorate: canonGov,
        p_geojson: geom,
        p_priority: priority,
        p_is_active: true,
        p_pricing_config_id: pricingConfigId,
        p_min_base_fare_iqd: null,
        p_surge_multiplier: 1.0,
        p_surge_reason: null,
        p_cash_rounding_step_iqd: cashStep,
      });

      if (error) console.error(`Failed upserting ${name}:`, error);
      else upserted++;
      continue;
    }

    // SEED_ADMIN_LEVEL === 3: ADM3 sub-districts (areas)
    const adm2Name =
      pickProp(p, ['adm2_name', 'ADM2_EN', 'ADM2']) || pickProp(p, ['adm2_name1']) || null;
    const adm3Name =
      pickProp(p, ['adm3_name', 'ADM3_EN', 'ADM3']) || pickProp(p, ['adm3_name1']) || null;
    const adm3Pcode = pickProp(p, ['adm3_pcode', 'ADM3_PCODE']);
    if (!adm3Name || !adm3Pcode) continue;
    matchedLevel++;

    const k3 = uniqKeyADM3(p);
    if (k3) {
      if (seenAdm3.has(k3)) continue;
      seenAdm3.add(k3);
    }

    const priority = Number.isFinite(PRIORITY_ADM3) ? PRIORITY_ADM3 : 30;
    const cashStep = cashStepForGov(canonGov);

    // Name strategy: governorate / district / subdistrict. Append P-code only when needed.
    const baseName = `${canonGov} / ${String(adm2Name ?? 'Unknown District').trim()} / ${String(
      adm3Name,
    ).trim()}`;
    const set = seenNamesByGov.get(canonGov) ?? new Set();
    seenNamesByGov.set(canonGov, set);
    const normalized = norm(baseName);
    const name = set.has(normalized)
      ? `${baseName} (${String(adm3Pcode).trim()})`
      : baseName;
    set.add(norm(name));

    if (DRY_RUN) {
      console.log(`[dry-run] upsert ADM3 ${name} priority=${priority} cash_step=${cashStep}`);
      continue;
    }

    const { error } = await supabase.rpc('admin_upsert_service_area_geojson_v1', {
      p_name: name,
      p_governorate: canonGov,
      p_geojson: geom,
      p_priority: priority,
      p_is_active: true,
      p_pricing_config_id: pricingConfigId,
      p_min_base_fare_iqd: null,
      p_surge_multiplier: 1.0,
      p_surge_reason: null,
      p_cash_rounding_step_iqd: cashStep,
    });

    if (error) console.error(`Failed upserting ${name}:`, error);
    else upserted++;
  }

  console.log(`GeoJSON features total=${total}`);
  console.log(`Matched target ADM1 PCODE features=${matchedAdm1}`);
  console.log(`Matched admin level (ADM${SEED_ADMIN_LEVEL})=${matchedLevel}`);
  console.log(`Upserted=${upserted}`);
  console.log('Done.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
