import { errorJson, json } from '../../_shared/json.ts';
import { createServiceClient } from '../../_shared/supabase.ts';
import { requirePermission } from '../../_shared/admin.ts';
import { enforceAdminRateLimit } from '../../_shared/adminRateLimit.ts';
import { adminListBodySchema } from '../../_shared/schemas.ts';
import { requireMethod, validateJsonBody } from '../../_shared/validate.ts';

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

  // Fetch basic user fields + admin membership. Phone/name are in profiles.
  // Use a service client for deterministic reads (no RLS surprises), but enforce auth above.
  let query = svc
    .from('profiles')
    .select(
      'id,display_name,phone,active_role,locale,created_at,is_admin,admin_users(user_id)',
      { count: 'exact' },
    );

  if (search) {
    // PostgREST OR filters are string-based. To avoid filter-injection, restrict to safe characters.
    // Allow unicode letters/numbers (Arabic names), whitespace, and a small set of separators.
    const needle = search
      .replace(/[^\p{L}\p{N}\s+._-]/gu, '')
      .trim()
      .slice(0, 80);
    if (needle) {
      query = query.or(`display_name.ilike.%${needle}%,phone.ilike.%${needle}%`);
    }
  }

  const { data, error } = await query
    .order('created_at', { ascending: false })
    .range(pageOffset, pageOffset + pageSize - 1);

  if (error) {
    ctx.error('admin.users_list.query_failed', { error: error.message });
    return errorJson('Query failed', 500, 'QUERY_FAILED', undefined, ctx.headers);
  }

  const users = (data ?? []).map((row: any) => {
    const isAdmin = Boolean(row?.is_admin) || Boolean(row?.admin_users?.length);
    return {
      id: row.id,
      display_name: row.display_name,
      phone: row.phone,
      active_role: row.active_role,
      locale: row.locale,
      created_at: row.created_at,
      is_admin: isAdmin,
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
