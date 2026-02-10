# Webhook processing architecture

This project treats all payment-provider callbacks as **unreliable, replayable, bursty inputs** and uses a durable inbox + Postgres job queue to make processing **idempotent** and **asynchronous**.

## Goals

- Acknowledge webhooks quickly (2xx) after integrity verification.
- Persist every verified delivery for forensics and safe reprocessing.
- Process in a background worker with retries/backoff.
- Make processing idempotent (duplicate deliveries are no-ops).

## Components

### 1) Durable inbox: `public.provider_events`

Every verified delivery is written to `public.provider_events` with a **stable** `provider_event_id`.

- Unique key: `(provider_code, provider_event_id)`
- Payload stored as JSONB

This gives you an audit trail and a stable reference for job processing.

### 2) Job queue: `public.webhook_jobs` + `public.webhook_job_attempts`

We enqueue a job per inbox event:

- `job_kind`: `topup_webhook` or `withdraw_webhook`
- `dedupe_key`: `${provider_code}:${job_kind}:${provider_event_id}` (unique)
- `status` lifecycle: `queued` → `succeeded` (or `failed` → `dead` after max attempts)
- In-flight work is indicated by `locked_at` / `lock_token` (claimed via `FOR UPDATE SKIP LOCKED`)
- Retry with exponential backoff (see `WEBHOOK_RETRY_*` envs)

Jobs are claimed using a Postgres function that locks rows with `FOR UPDATE SKIP LOCKED` to safely distribute work across multiple workers.

### 3) Worker: `supabase/functions/webhook-job-runner`

The worker:

1. Requires `x-cron-secret` (see `CRON_SECRET`).
2. Calls `rpc('webhook_claim_jobs', ...)` to claim a batch.
3. Loads the `provider_events` payload.
4. Dispatches to provider processors in `_shared/providerWebhookProcessors.ts`.
5. Records attempts and updates job state.

## Endpoint behavior

All provider webhook endpoints follow the same pattern:

1. Verify signature/integrity.
2. Insert into `provider_events` (idempotent).
3. Enqueue a `webhook_jobs` record (idempotent).
4. Return 2xx **quickly**.

Some endpoints also call `EdgeRuntime.waitUntil(runWebhookJobs(...))` as a best-effort optimization. Durability comes from the DB queue, not from background execution.

## Per-route auth contracts

Each provider has a slightly different integrity/auth scheme (header signatures, secure hashes, or tokenized callbacks).
The canonical route-by-route contract (required headers, signature scheme, body expectations) lives here:

- `docs/webhooks/payment-webhook-contracts.md`

## Operating it in production

### Schedule the worker

Call the worker every minute (or faster during higher volume):

- Path: `/functions/v1/webhook-job-runner?limit=10&lockSeconds=300`
- Headers: `x-cron-secret: <CRON_SECRET>`

You can run multiple workers concurrently; the DB claim function prevents double-processing.

### Replay / dead letter

- `webhook_job_attempts` contains the history per job.
- Jobs that exceed `WEBHOOK_JOB_MAX_ATTEMPTS` move to `dead`.
- To replay a dead job, set `status='queued'`, clear `last_error`, and set `next_attempt_at=now()`.
- To unstick a job that is locked, clear `locked_at`/`lock_token` (or wait for the lock TTL) before re-queueing.

## Environment variables

See `supabase/functions/.env.example`:

- `CRON_SECRET`
- `WEBHOOK_JOB_BATCH_LIMIT`, `WEBHOOK_JOB_LOCK_SECONDS`, `WEBHOOK_JOB_MAX_ATTEMPTS`
- `WEBHOOK_RETRY_BASE_SECONDS`, `WEBHOOK_RETRY_MAX_SECONDS`
- `WEBHOOK_MAX_AGE_SECONDS` (optional timestamp replay guard)
