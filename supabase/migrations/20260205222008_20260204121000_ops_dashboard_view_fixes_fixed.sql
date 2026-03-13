-- Session 7 follow-up: dashboard view improvements
-- - Add payment latency fields (topup_create_latency)
-- - Add job worker metrics view

begin;

-- Fix for: cannot change name of view column "total" to "avg_latency_ms"
drop view if exists public.ops_payment_metrics_15m;

create or replace view public.ops_payment_metrics_15m as
select
  coalesce(nullif(payload->>'provider_code',''), 'unknown') as provider_code,
  count(*) filter (where event_type = 'metric.payment.topup_create' and coalesce(payload->>'ok','false') = 'true') as topup_ok,
  count(*) filter (where event_type = 'metric.payment.topup_create' and coalesce(payload->>'ok','false') <> 'true') as topup_fail,
  count(*) filter (where event_type = 'metric.payment.provider_error') as provider_errors,
  count(*) filter (where event_type = 'metric.payment.misconfigured') as misconfigured,
  avg(nullif(payload->>'duration_ms','')::numeric) filter (where event_type = 'metric.payment.topup_create_latency') as avg_latency_ms,
  percentile_cont(0.95) within group (order by nullif(payload->>'duration_ms','')::numeric)
    filter (where event_type = 'metric.payment.topup_create_latency') as p95_latency_ms,
  count(*) as total
from public.app_events
where created_at >= now() - interval '15 minutes'
  and event_type like 'metric.payment.%'
group by 1;

create or replace view public.ops_job_worker_metrics_15m as
select
  count(*) filter (where event_type = 'metric.job.processed' and coalesce(payload->>'outcome','') = 'succeeded') as succeeded,
  count(*) filter (where event_type = 'metric.job.processed' and coalesce(payload->>'outcome','') <> 'succeeded') as failed,
  count(*) filter (where event_type = 'metric.job.retried') as retried,
  count(*) filter (where event_type = 'metric.job.dead_lettered') as dead_lettered,
  avg(nullif(payload->>'duration_ms','')::numeric) filter (where event_type = 'metric.job.processed') as avg_duration_ms,
  percentile_cont(0.95) within group (order by nullif(payload->>'duration_ms','')::numeric)
    filter (where event_type = 'metric.job.processed') as p95_duration_ms,
  count(*) as total
from public.app_events
where created_at >= now() - interval '15 minutes'
  and event_type like 'metric.job.%';

commit;
;
