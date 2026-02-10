# Session 09 — Fraud/abuse detection

## Goal
Detect and mitigate common abuse:
- fake accounts / spam
- payment fraud
- driver/rider collusion
- promo abuse (if applicable)
- harassment / safety abuse

## Plan
- Add risk scoring pipeline:
  - device fingerprint (privacy-aware)
  - velocity/rate limits (signups, payment attempts, cancels)
  - anomaly detection on trips (route deviation, repeated short rides, suspicious patterns)
- Add enforcement actions:
  - soft friction (captcha, step-up auth)
  - temporary holds
  - manual review queue
- Logging + audit tables for enforcement actions.

## Acceptance criteria
- Documented signals and thresholds.
- At least one automated enforcement per high-risk class with human override.
