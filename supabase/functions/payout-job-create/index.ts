import { createAnonClient, createServiceClient, requireUserStrict as requireUser } from '../_shared/supabase.ts';
import { errorJson, json } from '../_shared/json.ts';
import { withRequestContext } from '../_shared/requestContext.ts';

function isUuid(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

type Body = {
  withdraw_request_id?: string;
  idempotency_key?: string;
};

Deno.serve(async (req) => {

  return await withRequestContext('payout-job-create', req, async (ctx) => {
    try {
      if (req.method !== 'POST') return errorJson('Method not allowed', 405, 'METHOD_NOT_ALLOWED');

      const { user, error } = await requireUser(req);
      if (error || !user) return errorJson(error ?? 'Unauthorized', 401, 'UNAUTHORIZED');

      const anon = createAnonClient(req);
      const { data: isAdmin, error: adminErr } = await anon.rpc('is_admin');
      if (adminErr) return errorJson(adminErr.message, 500, 'ADMIN_CHECK_FAILED');
      if (!isAdmin) return errorJson('Forbidden', 403, 'FORBIDDEN');

      const body = (await req.json().catch(() => null)) as Body | null;
      const withdrawId = body?.withdraw_request_id;
      const idemKey = (body?.idempotency_key ?? '').trim();

      if (!isUuid(withdrawId)) return errorJson('Invalid withdraw_request_id', 400, 'BAD_REQUEST');
      if (!idemKey) return errorJson('Missing idempotency_key', 400, 'BAD_REQUEST');

      const service = createServiceClient();

      // Idempotency: insert key first. If duplicate, return current active job.
      const { error: idemErr } = await service.from('payout_idempotency').insert({ key: idemKey });
      if (idemErr) {
        const { data: existing } = await service
          .from('payout_provider_jobs')
          .select('*')
          .eq('withdraw_request_id', withdrawId)
          .in('status', ['queued', 'sent'])
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        return json({ ok: true, deduped: true, job: existing ?? null });
      }

      const { data: w, error: wErr } = await service
        .from('wallet_withdraw_requests')
        .select('id, status, payout_kind, amount_iqd')
        .eq('id', withdrawId)
        .single();
      if (wErr) return errorJson(wErr.message, 400, 'WITHDRAW_NOT_FOUND');
      if (w.status !== 'approved') return errorJson('Withdraw request must be approved to create a payout job.', 409, 'INVALID_STATUS');

      const { data: job, error: jobErr } = await service
        .from('payout_provider_jobs')
        .insert({
          withdraw_request_id: w.id,
          payout_kind: w.payout_kind,
          amount_iqd: w.amount_iqd,
          status: 'queued',
          created_by: user.id,
          request_payload: { created_via: 'payout-job-create' },
        })
        .select('*')
        .single();

      if (jobErr) return errorJson(jobErr.message, 400, 'JOB_CREATE_FAILED');

      ctx.log('Created payout job', { withdraw_id: withdrawId, job_id: job.id });
      return json({ ok: true, job });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return errorJson(msg, 500, 'INTERNAL_ERROR');
    }
  });
});
