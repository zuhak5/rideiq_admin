const envPermission = 'permissions' in Deno
  ? await Deno.permissions.query({ name: 'env' })
  : { state: 'granted' as const };

const readEnv = (key: string) => (envPermission.state === 'granted' ? Deno.env.get(key) ?? '' : '');

/** Read an environment variable and trim whitespace. */
export function envTrim(key: string): string {
  return readEnv(key).trim();
}

export const SUPABASE_URL = envTrim('SUPABASE_URL');

// Canonical env var names (preferred):
//   - SUPABASE_ANON_KEY (client key: may be sb_publishable_... or legacy anon JWT)
//   - SUPABASE_SERVICE_ROLE_KEY (server key: may be sb_secret_... or legacy service_role JWT)
// Compatibility aliases:
//   - SUPABASE_PUBLISHABLE_KEY -> treated as SUPABASE_ANON_KEY
//   - SUPABASE_SECRET_KEY -> treated as SUPABASE_SERVICE_ROLE_KEY

const RAW_ANON_KEY = envTrim('SUPABASE_ANON_KEY');
const RAW_PUBLISHABLE_KEY = envTrim('SUPABASE_PUBLISHABLE_KEY');
export const SUPABASE_ANON_KEY = RAW_ANON_KEY || RAW_PUBLISHABLE_KEY;
export const SUPABASE_PUBLISHABLE_KEY = SUPABASE_ANON_KEY;

if (!RAW_ANON_KEY && RAW_PUBLISHABLE_KEY) {
  console.warn('[config] Using alias SUPABASE_PUBLISHABLE_KEY; prefer SUPABASE_ANON_KEY for new deployments.');
}

const RAW_SERVICE_ROLE_KEY = envTrim('SUPABASE_SERVICE_ROLE_KEY');
const RAW_SECRET_KEY = envTrim('SUPABASE_SECRET_KEY');
export const SUPABASE_SERVICE_ROLE_KEY = RAW_SERVICE_ROLE_KEY || RAW_SECRET_KEY;
export const SUPABASE_SECRET_KEY = SUPABASE_SERVICE_ROLE_KEY;

if (!RAW_SERVICE_ROLE_KEY && RAW_SECRET_KEY) {
  console.warn(
    '[config] Using alias SUPABASE_SECRET_KEY; prefer SUPABASE_SERVICE_ROLE_KEY for new deployments.'
  );
}

export function requireSupabasePublishable(): { url: string; key: string } {
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    throw new Error(
      '[config] Missing SUPABASE_URL or SUPABASE_ANON_KEY (or alias SUPABASE_PUBLISHABLE_KEY).'
    );
  }
  return { url: SUPABASE_URL, key: SUPABASE_PUBLISHABLE_KEY };
}

export function requireSupabaseSecret(): { url: string; key: string } {
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
    throw new Error(
      '[config] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (or alias SUPABASE_SECRET_KEY).'
    );
  }
  return { url: SUPABASE_URL, key: SUPABASE_SECRET_KEY };
}
