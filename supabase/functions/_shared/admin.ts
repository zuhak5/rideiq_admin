import type { RequestContext } from './requestContext.ts';
import { errorJson } from './json.ts';
import { createUserClient, requireUser } from './supabase.ts';

export type AdminGuardOk = { user: { id: string } };
export type AdminGuardErr = { res: Response };

// Admin routes already sit behind gateway JWT verification, so prefer the
// JWKS-backed guard and avoid a second Auth round-trip that can spuriously 401.
export const adminAuthGuard = requireUser;

function isMissingRpc(err: any): boolean {
  const msg = String(err?.message ?? err ?? '').toLowerCase();
  // PostgREST typically returns a 404-style message for missing RPCs.
  return (
    msg.includes('could not find the function') ||
    msg.includes('not found') ||
    msg.includes('pgrst202') ||
    msg.includes('unknown function')
  );
}

export async function requireAdmin(req: Request, ctx?: RequestContext): Promise<AdminGuardOk | AdminGuardErr> {
  const auth = await adminAuthGuard(req, ctx);
  if (auth.error || !auth.user) {
    return { res: errorJson('Unauthorized', 401, 'UNAUTHORIZED', undefined, ctx?.headers) };
  }

  const userClient = createUserClient(req);
  const { data: isAdmin, error } = await userClient.rpc('is_admin');

  if (error) {
    ctx?.warn('admin.guard.rpc_error', { rpc: 'is_admin', error: error.message });
    return { res: errorJson('Auth check failed', 500, 'AUTH_CHECK_FAILED', undefined, ctx?.headers) };
  }

  if (!isAdmin) {
    return { res: errorJson('Forbidden', 403, 'FORBIDDEN', undefined, ctx?.headers) };
  }

  return { user: auth.user };
}

export async function requirePermission(
  req: Request,
  ctx?: RequestContext,
  permission: string = '',
): Promise<AdminGuardOk | AdminGuardErr> {
  // Always require a valid user JWT.
  const auth = await adminAuthGuard(req, ctx);
  if (auth.error || !auth.user) {
    return { res: errorJson('Unauthorized', 401, 'UNAUTHORIZED', undefined, ctx?.headers) };
  }

  // First: must be an admin.
  const userClient = createUserClient(req);
  const { data: isAdmin, error: adminErr } = await userClient.rpc('is_admin');
  if (adminErr) {
    ctx?.warn('admin.guard.rpc_error', { rpc: 'is_admin', error: adminErr.message });
    return { res: errorJson('Auth check failed', 500, 'AUTH_CHECK_FAILED', undefined, ctx?.headers) };
  }
  if (!isAdmin) {
    return { res: errorJson('Forbidden', 403, 'FORBIDDEN', undefined, ctx?.headers) };
  }

  // Second: permission check (RBAC). If the RPC is not deployed yet, we fall back to "admin".
  const normalized = String(permission ?? '').trim();
  if (!normalized) {
    return { user: auth.user };
  }

  const { data: has, error: permErr } = await userClient.rpc('admin_has_permission', {
    p_permission: normalized,
  });

  if (permErr) {
    if (isMissingRpc(permErr)) {
      ctx?.warn('admin.guard.permission_rpc_missing', { permission: normalized });
      return { user: auth.user };
    }
    ctx?.warn('admin.guard.permission_check_failed', { permission: normalized, error: permErr.message });
    return { res: errorJson('Auth check failed', 500, 'AUTH_CHECK_FAILED', undefined, ctx?.headers) };
  }

  if (!has) {
    return { res: errorJson('Forbidden', 403, 'FORBIDDEN', { permission: normalized }, ctx?.headers) };
  }

  return { user: auth.user };
}
