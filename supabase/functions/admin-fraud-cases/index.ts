import { withRequestContext } from '../_shared/requestContext.ts';
import { errorJson, json } from '../_shared/json.ts';
import { requireAdmin } from '../_shared/admin.ts';
import { createServiceClient } from '../_shared/supabase.ts';

type Op = 'list' | 'close';

/**
 * Admin fraud cases endpoint.
 *
 * Auth: verify_jwt=true (gateway) + requireAdmin() (DB is_admin RPC).
 * Keys: service_role (reads/writes fraud tables).
 */
Deno.serve((req) =>
  withRequestContext('admin-fraud-cases', req, async (ctx) => {

    const url = new URL(req.url);
    const op = (url.searchParams.get('op') ?? '').toLowerCase() as Op;
    if (!op) return errorJson('op is required', 400, 'VALIDATION_ERROR', undefined, ctx.headers);

    const admin = await requireAdmin(req, ctx);
    if ('res' in admin) return admin.res;

    const svc = createServiceClient();

    if (op === 'list') {
      const status = (url.searchParams.get('status') ?? 'open').toLowerCase();
      const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') ?? 50)));

      const q = svc
        .from('fraud_cases')
        .select('id,created_at,updated_at,status,reason,subject_kind,subject_key,severity,metadata,opened_by,closed_at,closed_by,closed_reason')
        .order('created_at', { ascending: false })
        .limit(limit);

      if (status === 'open' || status === 'closed') q.eq('status', status);

      const { data, error } = await q;
      if (error) return errorJson(error.message, 500, 'DB_ERROR', undefined, ctx.headers);

      return json({ ok: true, cases: data ?? [] }, 200, ctx.headers);
    }

    if (op === 'close') {
      if (req.method !== 'POST') return errorJson('Method not allowed', 405, 'METHOD_NOT_ALLOWED', undefined, ctx.headers);
      const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
      const caseId = String(body.case_id ?? '').trim();
      const closeReason = String(body.close_reason ?? 'admin_closed').trim();
      if (!caseId) return errorJson('case_id is required', 400, 'VALIDATION_ERROR', undefined, ctx.headers);

      const { data, error } = await svc.rpc('fraud_close_case', {
        p_case_id: caseId,
        p_closed_by: `admin:${admin.user.id}`,
        p_closed_reason: closeReason,
      });
      if (error) return errorJson(error.message, 500, 'DB_ERROR', undefined, ctx.headers);

      return json({ ok: true, case_id: caseId, updated: data ?? null }, 200, ctx.headers);
    }

    return errorJson('Unknown op', 400, 'VALIDATION_ERROR', { allowed: ['list', 'close'] }, ctx.headers);
  }),
);
