import { withRequestContext } from '../_shared/requestContext.ts';
import { errorJson, json } from '../_shared/json.ts';
import { requireAdmin } from '../_shared/admin.ts';
import { createServiceClient } from '../_shared/supabase.ts';

type Op = 'list' | 'resolve';

/**
 * Admin fraud enforcement actions endpoint.
 *
 * Auth: verify_jwt=true (gateway) + requireAdmin() (DB is_admin RPC).
 * Keys: service_role (reads/writes fraud tables).
 */
Deno.serve((req) =>
  withRequestContext('admin-fraud-actions', req, async (ctx) => {

    const url = new URL(req.url);
    const op = (url.searchParams.get('op') ?? '').toLowerCase() as Op;
    if (!op) return errorJson('op is required', 400, 'VALIDATION_ERROR', undefined, ctx.headers);

    const admin = await requireAdmin(req, ctx);
    if ('res' in admin) return admin.res;

    const svc = createServiceClient();

    if (op === 'list') {
      const status = (url.searchParams.get('status') ?? 'active').toLowerCase();
      const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') ?? 50)));

      const q = svc
        .from('fraud_enforcement_actions')
        .select(
          'id,created_at,updated_at,action_type,subject_kind,subject_key,reason,severity,expires_at,expired_at,resolved_at,resolved_by,resolution_reason,metadata',
        )
        .order('created_at', { ascending: false })
        .limit(limit);

      if (status === 'active') {
        q.is('expired_at', null).is('resolved_at', null);
      } else if (status === 'expired') {
        q.not('expired_at', 'is', null);
      } else if (status === 'resolved') {
        q.not('resolved_at', 'is', null);
      }

      const { data, error } = await q;
      if (error) return errorJson(error.message, 500, 'DB_ERROR', undefined, ctx.headers);
      return json({ ok: true, actions: data ?? [] }, 200, ctx.headers);
    }

    if (op === 'resolve') {
      if (req.method !== 'POST') return errorJson('Method not allowed', 405, 'METHOD_NOT_ALLOWED', undefined, ctx.headers);
      const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
      const actionId = String(body.action_id ?? '').trim();
      const resolutionReason = String(body.resolution_reason ?? 'admin_resolved').trim();
      if (!actionId) return errorJson('action_id is required', 400, 'VALIDATION_ERROR', undefined, ctx.headers);

      const { data, error } = await svc.rpc('fraud_resolve_action', {
        p_action_id: actionId,
        p_resolved_by: `admin:${admin.user.id}`,
        p_resolution_reason: resolutionReason,
      });
      if (error) return errorJson(error.message, 500, 'DB_ERROR', undefined, ctx.headers);

      return json({ ok: true, action_id: actionId, updated: data ?? null }, 200, ctx.headers);
    }

    return errorJson('Unknown op', 400, 'VALIDATION_ERROR', { allowed: ['list', 'resolve'] }, ctx.headers);
  }),
);
