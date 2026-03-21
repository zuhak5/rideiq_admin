import { createAnonClient, createServiceClient, requireUserStrict as requireUser } from '../_shared/supabase.ts';
import { errorJson, json } from '../_shared/json.ts';
import { withRequestContext } from '../_shared/requestContext.ts';

type Body = {
  q?: string;
  limit?: number;
  offset?: number;
};

type AdminUserRow = {
  id: string;
  display_name: string | null;
  phone: string | null;
  active_role: string | null;
  locale: string | null;
  created_at: string | null;
  is_admin: boolean;
  role_keys: string[];
};

function isUuid(v: unknown): v is string {
  return (
    typeof v === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)
  );
}

Deno.serve((req) =>
  withRequestContext('admin-users-list', req, async (ctx) => {

    if (req.method !== 'POST') {
      return errorJson('Method not allowed', 405, 'METHOD_NOT_ALLOWED', undefined, ctx.headers);
    }

    const { user, error: authErr } = await requireUser(req);
    if (!user) {
      return errorJson(String(authErr ?? 'Unauthorized'), 401, 'UNAUTHORIZED', undefined, ctx.headers);
    }

    const anon = createAnonClient(req);
    const { data: isAdmin, error: adminErr } = await anon.rpc('admin_has_permission', {
      p_permission: 'users.read',
    });
    if (adminErr) return errorJson(adminErr.message, 400, 'DB_ERROR', undefined, ctx.headers);
    if (!isAdmin) return errorJson('Forbidden', 403, 'FORBIDDEN', undefined, ctx.headers);

    let body: Body;
    try {
      body = (await req.json().catch(() => ({}))) as Body;
    } catch {
      return errorJson('Invalid JSON body', 400, 'INVALID_JSON', undefined, ctx.headers);
    }

    const q = String(body.q ?? '').trim();
    const limit = Math.max(1, Math.min(100, Math.trunc(Number(body.limit ?? 25) || 25)));
    const offset = Math.max(0, Math.trunc(Number(body.offset ?? 0) || 0));

    const svc = createServiceClient();
    let query = svc
      .from('profiles')
      .select('id,display_name,phone,active_role,locale,created_at')
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (q.length) {
      const needle = q.replace(/[^\p{L}\p{N}\s+._-]/gu, '').trim().slice(0, 80);
      if (needle) {
        if (isUuid(needle)) {
          query = query.or(`id.eq.${needle},display_name.ilike.%${needle}%,phone.ilike.%${needle}%`);
        } else {
          query = query.or(`display_name.ilike.%${needle}%,phone.ilike.%${needle}%`);
        }
      }
    }

    const { data: profs, error: profErr } = await query;
    if (profErr) return errorJson(profErr.message, 400, 'DB_ERROR', undefined, ctx.headers);

    const ids = (profs ?? []).map((p: any) => p.id).filter((v: any) => isUuid(v));

    const roleMap = new Map<string, string[]>();
    if (ids.length) {
      const { data: roleRows, error: roleErr } = await svc
        .from('admin_user_roles')
        .select('user_id,admin_roles!inner(key)')
        .in('user_id', ids);

      if (roleErr) return errorJson(roleErr.message, 400, 'DB_ERROR', undefined, ctx.headers);

      for (const row of roleRows ?? []) {
        const userId = String((row as any)?.user_id ?? '');
        const roleKey = String((row as any)?.admin_roles?.key ?? '');
        if (!isUuid(userId) || !roleKey) continue;
        const existing = roleMap.get(userId) ?? [];
        existing.push(roleKey);
        roleMap.set(userId, existing);
      }
    }

    const users: AdminUserRow[] = (profs ?? []).map((p: any) => ({
      id: p.id,
      display_name: p.display_name ?? null,
      phone: p.phone ?? null,
      active_role: p.active_role ?? null,
      locale: p.locale ?? null,
      created_at: p.created_at ?? null,
      is_admin: (roleMap.get(p.id) ?? []).length > 0,
      role_keys: Array.from(new Set(roleMap.get(p.id) ?? [])).sort(),
    }));

    return json({ users, page: { limit, offset, returned: users.length } }, 200, ctx.headers);
  }),
);
