import { errorJson, json } from '../../_shared/json.ts';
import { createServiceClient } from '../../_shared/supabase.ts';
import { requirePermission } from '../../_shared/admin.ts';
import { enforceAdminRateLimit } from '../../_shared/adminRateLimit.ts';
import { withdrawalsListBodySchema } from '../../_shared/schemas.ts';
import { requireMethod, validateJsonBody } from '../../_shared/validate.ts';

function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

function sanitizeIlike(s: string): string {
  // Escape % and _ for ilike patterns.
  return s.replace(/[%_]/g, (m) => `\\${m}`);
}

export async function handle(req: Request, ctx: any): Promise<Response> {
  const methodRes = requireMethod(req, ctx, 'POST');
  if (methodRes) return methodRes;

  const gate = await requirePermission(req, ctx, 'withdrawals.read');
  if ('res' in gate) return gate.res;
  ctx.setUserId(gate.user.id);

  const rlRes = await enforceAdminRateLimit(ctx, {
    action: 'withdrawals_list',
    adminId: gate.user.id,
    windowSeconds: 60,
    limit: 240,
    failOpen: true,
  });
  if (rlRes) return rlRes;

  const parsed = await validateJsonBody(req, ctx, withdrawalsListBodySchema);
  if (!parsed.ok) return parsed.res;

  const q = parsed.data.q ?? '';
  const status = parsed.data.status ?? '';
  const payoutKind = parsed.data.payout_kind ?? '';
  const limit = parsed.data.limit;
  const offset = parsed.data.offset;

  const svc = createServiceClient();

  const query = svc
    .from('wallet_withdraw_requests')
    .select(
      'id,user_id,amount_iqd,payout_kind,destination,status,note,payout_reference,created_at,updated_at,approved_at,paid_at,cancelled_at,rejected_at',
      { count: 'exact' },
    )
    .order('created_at', { ascending: false });

  if (status) query.eq('status', status);
  if (payoutKind) query.eq('payout_kind', payoutKind);

  if (q) {
    if (isUuid(q)) {
      query.or(`id.eq.${q},user_id.eq.${q}`);
    } else {
      const needle = sanitizeIlike(q);
      query.or(`payout_reference.ilike.%${needle}%,note.ilike.%${needle}%`);
    }
  }

  const { data: rows, error, count } = await query.range(offset, offset + limit - 1);
  if (error) {
    ctx.error('admin.withdrawals.list.query_failed', { error: error.message });
    return errorJson('Query failed', 500, 'QUERY_FAILED', undefined, ctx.headers);
  }

  const withdrawals = rows ?? [];
  const userIds = [...new Set(withdrawals.map((r: any) => r.user_id).filter(Boolean))];
  const withdrawIds = withdrawals.map((r: any) => r.id);

  let profilesById = new Map<string, any>();
  if (userIds.length) {
    const { data: profiles, error: pErr } = await svc.from('profiles').select('id,display_name,phone').in('id', userIds);
    if (pErr) {
      ctx.warn('admin.withdrawals.list.profiles_failed', { error: pErr.message });
    } else {
      profilesById = new Map((profiles ?? []).map((p: any) => [p.id, p]));
    }
  }

  let latestJobByWithdrawId = new Map<string, any>();
  if (withdrawIds.length) {
    const { data: jobs, error: jErr } = await svc
      .from('payout_provider_jobs')
      .select('id,withdraw_request_id,status,payout_kind,provider_ref,last_error,created_at,updated_at,next_attempt_at,attempt_count,confirmed_at,failed_at,canceled_at')
      .in('withdraw_request_id', withdrawIds)
      .order('created_at', { ascending: false });

    if (jErr) {
      ctx.warn('admin.withdrawals.list.jobs_failed', { error: jErr.message });
    } else {
      for (const j of jobs ?? []) {
        const wid = (j as any).withdraw_request_id;
        if (!latestJobByWithdrawId.has(wid)) latestJobByWithdrawId.set(wid, j);
      }
    }
  }

  const enriched = withdrawals.map((w: any) => ({
    ...w,
    user: profilesById.get(w.user_id) ?? null,
    latest_payout_job: latestJobByWithdrawId.get(w.id) ?? null,
  }));

  return json(
    {
      ok: true,
      withdrawals: enriched,
      page: { limit, offset, returned: enriched.length, total: count ?? null },
    },
    200,
    ctx.headers,
  );
}
