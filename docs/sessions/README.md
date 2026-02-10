# RideIQ — Structured Improvement Sessions (04–15)

This directory is the continuation playbook for hardening the codebase and delivering the next product capabilities. Each session doc is a **plan only** (no code), with:

- Goals + non-goals
- Technical approach (DB + backend + frontend)
- Security/privacy considerations
- Rollout steps + acceptance criteria

## Working agreements

- Ship behind feature flags; expose kill-switches for risky flows.
- Database migrations must be **additive first** (expand), then switch code, then contract later.
  - For the concrete CLI workflow, see `docs/db-migrations.md`.
- Treat PII/location/audio as high sensitivity: minimize, encrypt, and strictly scope access.
- Add observability (logs/metrics/traces) before launching features that can page someone.
- Add cost controls (rate limits, quotas, background jobs) before enabling “AI” at scale.

## Project-wide checklist

- See `docs/sessions/master-plan.md` for the running production-readiness checklist used to track completion across sessions.

## Session index

- **04** — Maps key lockdown (accept key is public)
- **05** — Supabase key types + rotation strategy
- **06** — Webhook architecture: replay protection + async processing (follow-up hardening)
- **07** — Observability and operational readiness
- **08** — Dispatch + geospatial performance
- **09** — Fraud/abuse detection
- **10** — Multi-env maturity
- **11** — Safety & trust: Women Preferences + Teen/Family accounts
- **12** — Safety superpowers: lock-screen live trip tracking (iOS Live Activity + Android equivalents)
- **13** — Commerce & delivery UX: AI food concierge + add-on store + fee transparency/membership
- **14** — Driver-side stickiness: smart shift planner + hotspot guidance + AI earnings coach
- **15** — Identity & security: passkeys (passwordless login) for riders/drivers/admins

## Implementation hardening sessions

- **20** — Edge Functions auth contract hardening (verify_jwt=false guard coverage + audit fixes)
