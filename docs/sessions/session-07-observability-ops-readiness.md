# Session 07 — Observability and operational readiness

## Goal
Make production supportable:
- metrics for key flows (payments, dispatch, trips, safety)
- structured logs with correlation IDs
- actionable alerts with runbooks
- on-call readiness checklist

## Plan

### 1) Standardize logging schema
- Every request has:
  - `request_id`
  - `actor_id` (if authenticated)
  - `correlation_id` (trip_id / intent_id / withdraw_id)
  - `component` (edge-function name)

### 2) Metrics
Start with counters + latency:
- webhook intake: accepted/ignored/duplicate/auth_fail/internal_error
- job worker: processed/retried/dead_lettered
- dispatch: match_latency, cancel_rate, ETA errors
- safety: incident_created, ridecheck_triggered, SOS

### 3) Tracing
- Propagate trace IDs from frontend → edge → DB where possible.

### 4) Alerting
- Page on:
  - webhook 5xx rate spikes
  - job queue backlog growth
  - payment provider error spikes
  - dispatch match failures
- Ticket-only alerts for slower issues (cost drift, degraded conversion).

### 5) Runbooks
Create runbooks for:
- payments webhooks failing
- stuck job queue
- maps billing spike
- DB connection saturation

Deliverable:
- `docs/ops/runbooks/*.md`

### Acceptance criteria
- Every P0 workflow has a dashboard + alert + runbook.
