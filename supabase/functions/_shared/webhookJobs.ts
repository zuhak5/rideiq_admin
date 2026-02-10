import { processTopupWebhook, processWithdrawWebhook, type ProviderCode } from './providerWebhookProcessors.ts';
import type { RequestContext } from './requestContext.ts';
import { emitMetricBestEffort } from './metrics.ts';

export type WebhookJobKind = 'topup_webhook' | 'withdraw_webhook';

function isUniqueViolation(err: any): boolean {
  const code = String(err?.code ?? '').trim();
  if (code === '23505') return true;
  const msg = String(err?.message ?? err ?? '');
  return /duplicate key|unique constraint/i.test(msg);
}

function toInt(v: string | null, fallback: number) {
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.floor(n) : fallback;
}

export function backoffSeconds(attemptNo: number) {
  const base = toInt(Deno.env.get('WEBHOOK_RETRY_BASE_SECONDS') ?? null, 30);
  const max = toInt(Deno.env.get('WEBHOOK_RETRY_MAX_SECONDS') ?? null, 3600);
  const pow = Math.min(Math.max(attemptNo - 1, 0), 10);
  const raw = base * Math.pow(2, pow);
  const jitter = Math.floor(Math.random() * base);
  return Math.min(max, raw + jitter);
}

export function makeDedupeKey(providerCode: string, providerEventId: string, jobKind: WebhookJobKind) {
  return `${providerCode}:${jobKind}:${providerEventId}`;
}

export type EnqueueWebhookJobArgs = {
  providerCode: ProviderCode;
  providerEventId: string;
  providerEventPk: number | null;
  jobKind: WebhookJobKind;
  correlationId: string | null;
  maxAttempts?: number;
};

export async function enqueueWebhookJob(service: any, args: EnqueueWebhookJobArgs) {
  const maxAttempts = args.maxAttempts ?? toInt(Deno.env.get('WEBHOOK_JOB_MAX_ATTEMPTS') ?? null, 10);
  const dedupeKey = makeDedupeKey(args.providerCode, args.providerEventId, args.jobKind);

  // Insert idempotently.
  const { data, error } = await service
    .from('webhook_jobs')
    .insert({
      provider_code: args.providerCode,
      provider_event_id: args.providerEventId,
      provider_event_pk: args.providerEventPk,
      job_kind: args.jobKind,
      correlation_id: args.correlationId,
      max_attempts: maxAttempts,
      dedupe_key: dedupeKey,
    })
    .select('id, status, attempt_count')
    .maybeSingle();

  if (error) {
    // Only treat unique violations as "duplicate"; propagate all other errors.
    if (!isUniqueViolation(error)) {
      throw new Error(`webhook_jobs insert failed: ${error?.code ?? ''} ${error?.message ?? String(error)}`);
    }

    // Unique violation => job already exists. Fetch it.
    const { data: existing, error: getErr } = await service
      .from('webhook_jobs')
      .select('id, status, attempt_count')
      .eq('dedupe_key', dedupeKey)
      .maybeSingle();
    if (getErr) throw new Error(getErr.message);
    return { queued: false, dedupeKey, job: existing };
  }

  return { queued: true, dedupeKey, job: data };
}

export type RunWebhookJobsOptions = {
  ctx?: RequestContext;
  limit?: number;
  lockSeconds?: number;
  // Optional: stop after this many jobs (safety).
  hardMax?: number;
};

export async function runWebhookJobs(service: any, opts: RunWebhookJobsOptions = {}) {
  const limit = opts.limit ?? toInt(Deno.env.get('WEBHOOK_JOB_BATCH_LIMIT') ?? null, 10);
  const lockSeconds = opts.lockSeconds ?? toInt(Deno.env.get('WEBHOOK_JOB_LOCK_SECONDS') ?? null, 300);
  const hardMax = opts.hardMax ?? 100;

  const results: any[] = [];

  for (let i = 0; i < hardMax; i += 1) {
    const { data: claimed, error: claimErr } = await service.rpc('webhook_claim_jobs', {
      p_limit: limit,
      p_lock_seconds: lockSeconds,
    });
    if (claimErr) throw new Error(claimErr.message ?? 'CLAIM_FAILED');

    const jobs = (claimed ?? []) as any[];
    if (!jobs.length) break;

    for (const job of jobs) {
      results.push(await processWebhookJob(service, job, opts.ctx));
    }

    // If we claimed fewer than requested, exit early.
    if (jobs.length < limit) break;
  }

  return results;
}

