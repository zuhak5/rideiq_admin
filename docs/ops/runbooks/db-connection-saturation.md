# Runbook: DB connection saturation

## Alert signals
- `db_connections_high` (ticket)

## Dashboards
- SQL:
  - `select * from public.ops_db_conn_stats();`
  - `select * from public.ops_job_queue_summary;`
  - `select wait_event_type, wait_event, count(*) from pg_stat_activity where datname=current_database() group by 1,2 order by 3 desc;`

## Immediate triage (0–15 min)
1. **Confirm saturation**
   - `pct_used` >= threshold implies connections are near the configured limit.

2. **Reduce load quickly**
   - Temporarily reduce cron runner frequency and/or limit (`webhook-job-runner`, `payout-job-runner`).
   - Pause any ad-hoc admin maintenance loops.

3. **Identify top offenders**
   - Use `pg_stat_activity` to spot:
     - long-running queries,
     - idle-in-transaction sessions,
     - lock waits.

## Common causes / fixes
### A) Connection leak in an Edge Function
- Symptoms: steady growth in connections, even at low traffic.
- Fix:
  - Confirm Edge functions are not creating raw PG connections.
  - Ensure all DB access goes through Supabase client (pooled HTTP).

### B) High concurrency + pool exhaustion
- Symptoms: burst traffic causing `pct_used` spikes.
- Fix:
  - Reduce per-minute cron concurrency.
  - Consider enabling/adjusting Supabase connection pooler / pgbouncer settings.

### C) Lock contention
- Symptoms: many `wait_event_type='Lock'` sessions.
- Fix:
  - Identify blocking query and remediate.
  - Ensure claim patterns use `FOR UPDATE SKIP LOCKED`.

## Verification
- `pct_used` drops below threshold.
- Queue backlog (`oldest_age_seconds`) stabilizes.

## Rollback
- Restore cron cadence after confirming DB is stable.
