import { redirect } from 'next/navigation';
import { unstable_noStore as noStore } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { hasAdminAccess } from '@/lib/auth/access';

type AdminContext = {
  supabase: Awaited<ReturnType<typeof createClient>>;
  user: { id: string; email?: string | null };
  guard: {
    roles: string[];
    permissions: string[];
    can: (permission: string) => boolean;
  };
  roles: string[];
  permissions: string[];
  can: (permission: string) => boolean;
};

function isMissingRpc(err: any): boolean {
  const msg = String(err?.message ?? err ?? '').toLowerCase();
  return msg.includes('could not find the function') || msg.includes('not found') || msg.includes('pgrst202');
}

export async function requireSession() {
  noStore();
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) {
    redirect('/login');
  }

  return { supabase, user: data.user };
}

export async function requireAdminSession() {
  const { supabase, user } = await requireSession();
  const isAdmin = await hasAdminAccess(supabase);
  if (!isAdmin) {
    redirect('/forbidden');
  }

  return { supabase, user };
}

export async function requireAdmin() {
  return requireAdminSession();
}

export async function requirePermission(permission: string) {
  const { supabase, user } = await requireAdminSession();

  const perm = String(permission ?? '').trim();
  if (!perm) return { supabase, user };

  const { data: has, error } = await supabase.rpc('admin_has_permission', { p_permission: perm });

  // Backward compatibility: if RBAC RPC isn't deployed yet, fall back to legacy admin gate.
  if (error && isMissingRpc(error)) {
    return { supabase, user };
  }
  if (error) {
    throw new Error(`Failed to check permission "${perm}": ${error.message}`);
  }
  if (!has) {
    redirect(`/forbidden?permission=${encodeURIComponent(perm)}`);
  }

  return { supabase, user };
}

export async function getAdminContext(): Promise<AdminContext> {
  const { supabase, user } = await requireAdmin();

  const fallback: AdminContext = {
    supabase,
    user,
    guard: {
      roles: ['legacy_admin'],
      permissions: ['*'],
      can: () => true,
    },
    roles: ['legacy_admin'],
    permissions: ['*'],
    can: () => true,
  };

  const { data: roles, error: rolesErr } = await supabase.rpc('admin_my_roles');
  const { data: perms, error: permsErr } = await supabase.rpc('admin_permissions');

  if ((rolesErr && isMissingRpc(rolesErr)) || (permsErr && isMissingRpc(permsErr))) {
    return fallback;
  }

  if (rolesErr || permsErr) {
    throw new Error(
      `Failed to load admin context: ${rolesErr?.message ?? ''} ${permsErr?.message ?? ''}`.trim(),
    );
  }

  const roleList = Array.isArray(roles) ? (roles as string[]) : [];
  const permList = Array.isArray(perms) ? (perms as string[]) : [];
  const permSet = new Set(permList);

  const guard = {
    roles: roleList,
    permissions: permList,
    can: (p: string) => permSet.has('*') || permSet.has(p),
  };

  return {
    supabase,
    user,
    guard,
    roles: roleList,
    permissions: permList,
    can: guard.can,
  };
}
