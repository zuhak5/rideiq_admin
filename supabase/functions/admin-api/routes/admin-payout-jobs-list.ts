import { errorJson, json } from '../../_shared/json.ts';
import { createServiceClient } from '../../_shared/supabase.ts';
import { requirePermission } from '../../_shared/admin.ts';
import { enforceAdminRateLimit } from '../../_shared/adminRateLimit.ts';
import { payoutJobsListBodySchema } from '../../_shared/schemas.ts';
import { requireMethod, validateJsonBody } from '../../_shared/validate.ts';

function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

function sanitizeIlike(s: string): string {
  return s.replace(/[%_]/g, (m) => `\\${m}`);
}

export async function handle(req: Request, ctx: any): Promise<Response> {
  const methodRes = requireMethod(req, ctx, 'POST');
  if (methodRes) return methodRes;

  const gate = await requirePermission(req, ctx, 'payouts.read');
  if ('res' in gate) return gate.res;
  ctx.setUserId(gate.user.id);

  const rlRes = await enforceAdminRateLimit(ctx, {
    action: 'payout_jobs_list',
    adminId: gate.user.id,
    windowSeconds: 60,
    limit: 240,
    failOpen: true,
  });
  if (rlRes) return rlRes;

  const parsed = await validateJsonBody(req, ctx, payoutJobsListBodySchema);
  if (!parsed.ok) return parsed.res;

  const q = parsed.data.q ?? '';
  const status = parsed.data.status ?? '';
  const payoutKind = parsed.data.payout_kind ?? '';
  const limit = parsed.data.limit;
  const offset = parsed.data.offset;

  const svc = createServiceClient();

  const query = svc
    .from('payout_provider_jobs')
    .select(
      'id,withdraw_request_id,status,payout_kind,provider_ref,last_error,created_at,updated_at,next_attempt_at,attempt_count,confirmed_at,failed_at,canceled_at',
      { count: 'exact' },
    )
    .order('created_at', { ascending: false });

  if (status) query.eq('status', status);
  if (payoutKind) query.eq('payout_kind', payoutKind);

  if (q) {
    if (isUuid(q)) {
      query.or(`id.eq.${q},withdraw_request_id.eq.${q}`);
    } else {
      const needle = sanitizeIlike(q);
      query.or(`provider_ref.ilike.%${needle}%,last_error.ilike.%${needle}%`);
    }
  }

  const { data: rows, error, count } = await query.range(offset, offset + limit - 1);
  if (error) {
    ctx.error('admin.payout_jobs.list.query_failed', { error: error.message });
    return errorJson('Query failed', 500, 'QUERY_FAILED', undefined, ctx.headers);
  }

  const jobs = rows ?? [];
  const withdrawIds = [...new Set(jobs.map((j: any) => j.withdraw_request_id).filter(Boolean))];

  let withdrawalsById = new Map<string, any>();
  if (withdrawIds.length) {
    const { data: withdrawals, error: wErr } = await svc
      .from('wallet_withdraw_requests')
      .select('id,user_id,amount_iqd,payout_kind,status,created_at,updated_at,note,payout_reference')
      .in('id', withdrawIds);

    if (wErr) {
      ctx.warn('admin.payout_jobs.list.withdrawals_failed', { error: wErr.message });
    } else {
      withdrawalsById = new Map((withdrawals ?? []).map((w: any) => [w.id, w]));
    }
  }

  const enriched = jobs.map((j: any) => ({
    ...j,
    withdraw_request: withdrawalsById.get(j.withdraw_request_id) ?? null,
  }));

  return json(
    {
      ok: true,
      jobs: enriched,
      page: { limit, offset, returned: enriched.length, total: typeof count === 'number' ? count : null },
    },
    200,
    ctx.headers,
  );
}
