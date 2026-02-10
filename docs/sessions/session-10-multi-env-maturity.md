# Session 10 — Multi-env maturity

## Goal
Reduce risk by enforcing clean environment separation and reproducible deploys.

## Plan
- Separate projects:
  - local / dev
  - staging
  - production
- Strict secrets separation; no prod keys in staging.
- Feature flags per environment.
- Migration promotion workflow:
  - migrations validated in staging before prod
  - “expand/contract” discipline

Deliverables:
- `docs/environments.md`
- `docs/deploy/checklist.md`
- CI job that blocks deploy if env mismatch detected.
