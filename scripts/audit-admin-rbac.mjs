/*
  Admin RBAC contract auditor

  Fails CI if:
    - code references an unknown permission key
    - docs/rbac.permissions.json lists pages/functions that don't exist
    - a page/function spec claims a required permission but the file doesn't reference it

  This is intentionally lightweight (regex-based) to keep CI fast.
*/

import fs from 'fs';
import path from 'path';

const repoRoot = process.cwd();

const specPath = path.join(repoRoot, 'docs', 'rbac.permissions.json');
const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));

const definedPerms = new Set((spec.permissions ?? []).map((p) => p.key));

function fail(msg) {
  console.error(`\n[rbac:audit] ${msg}`);
  process.exitCode = 1;
}

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

function readIfExists(p) {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}

function routeToPageFile(route) {
  const segs = route
    .split('/')
    .filter(Boolean)
    .map((s) => (s.startsWith(':') ? `[${s.slice(1)}]` : s));

  const rel = segs.length ? segs.join(path.sep) : '';
  return path.join(repoRoot, 'admin_dashboard', 'src', 'app', '(protected)', rel, 'page.tsx');
}

function edgeFunctionToFile(name) {
  return path.join(repoRoot, 'supabase', 'functions', name, 'index.ts');
}

// Some routed Edge Functions (e.g., admin-api) keep the router map in a separate file.
// The auditor is intentionally regex-based, so we support both layouts:
//  - index.ts contains route strings inline
//  - router.ts contains route strings and index.ts delegates to it
function edgeFunctionRouterFile(name) {
  return path.join(repoRoot, 'supabase', 'functions', name, 'router.ts');
}

function edgeFunctionRouteToFile(fnName, routePath) {
  return path.join(repoRoot, 'supabase', 'functions', fnName, 'routes', `${routePath}.ts`);
}


function extractPermissions(text) {
  const perms = new Set();
  if (!text) return perms;

  const patterns = [
    /requirePermission\(\s*'([^']+)'/g,
    /ctx\.can\(\s*'([^']+)'/g,
    /requires:\s*'([^']+)'/g,
    /requirePermission\([^\n]*,\s*ctx,\s*'([^']+)'/g,
  ];

  for (const re of patterns) {
    let m;
    while ((m = re.exec(text))) {
      perms.add(m[1]);
    }
  }
  return perms;
}

// 1) Spec sanity
for (const p of spec.permissions ?? []) {
  if (!p.key || typeof p.key !== 'string') fail(`Invalid permission entry: ${JSON.stringify(p)}`);
}

for (const r of spec.roles ?? []) {
  for (const k of r.grants ?? []) {
    if (k !== '*' && !definedPerms.has(k)) {
      fail(`Role '${r.key}' grants unknown permission '${k}' (not in permissions list)`);
    }
  }
}

// 2) Spec -> file existence & in-file references
for (const page of spec.pages ?? []) {
  if (!definedPerms.has(page.requires)) {
    fail(`Page '${page.route}' requires unknown permission '${page.requires}'`);
    continue;
  }
  const file = routeToPageFile(page.route);
  const txt = readIfExists(file);
  if (!txt) {
    fail(`Page '${page.route}' file missing: ${path.relative(repoRoot, file)}`);
    continue;
  }
  if (!txt.includes(`'${page.requires}'`) && !txt.includes(`"${page.requires}"`)) {
    fail(`Page '${page.route}' does not reference required permission '${page.requires}' in ${path.relative(repoRoot, file)}`);
  }
}

