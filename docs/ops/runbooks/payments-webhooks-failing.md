# Runbook: Payments webhooks failing

## Alert signals
- `webhook_internal_errors_high` (page)
- `payment_provider_errors_high` (page)

## Dashboards
- SQL (15m):
  - `select * from public.ops_webhook_metrics_15m;`
  - `select * from public.ops_payment_metrics_15m;`
  - `select * from public.ops_job_queue_summary;`
- Edge (admin): `supabase functions invoke ops-dashboard`

## Immediate triage (0–10 min)
1. **Confirm blast radius**
   - Is the error isolated to a provider (`provider_code`) or global?
   - Check `internal_error` in `ops_webhook_metrics_15m` and `provider_errors` in `ops_payment_metrics_15m`.

2. **Check webhook ingestion durability**
   - The system must follow: **verify → persist → enqueue → respond 2xx**.
   - Inspect durable queue:
     - `select status, count(*) from public.webhook_jobs group by 1;`
     - `select id, status, attempt_count, next_attempt_at, last_error from public.webhook_jobs order by created_at desc limit 50;`

3. **Check worker health**
   - Confirm the cron job is invoking `webhook-job-runner` and that it is returning 2xx.
   - If needed, manually invoke the runner (cron-secret required):
     - `POST /functions/v1/webhook-job-runner?limit=10` with `x-cron-secret: <CRON_SECRET>`.

## Common causes / fixes
### A) Signature verification failures
- Symptoms: high `auth_fail`, low `accepted`, few `webhook_jobs` created.
- Actions:
  - Verify provider webhook secret rotation wasn’t missed.
  - Confirm the correct signing header is being sent by the provider.

### B) Provider outage / upstream API errors
- Symptoms: increased `provider_errors` with stable ingestion.
- Actions:
  - Confirm provider status page/outage.
  - Increase retry/backoff only if allowed by provider policy.
  - If provider errors are deterministic (bad config), fix config first.

### C) Job backlog growth
- Symptoms: `queued`/`runnable` increasing; `oldest_age_seconds` rising.
- Actions:
  - Confirm `webhook-job-runner` schedule.
  - Increase runner frequency temporarily (e.g., every minute) and/or `limit`.
  - Investigate DB contention or failed rows causing retries.

## Verification
- Alerts resolve (state transitions to resolved).
- `ops_webhook_metrics_15m.internal_error` and `ops_payment_metrics_15m.provider_errors` return to baseline.
- `ops_job_queue_summary.oldest_age_seconds` decreases.

## Rollback
- Disable cron schedule for `webhook-job-runner` if it is causing load.
- Revert provider config changes if misconfigured.
