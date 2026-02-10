import { createAnonClient, createServiceClient, requireUser } from '../_shared/supabase.ts';
import { errorJson, json } from '../_shared/json.ts';
import { withRequestContext } from '../_shared/requestContext.ts';

type Body = {
  user_ids?: string[];
  kind: string;
  title: string;
  body?: string | null;
  data?: Record<string, unknown> | null;
};

Deno.serve((req) =>
  withRequestContext('notifications-send', req, async (_ctx) => {

  try {
    if (req.method !== 'POST') return errorJson('method_not_allowed', 405);

    const { user } = await requireUser(req);

    const payload = (await req.json().catch(() => null)) as Body | null;
    if (!payload?.kind || !payload?.title) {
      return errorJson('invalid_body', 400, 'INVALID_BODY', { required: ['kind', 'title'] });
    }

    const anon = createAnonClient(req); // for is_admin() with user's JWT
    const svc = createServiceClient();

    const { data: isAdmin, error: adminErr } = await anon.rpc('is_admin');
    if (adminErr) {
      // If is_admin is unavailable, default to non-admin behavior
      // (secure default)
    }

    const requested = Array.isArray(payload.user_ids) ? payload.user_ids.filter(Boolean) : [];
    const userIds =
      isAdmin === true
        ? (requested.length ? requested : [user.id])
        : [user.id]; // non-admin can only notify themselves via this endpoint

    const { data: count, error } = await svc.rpc('notify_users_bulk', {
      p_user_ids: userIds,
      p_kind: payload.kind,
      p_title: payload.title,
      p_body: payload.body ?? null,
      p_data: payload.data ?? {},
    });

    if (error) return errorJson('notify_failed', 500, 'NOTIFY_FAILED', { message: error.message });

    return json({ ok: true, notified: count ?? userIds.length });
  } catch (e) {
    return errorJson('server_error', 500, 'SERVER_ERROR', { message: String(e) });
  }
  }),
);
