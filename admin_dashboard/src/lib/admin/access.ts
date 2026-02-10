import { unstable_noStore as noStore } from 'next/cache';
import type { SupabaseClient } from '@supabase/supabase-js';

export type AdminRole = {
  key: string;
  name: string;
  description: string | null;
};

export type AdminAccessRow = {
  user_id: string;
  display_name: string | null;
  phone: string | null;
  roles: string[];
};

export type RoleChangeRequestRow = {
  id: string;
  created_at: string;
  status: string;
  effective_status?: string;
  is_expired?: boolean;
  note: string | null;
  created_by: string;
  created_by_name: string | null;
  created_by_phone: string | null;
  target_user_id: string;
  target_name: string | null;
  target_phone: string | null;
  requested_role_keys: string[];
};

export async function listAdminRoles(supabase: SupabaseClient): Promise<AdminRole[]> {
  noStore();
  const { data, error } = await supabase.rpc('admin_list_roles_v1');
  if (error) throw new Error(`admin_list_roles_v1 failed: ${error.message}`);
  return (Array.isArray(data) ? data : []) as AdminRole[];
}

export async function listAdminAccess(
  supabase: SupabaseClient,
  args: { q?: string; limit?: number; offset?: number } = {},
): Promise<{ rows: AdminAccessRow[]; page: { limit: number; offset: number; returned: number } }> {
  noStore();
  const limit = Math.min(200, Math.max(1, args.limit ?? 50));
  const offset = Math.max(0, args.offset ?? 0);
  const q = (args.q ?? '').trim();

  const { data, error } = await supabase.rpc('admin_list_admin_access_v1', {
    p_q: q || null,
    p_limit: limit,
    p_offset: offset,
  });
  if (error) throw new Error(`admin_list_admin_access_v1 failed: ${error.message}`);

  const rows = (Array.isArray(data) ? data : []) as AdminAccessRow[];
  return { rows, page: { limit, offset, returned: rows.length } };
}

export async function setAdminUserRoles(
  supabase: SupabaseClient,
  args: { userId: string; roleKeys: string[]; note: string },
): Promise<void> {
  const { error } = await supabase.rpc('admin_set_user_roles_v1', {
    p_user: args.userId,
    p_role_keys: args.roleKeys,
    p_note: args.note,
  });
  if (error) throw new Error(`admin_set_user_roles_v1 failed: ${error.message}`);
}

export async function roleKeysHavePermission(
  supabase: SupabaseClient,
  args: { roleKeys: string[]; permission: string },
): Promise<boolean> {
  const { data, error } = await supabase.rpc('admin_role_keys_have_permission', {
    p_role_keys: args.roleKeys,
    p_permission: args.permission,
  });
  if (error) throw new Error(`admin_role_keys_have_permission failed: ${error.message}`);
  return Boolean(data);
}

export async function listRoleChangeRequests(
  supabase: SupabaseClient,
  args: { status?: string; limit?: number; offset?: number; ttlDays?: number } = {},
): Promise<{ rows: RoleChangeRequestRow[]; page: { limit: number; offset: number; returned: number } }> {
  noStore();
  const limit = Math.min(200, Math.max(1, args.limit ?? 50));
  const offset = Math.max(0, args.offset ?? 0);
  const status = (args.status ?? 'pending').trim();
  const ttlDays = Math.min(90, Math.max(1, args.ttlDays ?? 7));

  // Prefer v2 (includes effective_status/is_expired), fall back to v1 if the RPC isn't deployed yet.
  const { data: v2, error: v2Err } = await supabase.rpc('admin_list_role_change_requests_v2', {
    p_status: status || null,
    p_limit: limit,
    p_offset: offset,
    p_ttl_days: ttlDays,
  });
  if (!v2Err) {
    const rows = (Array.isArray(v2) ? v2 : []) as RoleChangeRequestRow[];
    return { rows, page: { limit, offset, returned: rows.length } };
  }

  const { data, error } = await supabase.rpc('admin_list_role_change_requests_v1', {
    p_status: status || null,
    p_limit: limit,
    p_offset: offset,
  });
  if (error) throw new Error(`admin_list_role_change_requests_v1 failed: ${error.message}`);

  const rows = (Array.isArray(data) ? data : []) as RoleChangeRequestRow[];
  return { rows, page: { limit, offset, returned: rows.length } };
}

export async function createRoleChangeRequest(
  supabase: SupabaseClient,
  args: { userId: string; roleKeys: string[]; note: string },
): Promise<string> {
  const { data, error } = await supabase.rpc('admin_create_role_change_request_v1', {
    p_user: args.userId,
    p_role_keys: args.roleKeys,
    p_note: args.note,
  });
  if (error) throw new Error(`admin_create_role_change_request_v1 failed: ${error.message}`);
  const requestId = (data as any)?.request_id;
  if (!requestId) throw new Error('admin_create_role_change_request_v1 returned no request_id');
  return String(requestId);
}

export async function approveRoleChangeRequest(
  supabase: SupabaseClient,
  args: { requestId: string; note: string },
): Promise<void> {
  const { error } = await supabase.rpc('admin_approve_role_change_request_v1', {
    p_request_id: args.requestId,
    p_note: args.note,
  });
  if (error) throw new Error(`admin_approve_role_change_request_v1 failed: ${error.message}`);
}

export async function rejectRoleChangeRequest(
  supabase: SupabaseClient,
  args: { requestId: string; note: string },
): Promise<void> {
  const { error } = await supabase.rpc('admin_reject_role_change_request_v1', {
    p_request_id: args.requestId,
    p_note: args.note,
  });
  if (error) throw new Error(`admin_reject_role_change_request_v1 failed: ${error.message}`);
}
