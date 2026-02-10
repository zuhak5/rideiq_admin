import { createAnonClient, createServiceClient, requireUserStrict as requireUser } from '../_shared/supabase.ts';
import { errorJson, json } from '../_shared/json.ts';
import { withRequestContext } from '../_shared/requestContext.ts';

function isUuid(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

type Body = {
  job_id?: string;
  action?: 'cancel' | 'retry_now' | 'force_confirm';
  provider_ref?: string;
  note?: string;
};

Deno.serve(async (req) => {

  return await withRequestContext('payout-job-action', req, async (ctx) => {
    try {
      if (req.method !== 'POST') return errorJson('Method not allowed', 405, 'METHOD_NOT_ALLOWED', undefined, ctx.headers);

      const { user, error } = await requireUser(req);
      if (error || !user) return errorJson(error ?? 'Unauthorized', 401, 'UNAUTHORIZED', undefined, ctx.headers);

      const anon = createAnonClient(req);
      const { data: isAdmin, error: adminErr } = await anon.rpc('is_admin');
      if (adminErr) return errorJson(adminErr.message, 500, 'ADMIN_CHECK_FAILED', undefined, ctx.headers);
      if (!isAdmin) return errorJson('Forbidden', 403, 'FORBIDDEN', undefined, ctx.headers);

      const body = (await req.json().catch(() => null)) as Body | null;
      const jobId = body?.job_id;
      const action = body?.action;

      if (!isUuid(jobId) || !action) return errorJson('Bad request', 400, 'BAD_REQUEST', undefined, ctx.headers);

      const service = createServiceClient();
      const { data: job, error: jobErr } = await service
        .from('payout_provider_jobs')
        .select('*')
        .eq('id', jobId)
        .single();
      if (jobErr) return errorJson(jobErr.message, 404, 'NOT_FOUND', undefined, ctx.headers);

      if (action === 'cancel') {
        const { data: updated, error: upErr } = await service
          .from('payout_provider_jobs')
          .update({
            status: 'canceled',
            canceled_at: new Date().toISOString(),
            locked_at: null,
            lock_token: null,
            last_error: body?.note ?? null,
          })
          .eq('id', jobId)
          .select('*')
          .single();
        if (upErr) return errorJson(upErr.message, 400, 'UPDATE_FAILED', undefined, ctx.headers);
        return json({ ok: true, job: updated }, 200, ctx.headers);
      }

      if (action === 'retry_now') {
        const { data: updated, error: upErr } = await service
          .from('payout_provider_jobs')
          .update({
            status: 'queued',
            next_attempt_at: new Date().toISOString(),
            locked_at: null,
            lock_token: null,
            last_error: null,
          })
          .eq('id', jobId)
          .select('*')
          .single();
        if (upErr) return errorJson(upErr.message, 400, 'UPDATE_FAILED', undefined, ctx.headers);
        return json({ ok: true, job: updated }, 200, ctx.headers);
      }

      // force_confirm
      if (job.status !== 'sent' && job.status !== 'confirmed') {
        return errorJson('Job must be sent first (or confirmed)', 409, 'INVALID_STATE', undefined, ctx.headers);
      }

      const providerRef = (body?.provider_ref ?? job.provider_ref ?? null) as string | null;

      // Mark job confirmed
      const { data: updatedJob, error: upErr } = await service
        .from('payout_provider_jobs')
        .update({
          status: 'confirmed',
          provider_ref: providerRef,
          confirmed_at: new Date().toISOString(),
        })
        .eq('id', jobId)
        .select('*')
        .single();
      if (upErr) return errorJson(upErr.message, 400, 'UPDATE_FAILED', undefined, ctx.headers);

      // Finalize withdraw (service role only function)
      await service.rpc('system_withdraw_mark_paid', {
        p_request_id: updatedJob.withdraw_request_id,
        p_payout_reference: providerRef,
        p_provider_payload: { forced: true, note: body?.note ?? null },
      });

      return json({ ok: true, job: updatedJob }, 200, ctx.headers);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return errorJson(msg, 500, 'INTERNAL_ERROR', undefined, ctx.headers);
    }
  });
});
