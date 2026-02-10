import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;

// Canonical client key name: VITE_SUPABASE_ANON_KEY
// Compatibility alias: VITE_SUPABASE_PUBLISHABLE_KEY
const clientKey =
  (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ??
  (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined);

function base64UrlToUint8Array(input: string): Uint8Array {
  const b64 = input.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4;
  const padded = pad ? b64 + '='.repeat(4 - pad) : b64;
  const raw = atob(padded);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

function tryParseJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const json = new TextDecoder().decode(base64UrlToUint8Array(parts[1]));
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function assertClientKeySafe(key: string | undefined) {
  if (!key) return;

  // Modern secret keys have an explicit prefix.
  if (key.startsWith('sb_secret_')) {
    throw new Error(
      'Refusing to initialize Supabase in the browser with a secret key (sb_secret_*). Provide a publishable/anon key.'
    );
  }

  // Legacy service_role keys are JWTs; detect and fail closed if the role claim is service_role.
  const payload = tryParseJwtPayload(key);
  const role = typeof payload?.role === 'string' ? payload.role : null;
  if (role === 'service_role') {
    throw new Error(
      'Refusing to initialize Supabase in the browser with a service_role JWT. Provide an anon/publishable key.'
    );
  }
}

assertClientKeySafe(clientKey);

// Export raw config so other modules can call Supabase Edge Functions via fetch
// (needed for SSE streaming, which is not supported by supabase.functions.invoke).
export const SUPABASE_URL = url ?? '';
export const SUPABASE_ANON_KEY = clientKey ?? '';

// Backwards-compat: some code still imports SUPABASE_PUBLISHABLE_KEY.
export const SUPABASE_PUBLISHABLE_KEY = SUPABASE_ANON_KEY;

// In GitHub Pages + Vite, env vars are injected at build time.
// We expose this flag so the UI can show a clear setup message instead of failing at runtime.
export const isSupabaseConfigured = Boolean(url && clientKey);

if (!isSupabaseConfigured) {
  console.warn(
    'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY (or alias VITE_SUPABASE_PUBLISHABLE_KEY). The app cannot connect to Supabase.'
  );
}

// Use a harmless placeholder when env is missing; the UI should prevent calls in that case.
export const supabase = createClient(
  url ?? 'https://example.supabase.co',
  clientKey ?? 'public-anon-key',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  }
);
