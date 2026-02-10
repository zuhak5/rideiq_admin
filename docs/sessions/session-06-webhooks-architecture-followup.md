# Session 06 — Webhook architecture follow-up (replay protection + async processing)

## Goal
Complete the hardening of webhook intake:
- robust replay protection
- async processing via durable queue
- “no insecure mode” in production
- consistent idempotency and error semantics

## Current baseline
See: `docs/webhook-processing.md` (durable inbox + job queue + background worker).

## Plan

### 1) Replay protection
- Enforce provider timestamp header when present (tolerate missing header for providers that can't send it).
- Add signature verification everywhere the provider supports it.
- Add nonce/unique token dedupe where provider supports idempotency keys.

### 2) Queue semantics
- Ensure each provider webhook enqueues exactly one job per provider_event (unique constraint).
- Worker must implement:
  - exponential backoff with jitter
  - dead-lettering after max attempts
  - strict row-level locking so only one worker processes a job

### 3) Error semantics
- Webhooks should return:
  - 2xx only when accepted/ignored intentionally
  - 4xx for auth/signature failures
  - 5xx for internal failures (so provider retries when appropriate)

### 4) Production hardening
- Delete/disable any “ALLOW_INSECURE_WEBHOOKS” path in production builds.
- Document the auth contract for each webhook route (headers required, signature scheme, body schema).

See: `docs/webhooks/payment-webhook-contracts.md`.

### Acceptance criteria
- No webhook handler runs with signature verification disabled in production.
- All handlers store events idempotently and enqueue jobs.
- Replay attempts and duplicates are observable in logs/metrics.
