# Runbook: Stuck job queue

## Alert signals
- `job_queue_backlog_high` (page)

## Dashboards
- SQL:
  - `select * from public.ops_job_queue_summary;`
  - `select status, count(*) from public.webhook_jobs group by 1;`
  - `select id, status, attempt_count, max_attempts, next_attempt_at, last_error, created_at from public.webhook_jobs where status in ('queued','failed') order by created_at asc limit 50;`

## Immediate triage (0–10 min)
1. **Confirm it is real backlog**
   - `queued` rising and `oldest_age_seconds` increasing is the primary signal.

2. **Check cron runner invocation**
   - The worker must be invoked by cron via `webhook-job-runner` (cron-secret protected).
   - Verify the schedule exists and is firing.
   - Manually invoke:
     - `POST /functions/v1/webhook-job-runner?limit=25` with `x-cron-secret: <CRON_SECRET>`.

3. **Check claim/lock health**
   - Jobs are claimed using a `FOR UPDATE SKIP LOCKED`-style pattern.
   - If multiple runners are active, locks should prevent double-processing.
   - If nothing is runnable but backlog exists, inspect `next_attempt_at` and `attempt_count`.

## Common causes / fixes
### A) CRON_SECRET mismatch or missing
- Symptoms: runner returns 401; backlog grows.
- Fix: ensure the scheduled HTTP POST includes the correct `x-cron-secret` header.

### B) Poison jobs (repeated deterministic failure)
- Symptoms: many jobs in `failed` with repeated `last_error`.
- Fix:
  - Identify root cause (schema mismatch, provider payload change, downstream API rejection).
  - Fix logic, then allow retries.
  - If required, mark irrecoverable jobs as `dead` using an admin-only maintenance script.

### C) DB contention / saturation
- Symptoms: slow claim, runner timeouts, elevated DB connections.
- Fix:
  - Run `select * from public.ops_db_conn_stats();`
  - Reduce runner frequency temporarily, or lower `limit`.
  - Resolve long-running queries.

## Verification
- `ops_job_queue_summary.runnable` decreases.
- `oldest_age_seconds` trends down.
- Alert transitions to resolved.

## Rollback
- Disable the cron schedule temporarily if it is amplifying load.
- Re-enable with a reduced cadence after DB health stabilizes.
