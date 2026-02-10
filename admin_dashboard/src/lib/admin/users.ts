import { unstable_noStore as noStore } from 'next/cache';
import type { SupabaseClient } from '@supabase/supabase-js';
import { invokeEdgeFunction } from '@/lib/supabase/edge';

export type AdminUserRow = {
  id: string;
  display_name: string | null;
  phone: string | null;
  active_role: string | null;
  locale: string | null;
  created_at: string | null;
  is_admin: boolean;
};

export type AdminUsersListResponse = {
  users: AdminUserRow[];
  page: {
    limit: number;
    offset: number;
    returned: number;
  };
};

export async function listUsers(
  supabase: SupabaseClient,
  args: { q?: string; limit?: number; offset?: number } = {},
): Promise<AdminUsersListResponse> {
  noStore();

  const data = await invokeEdgeFunction<AdminUsersListResponse>(supabase, 'admin-api', {
    path: 'admin-users-list',
    method: 'POST',
    body: {
      q: args.q ?? '',
      limit: args.limit ?? 25,
      offset: args.offset ?? 0,
        },
  });

  return data;
}
