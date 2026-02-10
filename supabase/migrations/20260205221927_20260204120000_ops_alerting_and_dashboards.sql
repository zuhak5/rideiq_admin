-- Session 7: Observability & operational readiness
--
-- Adds:
-- - Ops alert rule/state/event tables (service_role only)
-- - Lightweight dashboard views for P0 workflows (15m window)
-- - Optional DB connection stats RPC for saturation monitoring

begin;

-- -----------------------------
-- Ops alerting tables
-- -----------------------------

create table if not exists public.ops_alert_rules (
  id uuid default gen_random_uuid() primary key,
  name text not null unique,
  kind text not null,
  severity text not null default 'page',
  enabled boolean not null default true,
  window_minutes integer not null default 15,
  cooldown_minutes integer not null default 30,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ops_alert_rules_severity_ck check (severity in ('page','ticket')),
  constraint ops_alert_rules_window_ck check (window_minutes between 1 and 1440),
  constraint ops_alert_rules_cooldown_ck check (cooldown_minutes between 0 and 1440)
);

create table if not exists public.ops_alert_state (
  rule_id uuid primary key references public.ops_alert_rules(id) on delete cascade,
  is_active boolean not null default false,
  active_since timestamptz,
  last_evaluated_at timestamptz,
  last_value jsonb not null default '{}'::jsonb,
  last_message text,
  last_triggered_at timestamptz,
  last_resolved_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.ops_alert_events (
  id uuid default gen_random_uuid() primary key,
  rule_id uuid not null references public.ops_alert_rules(id) on delete cascade,
  occurred_at timestamptz not null default now(),
  event_type text not null,
  value jsonb not null default '{}'::jsonb,
  message text,
  constraint ops_alert_events_type_ck check (event_type in ('triggered','resolved','note'))
);

create index if not exists ix_ops_alert_events_rule_occurred on public.ops_alert_events (rule_id, occurred_at desc);

-- Minimal hardening: service_role only.
alter table public.ops_alert_rules enable row level security;
alter table public.ops_alert_state enable row level security;
alter table public.ops_alert_events enable row level security;

drop policy if exists ops_alert_rules_service_only on public.ops_alert_rules;
create policy ops_alert_rules_service_only on public.ops_alert_rules
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists ops_alert_state_service_only on public.ops_alert_state;
create policy ops_alert_state_service_only on public.ops_alert_state
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists ops_alert_events_service_only on public.ops_alert_events;
create policy ops_alert_events_service_only on public.ops_alert_events
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

revoke all on table public.ops_alert_rules from anon, authenticated;
revoke all on table public.ops_alert_state from anon, authenticated;
revoke all on table public.ops_alert_events from anon, authenticated;

grant all on table public.ops_alert_rules to service_role;
grant all on table public.ops_alert_state to service_role;
grant all on table public.ops_alert_events to service_role;

-- -----------------------------
-- Dashboard views (15m windows)
-- -----------------------------

-- NOTE: This migration intentionally drops + recreates ops views.
-- `CREATE OR REPLACE VIEW` cannot change column names, and earlier baselines
-- may define incompatible shapes for these dashboards.
drop view if exists public.ops_webhook_metrics_15m;
create view public.ops_webhook_metrics_15m with (security_invoker='true') as
select
  coalesce(nullif(payload->>'provider_code',''), 'unknown') as provider_code,
  count(*) filter (where event_type = 'metric.webhook.accepted') as accepted,
  count(*) filter (where event_type = 'metric.webhook.duplicate') as duplicate,
  count(*) filter (where event_type = 'metric.webhook.auth_fail') as auth_fail,
  count(*) filter (where event_type = 'metric.webhook.ignored') as ignored,
  count(*) filter (where event_type = 'metric.webhook.internal_error') as internal_error,
  count(*) as total
from public.app_events
where created_at >= now() - interval '15 minutes'
  and event_type like 'metric.webhook.%'
group by 1;

drop view if exists public.ops_payment_metrics_15m;
create view public.ops_payment_metrics_15m with (security_invoker='true') as
select
  coalesce(nullif(payload->>'provider_code',''), 'unknown') as provider_code,
  count(*) filter (where event_type = 'metric.payment.topup_create' and coalesce(payload->>'ok','false') = 'true') as topup_ok,
  count(*) filter (where event_type = 'metric.payment.topup_create' and coalesce(payload->>'ok','false') <> 'true') as topup_fail,
  count(*) filter (where event_type = 'metric.payment.provider_error') as provider_errors,
  count(*) filter (where event_type = 'metric.payment.misconfigured') as misconfigured,
  count(*) as total
from public.app_events
where created_at >= now() - interval '15 minutes'
  and event_type like 'metric.payment.%'
group by 1;

drop view if exists public.ops_dispatch_metrics_15m;
create view public.ops_dispatch_metrics_15m with (security_invoker='true') as
select
  count(*) filter (where event_type = 'metric.dispatch.match' and coalesce(payload->>'ok','false') = 'true') as ok,
  count(*) filter (where event_type = 'metric.dispatch.match' and coalesce(payload->>'ok','false') <> 'true') as failed,
  count(*) filter (where event_type = 'metric.dispatch.match' and coalesce(payload->>'matched','false') = 'true') as matched,
  count(*) filter (where event_type = 'metric.dispatch.match') as total,
  avg(nullif(payload->>'duration_ms','')::numeric) filter (where event_type = 'metric.dispatch.match_latency') as avg_latency_ms,
  percentile_cont(0.95) within group (order by nullif(payload->>'duration_ms','')::numeric)
    filter (where event_type = 'metric.dispatch.match_latency') as p95_latency_ms
from public.app_events
where created_at >= now() - interval '15 minutes'
  and event_type like 'metric.dispatch.%';

drop view if exists public.ops_safety_metrics_15m;
create view public.ops_safety_metrics_15m with (security_invoker='true') as
select
  count(*) filter (where event_type = 'metric.safety.sos') as sos_total,
  count(*) filter (where event_type = 'metric.safety.sos' and coalesce(payload->>'ok','false') = 'true') as sos_ok,
  count(*) filter (where event_type = 'metric.safety.sos' and coalesce(payload->>'ok','false') <> 'true') as sos_failed,
  avg(nullif(payload->>'duration_ms','')::numeric) filter (where event_type = 'metric.safety.sos_latency') as sos_avg_latency_ms,
  percentile_cont(0.95) within group (order by nullif(payload->>'duration_ms','')::numeric)
    filter (where event_type = 'metric.safety.sos_latency') as sos_p95_latency_ms,
  count(*) filter (where event_type = 'metric.safety.ridecheck_response') as ridecheck_responses,
  count(*) filter (where event_type = 'metric.safety.ridecheck_escalated') as ridecheck_escalations,
  count(*) filter (where event_type = 'metric.safety.incident_created') as incidents_created
from public.app_events
where created_at >= now() - interval '15 minutes'
  and event_type like 'metric.safety.%';

drop view if exists public.ops_maps_metrics_15m;
create view public.ops_maps_metrics_15m with (security_invoker='true') as
select
  count(*) filter (where event_type = 'metric.maps.config_served') as config_served,
  count(*) filter (where event_type = 'metric.maps.origin_denied') as origin_denied,
  count(*) filter (where event_type = 'metric.maps.rate_limited') as rate_limited,
  count(*) filter (where event_type = 'metric.maps.misconfigured') as misconfigured,
  count(*) as total
from public.app_events
where created_at >= now() - interval '15 minutes'
  and event_type like 'metric.maps.%';

drop view if exists public.ops_job_queue_summary;
create view public.ops_job_queue_summary with (security_invoker='true') as
select
  count(*) filter (where status = 'queued') as queued,
  count(*) filter (where status = 'failed') as failed,
  count(*) filter (where status = 'dead') as dead,
  count(*) filter (where status = 'succeeded') as succeeded,
  count(*) filter (
    where status in ('queued','failed')
      and next_attempt_at <= now()
      and attempt_count < max_attempts
  ) as runnable,
  max(extract(epoch from (now() - created_at))) filter (where status in ('queued','failed')) as oldest_age_seconds
from public.webhook_jobs;

-- -----------------------------
-- DB connection saturation helper
-- -----------------------------
-- Supabase restricts stats visibility by default. A SECURITY DEFINER function
-- owned by postgres provides a safe, read-only view for service_role.

create or replace function public.ops_db_conn_stats()
returns table (
  max_connections integer,
  current_connections integer,
  pct_used numeric
)
language sql
security definer
set search_path = pg_catalog
as $$
  with mc as (
    select setting::int as max_connections
    from pg_settings
    where name = 'max_connections'
  ),
  cc as (
    select count(*)::int as current_connections
    from pg_stat_activity
    where datname = current_database()
  )
  select
    mc.max_connections,
    cc.current_connections,
    case when mc.max_connections > 0 then (cc.current_connections::numeric / mc.max_connections::numeric) else 0 end as pct_used
  from mc, cc;
$$;

alter function public.ops_db_conn_stats() owner to postgres;
revoke all on function public.ops_db_conn_stats() from public;
grant execute on function public.ops_db_conn_stats() to service_role;

commit;
;
