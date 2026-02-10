# Runbook: Fraud & abuse

This runbook covers triage and override flows for the Session 09 fraud/abuse system.

## Where to look

- **Metrics view**: `public.ops_fraud_metrics_15m` (service_role).
- **Event log**: `public.fraud_events`.
- **Cases**: `public.fraud_cases` (open/closed review queue).
- **Actions**: `public.fraud_enforcement_actions` (active/expired/resolved).

## Common workflows

### 1) Check whether a user/driver is blocked

1. Query `fraud_enforcement_actions` for `subject_key` and `action_type` where `expired_at IS NULL AND resolved_at IS NULL`.
2. If an action is present, note `expires_at` and `reason`.

### 2) Resolve a false positive (human override)

Use the admin endpoints (requires admin JWT):

- Resolve an action:
  - `POST /functions/v1/admin-fraud-actions?op=resolve`
  - Body: `{ "action_id": "...", "resolution_reason": "false_positive" }`

- Close a case:
  - `POST /functions/v1/admin-fraud-cases?op=close`
  - Body: `{ "case_id": "...", "close_reason": "false_positive" }`

### 3) Collusion / payout hold workflow

`fraud-score-runner` may apply `hold_driver_payouts` for strong collusion candidates.

**Enforcement:** `payout-job-runner` defers payout jobs when this action is active (job error: `held_by_fraud_action`).

Steps:

1. Review the matching case (`reason = collusion_review`).
2. Inspect event metadata for `rider_id`, `ride_count`, `last_ride_at`.
3. If legitimate, resolve the payout-hold action and close the case.

## Scheduling

The runner is designed for `pg_cron` + `pg_net` invocation with `CRON_SECRET`.

Example (staging/prod):

- Cron: every 5 minutes
- HTTP request:
  - method: POST
  - url: `<SUPABASE_URL>/functions/v1/fraud-score-runner`
  - headers: `{ "x-cron-secret": "<CRON_SECRET>" }`

## Tuning

Thresholds and enforcement durations are documented in `docs/security/fraud-abuse-detection.md`.