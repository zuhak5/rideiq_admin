import { errorJson, json } from '../../_shared/json.ts';
import { createServiceClient } from '../../_shared/supabase.ts';
import { requirePermission } from '../../_shared/admin.ts';
import { enforceAdminRateLimit } from '../../_shared/adminRateLimit.ts';
import { adminListBodySchema } from '../../_shared/schemas.ts';
import { requireMethod, validateJsonBody } from '../../_shared/validate.ts';

function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

export async function handle(req: Request, ctx: any): Promise<Response> {
  const methodRes = requireMethod(req, ctx, 'POST');
  if (methodRes) return methodRes;

  const gate = await requirePermission(req, ctx, 'users.read');
  if ('res' in gate) return gate.res;
  ctx.setUserId(gate.user.id);

  const rlRes = await enforceAdminRateLimit(ctx, {
    action: 'users_list',
    adminId: gate.user.id,
    windowSeconds: 60,
    limit: 120,
    failOpen: true,
  });
  if (rlRes) return rlRes;


  const parsed = await validateJsonBody(req, ctx, adminListBodySchema);
  if (!parsed.ok) return parsed.res;

  const q = parsed.data.q ?? '';
  const limit = parsed.data.limit;
  const offset = parsed.data.offset;

  const svc = createServiceClient();
  const search = String(q ?? '').trim();
  const pageSize = Math.min(200, Math.max(1, Number(limit ?? 25) || 25));
  const pageOffset = Math.max(0, Number(offset ?? 0) || 0);

  // Fetch basic user fields from profiles. Admin access is derived from role assignments.
  // Use a service client for deterministic reads (no RLS surprises), but enforce auth above.
  let query = svc
    .from('profiles')
    .select('id,display_name,phone,active_role,locale,created_at', { count: 'exact' });

  if (search) {
    // PostgREST OR filters are string-based. To avoid filter-injection, restrict to safe characters.
    // Allow unicode letters/numbers (Arabic names), whitespace, and a small set of separators.
    const needle = search
      .replace(/[^\p{L}\p{N}\s+._-]/gu, '')
      .trim()
      .slice(0, 80);
    if (needle) {
      if (isUuid(needle)) {
        query = query.or(`id.eq.${needle},display_name.ilike.%${needle}%,phone.ilike.%${needle}%`);
      } else {
        query = query.or(`display_name.ilike.%${needle}%,phone.ilike.%${needle}%`);
      }
    }
  }

  const { data, error } = await query
    .order('created_at', { ascending: false })
    .range(pageOffset, pageOffset + pageSize - 1);

  if (error) {
    ctx.error('admin.users_list.query_failed', { error: error.message });
    return errorJson('Query failed', 500, 'QUERY_FAILED', undefined, ctx.headers);
  }

  const ids = (data ?? [])
    .map((row: any) => String(row?.id ?? ''))
    .filter((id: string) => isUuid(id));

  const roleMap = new Map<string, string[]>();
  if (ids.length) {
    const { data: roleRows, error: roleError } = await svc
      .from('admin_user_roles')
      .select('user_id,admin_roles!inner(key)')
      .in('user_id', ids);

    if (roleError) {
      ctx.error('admin.users_list.role_query_failed', { error: roleError.message });
      return errorJson('Query failed', 500, 'QUERY_FAILED', undefined, ctx.headers);
    }

    for (const row of roleRows ?? []) {
      const userId = String((row as any)?.user_id ?? '');
      const roleKey = String((row as any)?.admin_roles?.key ?? '');
      if (!userId || !roleKey) continue;
      const existing = roleMap.get(userId) ?? [];
      existing.push(roleKey);
      roleMap.set(userId, existing);
    }
  }

  const users = (data ?? []).map((row: any) => {
    const roleKeys = Array.from(new Set(roleMap.get(String(row.id)) ?? [])).sort();
    return {
      id: row.id,
      display_name: row.display_name,
      phone: row.phone,
      active_role: row.active_role,
      locale: row.locale,
      created_at: row.created_at,
      is_admin: roleKeys.length > 0,
      role_keys: roleKeys,
    };
  });

  return json(
    {
      users,
      page: {
        limit: pageSize,
        offset: pageOffset,
        returned: users.length,
      },
    },
    200,
    ctx.headers,
  );
}
