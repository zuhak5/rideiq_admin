import { createAnonClient, createServiceClient, requireUserStrict as requireUser } from '../_shared/supabase.ts';
import { errorJson, json } from '../_shared/json.ts';
import { withRequestContext } from '../_shared/requestContext.ts';
import { sendPayout } from '../_shared/payoutProviders.ts';

function isUuid(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

function toInt(v: string | null, fallback: number) {
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.floor(n) : fallback;
}
function backoffSeconds(attemptNo: number) {
  const base = toInt(Deno.env.get('PAYOUT_RETRY_BASE_SECONDS') ?? null, 30);
  const max = toInt(Deno.env.get('PAYOUT_RETRY_MAX_SECONDS') ?? null, 3600);
  const pow = Math.min(attemptNo - 1, 10);
  const raw = base * Math.pow(2, pow);
  const jitter = Math.floor(Math.random() * base);
  return Math.min(max, raw + jitter);
}

type Body = { job_id?: string };

Deno.serve(async (req) => {

  return await withRequestContext('payout-job-send', req, async (ctx) => {
    try {
      if (req.method !== 'POST') return errorJson('Method not allowed', 405, 'METHOD_NOT_ALLOWED');

      const { user, error } = await requireUser(req);
      if (error || !user) return errorJson(error ?? 'Unauthorized', 401, 'UNAUTHORIZED');

      const anon = createAnonClient(req);
      const { data: isAdmin, error: adminErr } = await anon.rpc('is_admin');
      if (adminErr) return errorJson(adminErr.message, 500, 'ADMIN_CHECK_FAILED');
      if (!isAdmin) return errorJson('Forbidden', 403, 'FORBIDDEN');

      const body = (await req.json().catch(() => null)) as Body | null;
      const jobId = body?.job_id;
      if (!isUuid(jobId)) return errorJson('Invalid job_id', 400, 'BAD_REQUEST');

      const service = createServiceClient();

      // lock the job (prevents concurrent sends)
      const { data: lockedJob, error: lockErr } = await service
        .from('payout_provider_jobs')
        .update({ locked_at: new Date().toISOString(), lock_token: crypto.randomUUID() })
        .eq('id', jobId)
        .in('status', ['queued', 'failed'])
        .is('canceled_at', null)
        .or('locked_at.is.null,locked_at.lt.' + new Date(Date.now() - 5 * 60 * 1000).toISOString())
        .select('*')
        .maybeSingle();

      if (lockErr) return errorJson(lockErr.message, 400, 'LOCK_FAILED');
      if (!lockedJob) return json({ ok: true, ignored: true, reason: 'not_sendable_or_locked' });

      const lockToken = lockedJob.lock_token as string | null;

      try {
        const { data: wr, error: wrErr } = await service
          .from('wallet_withdraw_requests')
          .select('id, user_id, payout_kind, amount_iqd, destination, status')
          .eq('id', lockedJob.withdraw_request_id)
          .single();
        if (wrErr) throw new Error(wrErr.message);
        if (wr.status !== 'approved') throw new Error(`withdraw_request not approved (${wr.status})`);

        const attemptNo = (lockedJob.attempt_count ?? 0) + 1;

        const sendRes = await sendPayout(lockedJob.payout_kind, lockedJob, wr);

        await service.from('payout_provider_job_attempts').insert({
          job_id: jobId,
          attempt_no: attemptNo,
          status: sendRes.confirmed ? 'confirmed' : 'sent',
          request_payload: sendRes.requestPayload ?? null,
          response_payload: sendRes.responsePayload ?? null,
          error_message: null,
        });

        const updatePayload: Record<string, unknown> = {
          status: sendRes.confirmed ? 'confirmed' : 'sent',
          provider_ref: sendRes.providerRef ?? lockedJob.provider_ref ?? null,
          last_error: null,
          request_payload: sendRes.requestPayload ?? lockedJob.request_payload ?? null,
          response_payload: sendRes.responsePayload ?? lockedJob.response_payload ?? null,
          sent_at: new Date().toISOString(),
          last_attempt_at: new Date().toISOString(),
          attempt_count: attemptNo,
          next_attempt_at: new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString(),
          locked_at: null,
          lock_token: null,
        };

        if (sendRes.confirmed) {
          updatePayload.confirmed_at = new Date().toISOString();
          const finalize = (Deno.env.get('PAYOUT_FINALIZE_ON_SEND') ?? 'false').toLowerCase() === 'true';
          if (finalize) {
            await service.rpc('system_withdraw_mark_paid', {
              p_request_id: wr.id,
              p_payout_reference: sendRes.providerRef ?? null,
              p_provider_payload: sendRes.responsePayload ?? null,
            });
          }
        }

        const { data: updated, error: upErr } = await service
          .from('payout_provider_jobs')
          .update(updatePayload)
          .eq('id', jobId)
          .eq('lock_token', lockToken)
          .select('*')
          .single();
        if (upErr) throw new Error(upErr.message);

        return json({ ok: true, job: updated });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const attemptNo = (lockedJob.attempt_count ?? 0) + 1;
        const delay = backoffSeconds(attemptNo);

        await service.from('payout_provider_job_attempts').insert({
          job_id: jobId,
          attempt_no: attemptNo,
          status: 'failed',
          request_payload: lockedJob.request_payload ?? null,
          response_payload: null,
          error_message: msg,
        });

        const { data: updated } = await service
          .from('payout_provider_jobs')
          .update({
            status: 'failed',
            last_error: msg,
            failed_at: new Date().toISOString(),
            last_attempt_at: new Date().toISOString(),
            attempt_count: attemptNo,
            next_attempt_at: new Date(Date.now() + delay * 1000).toISOString(),
            locked_at: null,
            lock_token: null,
          })
          .eq('id', jobId)
          .eq('lock_token', lockToken)
          .select('*')
          .maybeSingle();

        return json({ ok: false, error: msg, retry_in_seconds: delay, job: updated ?? null });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return errorJson(msg, 500, 'INTERNAL_ERROR');
    }
  });
});
