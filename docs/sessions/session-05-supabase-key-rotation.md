# Session 05 — Standardize key types + rotation strategy for Supabase

## Goal
Standardize Supabase key usage and establish a rotation plan that does not break clients.

## Scope
- Client “anon” key usage
- Server “service_role” key usage (Edge Functions only)
- Rotation & emergency revoke runbook
- Secret distribution + CI checks

## Plan

### 1) Key taxonomy & policy
- **Anon key**: shipped to clients; RLS must protect data.
- **Service role key**: server-only; never shipped to clients; only for privileged ops.
- Require that every Edge Function declares which key it needs.

Deliverable:
- `docs/security/key-policy.md`

### 2) Configuration standardization
- Centralize env var naming:
  - `SUPABASE_URL`
  - `SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`

### 3) Rotation strategy
- Keep 2 keys active temporarily (old + new) where supported; otherwise coordinate release train.
- Roll forward: publish new client builds with new anon key, then revoke old.
- Server: rotate service role key first (no app store delays).

Deliverable:
- `docs/security/key-rotation-runbook.md` including:
  - steps
  - rollback
  - observability checks

### 4) CI enforcement
- Add secrets scanning / denylist patterns to prevent key commits.
- Add runtime guardrails to block `service_role` in non-server contexts.

### Acceptance criteria
- All secrets are in env/secret store, not repo.
- There is a tested rotation runbook with timelines for client vs server.
