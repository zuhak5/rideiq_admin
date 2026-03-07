import { createClient } from 'npm:@supabase/supabase-js@2.92.0';
import { requireSupabasePublishable, requireSupabaseSecret } from './config.ts';

const baseClientOptions = {
  auth: {
    // Edge Functions are stateless: never persist or auto-refresh sessions.
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
};

function extractBearerToken(req: Request): string | null {
  const authHeader = req.headers.get('Authorization') ?? '';
  const raw = authHeader.toLowerCase().startsWith('bearer ')
    ? authHeader.slice('bearer '.length).trim()
    : authHeader.trim();
  return raw ? raw : null;
}

/**
 * Public client (least privilege). Uses the project publishable key.
 *
 * NOTE: The publishable key is safe to be exposed to clients, but we still
 * do not log it.
 */
export function createPublicClient() {
  const { url, key } = requireSupabasePublishable();
  return createClient(url, key, baseClientOptions);
}

/**
 * Per-request client for RLS-scoped queries.
 *
 * Legacy name: `createAnonClient`.
 */
export function createUserClient(req: Request) {
  const { url, key } = requireSupabasePublishable();
  const token = extractBearerToken(req);
  if (!token) return createClient(url, key, baseClientOptions);

  // Best practice for passing JWTs into the client lib is the `accessToken` option.
  // (Avoids confusing or leaking auth headers between requests.)
  return createClient(url, key, {
    ...baseClientOptions,
    accessToken: async () => token,
  });
}

/** @deprecated Use createUserClient(req) */
export function createAnonClient(req: Request) {
  return createUserClient(req);
}

export function createServiceClient() {
  const { url, key } = requireSupabaseSecret();
  return createClient(url, key, baseClientOptions);
}

/**
 * Fast auth guard: verifies the JWT locally using JWKS (cached) via getClaims().
 *
 * This does NOT check server-side session revocation. Use requireUserStrict() for
 * endpoints that must be robust to logout/session invalidation.
 */
type RequestCtxLike = { setUserId: (userId: string) => void };

export async function requireUser(req: Request, ctx?: RequestCtxLike) {
  const token = extractBearerToken(req);
  if (!token) {
    return { user: null, error: 'Missing authorization token' } as const;
  }

  // Fast-path: local JWT verification using JWKS when asymmetric signing keys are enabled.
  // Use a public client and pass the token to getClaims to avoid accessToken auth proxies.
  const supabase = createPublicClient();
  const { data, error } = await supabase.auth.getClaims(token);
  if (error || !data?.claims) {
    // Fallback to network-backed verification for compatibility / older projects.
    return await requireUserStrict(req, ctx);
  }

  const userId = String((data.claims as any).sub ?? '');
  if (!userId) {
    return { user: null, error: 'Unauthorized' } as const;
  }

  // Most of our edge endpoints only require the user ID. If you need fully
  // authoritative user state, use requireUserStrict() instead.
  try {
    ctx?.setUserId(userId);
  } catch {
    // ignore
  }
  return { user: { id: userId } as any, error: null } as const;
}

/**
 * Strict auth guard: validates JWT via the Auth server (network request).
 *
 * This is slower but authoritative (can reflect server-side session invalidation).
 */
export async function requireUserStrict(req: Request, ctx?: RequestCtxLike) {
  const token = extractBearerToken(req);
  if (!token) {
    return { user: null, error: 'Missing authorization token' } as const;
  }

  const supabase = createPublicClient();
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) {
    return { user: null, error: error?.message ?? 'Unauthorized' } as const;
  }
  try {
    if (data.user?.id) ctx?.setUserId(data.user.id);
  } catch {
    // ignore
  }
  return { user: data.user, error: null } as const;
}
