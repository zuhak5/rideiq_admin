# Ops (observability + on-call)

## Dashboards
Session 07 provides lightweight 15-minute windows for key workflows:

- Webhooks: `public.ops_webhook_metrics_15m`
- Payments: `public.ops_payment_metrics_15m`
- Dispatch: `public.ops_dispatch_metrics_15m`
- Safety: `public.ops_safety_metrics_15m`
- Maps: `public.ops_maps_metrics_15m`
- Fraud/abuse: `public.ops_fraud_metrics_15m`
- Job queue summary: `public.ops_job_queue_summary`
- DB saturation: `public.ops_db_conn_stats()` (service-role)

You can query these via SQL, or (admin-only) via the `ops-dashboard` Edge Function:

- `supabase functions invoke ops-dashboard`

## Alerts
Alert rules/state/events are stored in:

- `public.ops_alert_rules`
- `public.ops_alert_state`
- `public.ops_alert_events`

Alert evaluation is performed by the `ops-alert-runner` Edge Function (cron-secret protected).

## Scheduling (Supabase)
Supabase supports scheduling Edge Functions using Postgres `pg_cron` + `pg_net`.

Example (run every minute):

```sql
select cron.schedule(
  'ops-alert-runner-every-minute',
  '* * * * *',
  $$
    select net.http_post(
      url := 'https://<project-ref>.supabase.co/functions/v1/ops-alert-runner',
      headers := jsonb_build_object('x-cron-secret', '<CRON_SECRET>')
    );
  $$
);
```

See Supabase docs for details.

## Runbooks
See `docs/ops/runbooks/*`.


## Maintenance

- Rate limiting housekeeping: `rate-limit-prune` (cron-secret protected) deletes expired windows from `public.api_rate_limits`.
