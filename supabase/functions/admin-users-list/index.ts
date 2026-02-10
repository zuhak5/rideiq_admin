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
    const { data: isAdmin, error: adminErr } = await anon.rpc('is_admin');
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
      // Simple search across name + phone.
      const like = `%${q.replace(/%/g, '\\%').replace(/_/g, '\\_')}%`;
      query = query.or(`display_name.ilike.${like},phone.ilike.${like}`);
    }

    const { data: profs, error: profErr } = await query;
    if (profErr) return errorJson(profErr.message, 400, 'DB_ERROR', undefined, ctx.headers);

    const ids = (profs ?? []).map((p: any) => p.id).filter((v: any) => isUuid(v));

    // Determine admin membership from the dedicated table.
    const { data: admins, error: admErr } = await svc
      .from('admin_users')
      .select('user_id')
      .in('user_id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000']);

    if (admErr) return errorJson(admErr.message, 400, 'DB_ERROR', undefined, ctx.headers);
    const adminSet = new Set((admins ?? []).map((r: any) => r.user_id).filter((v: any) => isUuid(v)));

    // Backward-compat: include legacy flag (read via service role only).
    const legacyAdminSet = new Set<string>();
    if (ids.length) {
      const { data: legacy } = await svc.from('profiles').select('id').in('id', ids).eq('is_admin', true);
      (legacy ?? []).forEach((r: any) => {
        if (isUuid(r.id)) legacyAdminSet.add(r.id);
      });
    }

    const users: AdminUserRow[] = (profs ?? []).map((p: any) => ({
      id: p.id,
      display_name: p.display_name ?? null,
      phone: p.phone ?? null,
      active_role: p.active_role ?? null,
      locale: p.locale ?? null,
      created_at: p.created_at ?? null,
      is_admin: adminSet.has(p.id) || legacyAdminSet.has(p.id),
    }));

    return json({ users, page: { limit, offset, returned: users.length } }, 200, ctx.headers);
  }),
);
