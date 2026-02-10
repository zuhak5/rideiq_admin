# Fraud & abuse detection

This document describes the **signals**, **thresholds**, and **enforcement actions** implemented in Session 09.

Principles:

- **Privacy-aware**: store only coarse IP prefixes and HMAC device hashes (no raw device identifiers).
- **Fail-safe**: enforcement gates are best-effort and should fail open (do not break core flows on logging outages).
- **Human override**: automated actions must be reversible by admin tooling.
- **Service-role only**: fraud tables/RPCs are service_role-only via RLS.

## Data model

Tables (all in `public`):

- `fraud_events` — immutable event log (dedupe via optional `dedupe_key`).
- `fraud_cases` — manual review queue (open/closed).
- `fraud_case_events` — case ↔ event linkage.
- `fraud_enforcement_actions` — active/expired/resolved actions (temporary blocks/holds).

## Signals captured

### Request-level signals

Captured by `supabase/functions/_shared/fraud.ts`:

- `ip_prefix`
  - IPv4: `/24` (e.g. `1.2.3.0/24`)
  - IPv6: `/64` (first 4 hextets)
- `device_hash`
  - HMAC-SHA256 over a canonical set of low-risk headers.
  - Key: `FRAUD_FINGERPRINT_HMAC_KEY` (Edge-only secret).

### Velocity / rate-limit signals

Rate-limit exceed events create:

1) a `fraud_events` row
2) an open `fraud_cases` row (idempotent per subject+reason)
3) a temporary `fraud_enforcement_actions` block

## Thresholds (current)

These thresholds are intentionally conservative and can be tuned per environment.

| Surface | Rate limit | Case reason | Block action | Duration |
|---|---:|---|---|---:|
| Ride intent creation | 20 / 60s per (user, ip) | `fake_account_spam` | `block_ride_intent_create` | 120m |
| Top-up creation | 10 / 60s per (user, ip) | `payment_fraud_suspected` | `block_topup_create` | 60m |
| Referral redeem | 5 / 60s per (user, ip) | `promo_abuse_referral_redeem` | `block_referral_redeem` | 180m |
| Ride chat send | 30 / 60s per (user, ip) | `harassment_chat_velocity` | `block_ride_chat_send` | 60m |
| Scheduled cancel | 8 / 300s per (user, ip) | `cancel_abuse_scheduled` | `block_scheduled_cancel` | 120m |

## Automated anomaly detection

### Cron runner

`fraud-score-runner` is a cron endpoint protected by `CRON_SECRET` and configured with `verify_jwt=false`.

It:

- expires timed actions (`fraud_expire_actions()`)
- creates review cases for route deviation candidates
- creates review cases for collusion candidates and applies a conservative automatic hold:
  - action: `hold_driver_payouts`
  - duration: 7 days

Enforcement:

- `payout-job-runner` checks for an active `hold_driver_payouts` action on the withdraw request’s `user_id` **when that user is a driver** (exists in `public.drivers`).
- When held, the job is deferred (`next_attempt_at` set to the action’s `expires_at` when available) instead of being sent to the payout provider.

### Candidate definitions

- Route deviation: `ridecheck_state.distance_increase_streak >= 3` within the last 30 minutes.
- Collusion: driver+rider pairs with `>= 5` rides in 7 days where trip distance is below the configured threshold.

## Human override

Admins can:

- close cases (`admin-fraud-cases?op=close`)
- resolve actions (`admin-fraud-actions?op=resolve`)

See `docs/ops/runbooks/fraud-abuse.md`.
