import { requireCronSecret } from '../_shared/cronAuth.ts';
import { createServiceClient } from '../_shared/supabase.ts';
import { errorJson, json } from '../_shared/json.ts';
import { withRequestContext } from '../_shared/requestContext.ts';
import { sendPayout } from '../_shared/payoutProviders.ts';
import { fraudGetActiveActionBestEffort, fraudLogEventBestEffort } from '../_shared/fraud.ts';

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

Deno.serve(async (req) => {
  // verify_jwt=false in config.toml (cron endpoint)

  const cronAuth = requireCronSecret(req);
  if (cronAuth) return cronAuth;

  return await withRequestContext('payout-job-runner', req, async (ctx) => {
    try {
      const url = new URL(req.url);
      const limit = toInt(url.searchParams.get('limit'), 10);

      const service = createServiceClient();
      const { data: jobs, error: claimErr } = await service.rpc('payout_claim_jobs', { p_limit: limit, p_lock_seconds: 300 });
      if (claimErr) return errorJson(claimErr.message, 500, 'CLAIM_FAILED');

      const claimed = (jobs ?? []) as any[];
      ctx.log('Claimed payout jobs', { count: claimed.length });

      const results: any[] = [];

      for (const job of claimed) {
        const jobId = job.id as string;
        const lockToken = job.lock_token as string | null;
        try {
          const { data: wr, error: wrErr } = await service
            .from('wallet_withdraw_requests')
            .select('id, user_id, payout_kind, amount_iqd, destination, status')
            .eq('id', job.withdraw_request_id)
            .single();

          if (wrErr) throw new Error(`withdraw_request_not_found: ${wrErr.message}`);
          if (wr.status !== 'approved') {
            // Not in the correct state to pay
            await service
              .from('payout_provider_jobs')
              .update({
                status: 'failed',
                last_error: `withdraw_request_status_${wr.status}`,
                failed_at: new Date().toISOString(),
                last_attempt_at: new Date().toISOString(),
                attempt_count: (job.attempt_count ?? 0) + 1,
                next_attempt_at: new Date(Date.now() + backoffSeconds((job.attempt_count ?? 0) + 1) * 1000).toISOString(),
                locked_at: null,
                lock_token: null,
              })
              .eq('id', jobId)
              .eq('lock_token', lockToken);
            results.push({ job_id: jobId, ok: false, error: `withdraw_request not approved (${wr.status})` });
            continue;
          }


          // Fraud enforcement: block driver payouts while an active hold exists.
          // This is fail-open: on lookup errors, the payout will proceed.
          try {
            const { data: driverRow } = await service.from('drivers').select('id').eq('id', wr.user_id).maybeSingle();
            if (driverRow) {
              const hold = await fraudGetActiveActionBestEffort({
                actionType: 'hold_driver_payouts',
                subjectKind: 'driver',
                subjectId: String(wr.user_id),
              });
              if (hold) {
                await fraudLogEventBestEffort({
                  reason: 'payout_hold_blocked',
                  subjectKind: 'driver',
                  subjectId: String(wr.user_id),
                  severity: 3,
                  score: 60,
                  metadata: { action_id: hold.id, expires_at: hold.expires_at ?? null, withdraw_request_id: wr.id, payout_kind: wr.payout_kind },
                  req,
                });

                const deferTo = hold.expires_at ? new Date(hold.expires_at).toISOString() : new Date(Date.now() + 60 * 60 * 1000).toISOString();
                await service
                  .from('payout_provider_jobs')
                  .update({
                    last_error: 'held_by_fraud_action',
                    next_attempt_at: deferTo,
                    last_attempt_at: new Date().toISOString(),
                    locked_at: null,
                    lock_token: null,
                  })
                  .eq('id', jobId)
                  .eq('lock_token', lockToken);

                results.push({ job_id: jobId, ok: false, error: 'held_by_fraud_action', retry_at: deferTo });
                continue;
              }
            }
          } catch {
            // Best-effort: continue.
          }

          const attemptNo = (job.attempt_count ?? 0) + 1;

          const sendRes = await sendPayout(job.payout_kind, job, wr);

          // Log attempt
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
            provider_ref: sendRes.providerRef ?? job.provider_ref ?? null,
            last_error: null,
            request_payload: sendRes.requestPayload ?? job.request_payload ?? null,
            response_payload: sendRes.responsePayload ?? job.response_payload ?? null,
            sent_at: new Date().toISOString(),
            last_attempt_at: new Date().toISOString(),
            attempt_count: attemptNo,
            next_attempt_at: new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString(),
            locked_at: null,
            lock_token: null,
          };

          if (sendRes.confirmed) {
            updatePayload.confirmed_at = new Date().toISOString();
            // Optional immediate finalization (default false) — safer to rely on webhooks.
            const finalize = (Deno.env.get('PAYOUT_FINALIZE_ON_SEND') ?? 'false').toLowerCase() === 'true';
            if (finalize) {
              await service.rpc('system_withdraw_mark_paid', {
                p_request_id: wr.id,
                p_payout_reference: sendRes.providerRef ?? null,
                p_provider_payload: sendRes.responsePayload ?? null,
              });
            }
          }

          const { error: upErr } = await service
            .from('payout_provider_jobs')
            .update(updatePayload)
            .eq('id', jobId)
            .eq('lock_token', lockToken);

          if (upErr) throw new Error(`job_update_failed: ${upErr.message}`);

          results.push({ job_id: jobId, ok: true, status: updatePayload.status, provider_ref: updatePayload.provider_ref });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);

          const attemptNo = (job.attempt_count ?? 0) + 1;
          const delay = backoffSeconds(attemptNo);

          // log attempt
          await service.from('payout_provider_job_attempts').insert({
            job_id: jobId,
            attempt_no: attemptNo,
            status: 'failed',
            request_payload: job.request_payload ?? null,
            response_payload: null,
            error_message: msg,
          });

          await service
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
            .eq('lock_token', lockToken);

          results.push({ job_id: jobId, ok: false, error: msg, retry_in_seconds: delay });
        }
      }

      return json({ ok: true, processed: results.length, results });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return errorJson(msg, 500, 'INTERNAL_ERROR');
    }
  });
});
