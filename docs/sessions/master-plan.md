# Master plan — production readiness checklist

This document is the running checklist for the ongoing structured refactor/hardening work.

## 0) How to use this
- Each checkbox is a concrete deliverable.
- When a deliverable is completed, link the session doc or PR that completed it.
- Prefer small, safe increments (one subsystem at a time).

---

## 1) Edge Functions: auth, abuse controls, correctness
### 1.1 Inventory and authorization model
- [ ] Produce a machine-readable inventory of all Edge Functions (name → class: public | user | admin | cron | webhook).
- [ ] Ensure every `verify_jwt = false` function has an explicit runtime guard (JWT, admin, signature, or cron secret).
- [ ] Ensure every webhook endpoint verifies provider signature + replay protection.

### 1.2 Rate limiting and resource controls
- [x] Add DB-backed rate limiting primitives (table + RPC).
- [x] Add pruning job for rate limit buckets (cron-secret protected).
- [ ] Ensure expensive endpoints are fail-closed on rate-limit failures (AI, payment confirmation, ...).
- [ ] Add per-user + per-IP rate limits to all externally reachable auth / recovery / SMS / voice endpoints.

### 1.3 Observability and debuggability
- [x] Standard request/trace IDs via `withRequestContext()`.
- [ ] Make JSON responses consistently echo request IDs (so `functions.invoke()` clients can see them).
- [ ] Standardize error codes (`code` field) and ensure they are documented.

---

## 2) Database: schema, RLS, migrations
- [ ] Audit RLS on every user-accessible table (deny-by-default, least privilege).
- [ ] Verify that every Edge Function only uses service role for operations that truly require it.
- [ ] Add migration validation checklist (idempotency, rollback notes, perf indexes).
- [ ] Add background cleanup jobs for all ephemeral tables (challenges, webhook replay, rate limits, ...).

---

## 3) Payments & webhooks: correctness and safety
- [ ] Confirm each provider has: signature verification, replay protection, idempotency, and audit logs.
- [ ] Ensure every provider callback has strict CORS = not browser callable unless intended.
- [ ] Add alerting for: webhook failure rate, payout job stuck rate, unexpected state transitions.

---

## 4) Frontend: API contract, UX, security
- [ ] Centralize API invoke + error handling conventions (429 handling, retry/backoff policy).
- [ ] Add client-side logging hooks (requestId surfaced to users/support).
- [ ] Passkeys UX: step-up requirements for admin actions, recovery flows validated.

---

## 5) DevOps: environments, secrets, CI/CD
- [ ] Document required Edge Function secrets (per-function) and expected formats.
- [ ] Confirm secret rotation runbooks are complete and tested.
- [ ] CI pipeline and deployment checklist for staging/prod.

---

## 6) Security review
- [ ] Threat model: auth flows, payments, webhooks, fraud controls.
- [ ] SAST/secret scanning in CI + pre-commit.
- [ ] Dependency audit + update policy.