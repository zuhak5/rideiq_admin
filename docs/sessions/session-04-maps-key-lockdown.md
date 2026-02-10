# Session 04 — Maps key lockdown (accept key is public)

## Goal
Lock down Google Maps API key usage so that:
- the key can remain present in client builds (assume public), but is **hard to abuse**
- billing exposure is bounded (quotas/alerts)
- server-only geocoding/routing uses a **separate server key** with IP restrictions

## References
- Google Maps Platform API security best practices: https://developers.google.com/maps/api-security-best-practices
- Google Cloud API key best practices: https://docs.cloud.google.com/docs/authentication/api-keys-best-practices
- Add API key restrictions: https://docs.cloud.google.com/api-keys/docs/add-restrictions-api-keys

## Scope
- Web + mobile client keys (HTTP referrer / package name / bundle id restrictions)
- API restrictions (limit to exact Maps SDKs/APIs used)
- Quotas/alerts + billing guardrails
- Key separation: `MAPS_CLIENT_KEY` vs `MAPS_SERVER_KEY`

## Plan

### 1) Inventory current Maps usage
- Identify where Maps is used (frontend components, mobile SDK, backend geocoding, routing, place lookup).
- Produce an “allowlist” of required Maps APIs/SDKs.

Deliverable:
- `docs/maps/inventory.md` (endpoints + which environments use them).

### 2) Split keys by origin
Create at least two keys:
- **Client key** (public): restricted to web origins + mobile identifiers, restricted to client-side APIs only.
- **Server key** (secret): restricted by IP (or Cloud Run/VPC egress) and restricted to server APIs (Directions, Geocoding, Places Web Service if used).

Deliverable:
- Secrets in Supabase: `MAPS_CLIENT_KEY`, `MAPS_SERVER_KEY`.
- No server endpoints accept the client key.

### 3) Apply application restrictions
- Web: restrict by HTTP referrers for each environment (prod + staging domains).
- Android: restrict by package name + SHA-1 signing certificate.
- iOS: restrict by bundle identifier.

Deliverable:
- Document exact restrictions per environment in `docs/maps/key-restrictions.md`.

### 4) Apply API restrictions
- Restrict each key to only the required Maps APIs.
- Fail closed (unknown APIs not allowed).

### 5) Quotas, budgets, and alerting
- Set daily request quotas per API to prevent runaway billing.
- Add billing budgets/alerts in GCP.
- Add monitoring on usage spikes (Cloud Monitoring).

Deliverable:
- `docs/maps/quotas-alerts.md` with thresholds and escalation.

### 6) Runtime hardening
- Do not pass keys via URL query params from backend; prefer headers/server config.
- Rate-limit any server endpoints that proxy Maps to clients.

### Acceptance criteria
- Client builds contain only `MAPS_CLIENT_KEY` and it is origin-restricted + API-restricted.
- Server routes use `MAPS_SERVER_KEY` with IP restriction.
- Quotas and alerts are configured; abuse does not create unlimited cost.
