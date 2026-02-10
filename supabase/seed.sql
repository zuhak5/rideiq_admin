-- Seed data for local/dev environments.
--
-- This file is executed by `supabase db reset` after migrations.
-- Keep inserts idempotent and environment-agnostic.

-- -----------------------------
-- Default ops alert rules (Session 7)
-- -----------------------------

insert into public.ops_alert_rules (name, kind, severity, window_minutes, cooldown_minutes, config)
values
  (
    'webhook_internal_errors_high',
    'webhook_internal_error_spike',
    'page',
    15,
    30,
    jsonb_build_object('threshold_count', 5, 'threshold_ratio', 0.05, 'min_total', 20)
  ),
  (
    'job_queue_backlog_high',
    'job_queue_backlog',
    'page',
    15,
    30,
    jsonb_build_object('threshold_count', 50, 'threshold_age_seconds', 900)
  ),
  (
    'payment_provider_errors_high',
    'payment_provider_error_spike',
    'page',
    15,
    30,
    jsonb_build_object('threshold_count', 5, 'threshold_ratio', 0.20, 'min_attempts', 10)
  ),
  (
    'dispatch_errors_high',
    'dispatch_error_spike',
    'page',
    15,
    30,
    jsonb_build_object('threshold_count', 10, 'threshold_ratio', 0.10)
  ),
  (
    'maps_origin_denied_high',
    'maps_origin_denied',
    'ticket',
    15,
    60,
    jsonb_build_object('threshold_count', 50, 'threshold_ratio', 0.30, 'min_total', 100)
  ),
  (
    'db_connections_high',
    'db_connection_saturation',
    'ticket',
    5,
    30,
    jsonb_build_object('threshold_ratio', 0.85)
  )
on conflict (name)
do update
set
  kind = excluded.kind,
  severity = excluded.severity,
  window_minutes = excluded.window_minutes,
  cooldown_minutes = excluded.cooldown_minutes,
  enabled = true,
  config = excluded.config,
  updated_at = now();