async function loadProviderEvent(service: any, job: any) {
  if (job.provider_event_pk) {
    const { data, error } = await service
      .from('provider_events')
      .select('id, provider_code, provider_event_id, payload, received_at')
      .eq('id', job.provider_event_pk)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  }

  const { data, error } = await service
    .from('provider_events')
    .select('id, provider_code, provider_event_id, payload, received_at')
    .eq('provider_code', job.provider_code)
    .eq('provider_event_id', job.provider_event_id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

async function markJobDone(service: any, jobId: string, lockToken: string | null, status: 'succeeded' | 'dead', fields: Record<string, unknown>) {
  const payload: Record<string, unknown> = {
    status,
    last_error: null,
    last_attempt_at: new Date().toISOString(),
    locked_at: null,
    lock_token: null,
    updated_at: new Date().toISOString(),
    next_attempt_at: new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString(),
    ...fields,
  };

  const q = service.from('webhook_jobs').update(payload).eq('id', jobId);
  if (lockToken) q.eq('lock_token', lockToken);
  const { error } = await q;
  if (error) throw new Error(error.message);
}

async function markJobFailed(service: any, job: any, lockToken: string | null, errMsg: string) {
  const attemptNo = (job.attempt_count ?? 0) + 1;
  const delay = backoffSeconds(attemptNo);
  const next = new Date(Date.now() + delay * 1000).toISOString();
  const dead = attemptNo >= (job.max_attempts ?? 10);

  await service.from('webhook_job_attempts').insert({
    job_id: job.id,
    attempt_no: attemptNo,
    status: 'failed',
    error_message: errMsg,
  });

  const update: Record<string, unknown> = {
    status: dead ? 'dead' : 'failed',
    last_error: errMsg,
    last_attempt_at: new Date().toISOString(),
    attempt_count: attemptNo,
    next_attempt_at: dead ? new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString() : next,
    locked_at: null,
    lock_token: null,
    updated_at: new Date().toISOString(),
  };

  const q = service.from('webhook_jobs').update(update).eq('id', job.id);
  if (lockToken) q.eq('lock_token', lockToken);
  const { error } = await q;
  if (error) throw new Error(error.message);

  return { ok: false, job_id: job.id, dead, retry_in_seconds: dead ? null : delay, error: errMsg };
}

export async function processWebhookJob(service: any, job: any, ctx?: RequestContext) {
  const jobId = String(job.id);
  const lockToken = job.lock_token ? String(job.lock_token) : null;

  const startedAt = Date.now();

  try {
    const ev = await loadProviderEvent(service, job);
    if (!ev) throw new Error('provider_event_not_found');

    const providerCode = String(job.provider_code) as ProviderCode;
    const kind = String(job.job_kind) as WebhookJobKind;

    let outcome: any = null;
    if (kind === 'topup_webhook') {
      outcome = await processTopupWebhook(service, providerCode, ev.payload, job.correlation_id ?? null);
    } else if (kind === 'withdraw_webhook') {
      outcome = await processWithdrawWebhook(service, providerCode, ev.payload, job.correlation_id ?? null);
    } else {
      outcome = { outcome: 'ignored', reason: 'unknown_job_kind' };
    }

    await service.from('webhook_job_attempts').insert({
      job_id: jobId,
      attempt_no: (job.attempt_count ?? 0) + 1,
      status: 'succeeded',
      error_message: null,
    });

    await markJobDone(service, jobId, lockToken, 'succeeded', {
      last_error: null,
    });

    if (ctx) {
      emitMetricBestEffort(ctx, {
        event_type: 'metric.job.processed',
        payload: { provider_code: providerCode, kind, outcome: 'succeeded', duration_ms: Date.now() - startedAt, attempt_no: (job.attempt_count ?? 0) + 1 },
      });
    }

    return { ok: true, job_id: jobId, provider_code: providerCode, kind, outcome };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const res = await markJobFailed(service, job, lockToken, msg);

    if (ctx) {
      const dead = Boolean((res as any)?.dead);
      emitMetricBestEffort(ctx, {
        event_type: dead ? 'metric.job.dead_lettered' : 'metric.job.retried',
        level: dead ? 'error' : 'warn',
        payload: {
          provider_code: String(job.provider_code ?? ''),
          kind: String(job.job_kind ?? ''),
          duration_ms: Date.now() - startedAt,
          attempt_no: (job.attempt_count ?? 0) + 1,
          error: msg,
          retry_in_seconds: (res as any)?.retry_in_seconds ?? null,
        },
      });

      emitMetricBestEffort(ctx, {
        event_type: 'metric.job.processed',
        level: 'error',
        payload: {
          provider_code: String(job.provider_code ?? ''),
          kind: String(job.job_kind ?? ''),
          outcome: dead ? 'dead' : 'failed',
          duration_ms: Date.now() - startedAt,
          attempt_no: (job.attempt_count ?? 0) + 1,
          error: msg,
        },
      });
    }

    return res;
  }
}