for (const fn of spec.edge_functions ?? []) {
  // New (routed) edge function schema:
  // { name: 'admin-api', routes: [{ path: 'admin-users-list', requires: 'users.read' }, ...] }
  if (fn && typeof fn === 'object' && Array.isArray(fn.routes)) {
    const fnName = fn.name;
    if (!fnName || typeof fnName !== 'string') {
      fail(`Invalid edge function entry: ${JSON.stringify(fn)}`);
      continue;
    }

    const indexFile = edgeFunctionToFile(fnName);
    const indexTxt = readIfExists(indexFile);
    if (!indexTxt) {
      fail(`Edge function '${fnName}' file missing: ${path.relative(repoRoot, indexFile)}`);
      continue;
    }

    const routerFile = edgeFunctionRouterFile(fnName);
    const routerTxt = readIfExists(routerFile);

    for (const r of fn.routes) {
      if (!r || typeof r !== 'object') {
        fail(`Invalid edge function route entry for '${fnName}': ${JSON.stringify(r)}`);
        continue;
      }
      const routePath = r.path;
      const requires = r.requires;

      if (typeof routePath !== 'string' || !routePath) {
        fail(`Edge function '${fnName}' route has invalid path: ${JSON.stringify(r)}`);
        continue;
      }
      if (typeof requires !== 'string' || !requires) {
        fail(`Edge function '${fnName}' route '${routePath}' has invalid requires: ${JSON.stringify(r)}`);
        continue;
      }
      if (!definedPerms.has(requires)) {
        fail(`Edge function '${fnName}' route '${routePath}' requires unknown permission '${requires}'`);
        continue;
      }

      // Router should declare the route string.
      const declaredInIndex = indexTxt.includes(`'${routePath}'`) || indexTxt.includes(`"${routePath}"`);
      const declaredInRouter = routerTxt ? (routerTxt.includes(`'${routePath}'`) || routerTxt.includes(`"${routePath}"`)) : false;
      if (!declaredInIndex && !declaredInRouter) {
        const where = routerTxt
          ? `${path.relative(repoRoot, indexFile)} or ${path.relative(repoRoot, routerFile)}`
          : path.relative(repoRoot, indexFile);
        fail(`Edge function '${fnName}' router does not declare route '${routePath}' in ${where}`);
      }

      const routeFile = edgeFunctionRouteToFile(fnName, routePath);
      const routeTxt = readIfExists(routeFile);
      if (!routeTxt) {
        fail(`Edge function '${fnName}' route file missing: ${path.relative(repoRoot, routeFile)}`);
        continue;
      }
      if (!routeTxt.includes(`'${requires}'`) && !routeTxt.includes(`"${requires}"`)) {
        fail(
          `Edge function '${fnName}' route '${routePath}' does not reference required permission '${requires}' in ${path.relative(repoRoot, routeFile)}`,
        );
      }
    }
    continue;
  }

  // Legacy schema:
  // { name: 'admin-users-list', requires: 'users.read' }
  if (!definedPerms.has(fn.requires)) {
    fail(`Edge function '${fn.name}' requires unknown permission '${fn.requires}'`);
    continue;
  }
  const file = edgeFunctionToFile(fn.name);
  const txt = readIfExists(file);
  if (!txt) {
    fail(`Edge function '${fn.name}' file missing: ${path.relative(repoRoot, file)}`);
    continue;
  }
  if (!txt.includes(`'${fn.requires}'`) && !txt.includes(`"${fn.requires}"`)) {
    fail(
      `Edge function '${fn.name}' does not reference required permission '${fn.requires}' in ${path.relative(repoRoot, file)}`,
    );
  }
}


// 3) Code -> unknown permission references
const adminFiles = [
  ...walk(path.join(repoRoot, 'admin_dashboard', 'src')).filter((p) => /\.(ts|tsx)$/.test(p)),
  ...walk(path.join(repoRoot, 'supabase', 'functions')).filter((p) => /\.(ts)$/.test(p)),
];

const usedPerms = new Set();
for (const f of adminFiles) {
  const txt = readIfExists(f);
  for (const p of extractPermissions(txt)) usedPerms.add(p);
}

for (const p of usedPerms) {
  if (p === '*' || p === '') continue;
  if (!definedPerms.has(p)) {
    fail(`Code references unknown permission '${p}' (not in docs/rbac.permissions.json)`);
  }
}

if (!process.exitCode) {
  console.log('[rbac:audit] OK');
}
