# Session 11 — Safety & trust: Women Preferences + Teen/Family accounts

## Goal
Deliver two trust features without breaking dispatch or creating new abuse vectors:

1) **Women Preferences matching** (opt‑in): eligible riders can prefer women drivers (best‑effort, not guaranteed).
2) **Teen / Family accounts** with guardian supervision: live tracking + destination lock + policy controls.

## External references (product precedent)
- Uber “Women Preferences” (opt‑in matching feature): https://www.uber.com/newsroom/women-preferences/
- Lyft “Women+ Connect” (preference-based matching): https://www.lyft.com/lyftup/lyft-women-plus-connect
- Uber “Teens” / family supervision (live tracking, PIN, destination lock concepts): https://www.uber.com/us/en/ride/teens/ and/or related Uber Help pages.

> NOTE: Precedent is useful for UX/expectations: **best-effort matching**, clear disclosures, and a “no penalty cancel/report” flow for mismatches.

## Non-goals
- Identity verification of gender (do not attempt). Use self-identification + abuse controls.
- Guaranteeing a match (dispatch must fall back gracefully).
- Building the entire safety product suite (RideCheck 2.0 is Session 12).

---

# Part A: Women Preferences matching

## Requirements
- Rider can enable “Women Preferences” (opt-in).
- Driver can opt-in to receive Women-Preference requests (opt-in).
- Matching is **best-effort**:
  - try women drivers first for a bounded time
  - then fall back to normal matching (no deadlocks, no infinite waits)
- Clear UX disclosures:
  - not guaranteed
  - availability varies by area/time
- Abuse handling:
  - allow reporting of profile mismatch / harassment
  - no-penalty cancellation pathway where justified
  - rate limits + monitoring

## Data model
1) `profiles`
- `gender_identity` (enum): `female | male | nonbinary | undisclosed`
- `gender_visibility` (enum): `hidden | shown_to_matches`
- `is_teen` boolean (ties into Part B)

2) `safety_preferences`
- `women_preferences_enabled` boolean (rider)
- `women_preferences_driver_opt_in` boolean (driver)
- `women_preferences_eligible` boolean (server-derived, optional): e.g., only allow if `gender_identity in (female, nonbinary)`.

3) `trips` / `trip_requests`
- `women_preferences_requested` boolean
- `women_preferences_fulfilled` boolean
- `women_preferences_fallback_used` boolean
- `women_preferences_match_attempt_ms` integer (observability)

## Dispatch behavior (matching contract)
When `women_preferences_requested=true`:
1) Candidate selection phase:
- Filter drivers with:
  - `women_preferences_driver_opt_in=true`
  - `driver.gender_identity=female` (optionally include `nonbinary` if policy says “women+”)
  - All normal eligibility constraints (vehicle, distance, ratings, etc.)
2) Attempt window:
- Example: 10–20 seconds / N offers (tunable) before fallback.
3) Fallback:
- Remove the gender filter and proceed with normal dispatch.

### Cancellation / mismatch handling
- Add an in-app “Report mismatch” and “Safety concern” reasons with evidence capture.
- Policy: no-penalty cancellation for drivers in mismatch/safety cases (requires enforcement + audit trail).
- Log all mismatch reports for abuse analytics.

## UX surfaces
- Rider:
  - toggle in Safety settings + during request flow
  - UI disclosure + availability note
- Driver:
  - opt-in toggle
  - explanation of how requests are routed
  - guided “report mismatch” tool

## Observability & KPIs
- Adoption: preference enabled rate (by city/time)
- Fulfillment: % of preference trips fulfilled vs fallback
- Impact: match latency delta, cancellation rate delta
- Safety: mismatch report rate, false report rate (post-review)

## Rollout plan
- Phase 0: internal dogfood, staff-only allowlist
- Phase 1: one city + time window
- Phase 2: expand cities
- Phase 3: general availability + continuous monitoring

---

# Part B: Teen / Family accounts (guardian supervision)

## Requirements
- Guardian creates a family group.
- Guardian invites teen via link/code; teen joins after verification.
- Guardian has:
  - live trip tracking for teen rides
  - destination lock (teen destination cannot be changed mid-trip by driver; changes require teen/guardian approval)
  - policy controls (optional): allowed hours, pickup zones, spending caps, emergency contact
- Teen UX:
  - simplified flows
  - clear “guardian is notified” disclosure
- Driver UX:
  - PIN verification at pickup (optional but recommended)
  - destination lock indicator

## Data model
1) `families`
- `id`, `created_by_user_id`, timestamps

2) `family_members`
- `family_id`, `user_id`, `role` enum: `guardian | teen | adult`
- `status` enum: `invited | active | suspended`
- `invite_token_hash`, `invite_expires_at`

3) `teen_policies`
- `family_id`, `teen_user_id`
- `destination_lock_enabled` boolean
- `pickup_pin_enabled` boolean
- `allowed_hours` JSON (optional)
- `geofence_allowlist` (optional)
- `spend_cap_daily` numeric (optional)

4) `trip_guardian_links`
- `trip_id`, `teen_user_id`, `guardian_user_id`
- `guardian_live_tracking_enabled` boolean

## Backend API contract (Edge Functions)
- `POST /family/create`
- `POST /family/invite-teen`
- `POST /family/accept-invite`
- `POST /family/policy/update`
- `POST /trip/request` (accept teen flags; compute guardian link)
- `POST /trip/update-destination`:
  - if destination lock enabled → require teen/guardian approval (two-step) or deny driver changes
- `POST /trip/guardian/track`:
  - returns redacted but useful tracking data (ETA, driver first name, vehicle, route polyline)
  - strict auth: guardian only

## Security & privacy
- Guardian access is a privileged relationship:
  - enforce via RLS + server authorization checks
  - audit all guardian views and policy changes
- Location data:
  - minimize granularity for non-essential surfaces (e.g., guardian gets enough to ensure safety; avoid over-sharing)
- Consent:
  - explicit teen consent at onboarding (jurisdiction-dependent)
- Abuse prevention:
  - limit number of family members
  - require verified guardian identity for sensitive actions (optional step-up auth; see Session 15 passkeys)

## Rollout plan
- Phase 0: internal accounts only
- Phase 1: guardian + teen onboarding
- Phase 2: destination lock + PIN
- Phase 3: policy controls (hours/geofence/spend caps)

## Acceptance criteria
- Guardian can reliably see teen trip status and location during a trip.
- Destination lock is enforced server-side; drivers cannot override via client spoofing.
- All flows are auditable; role-based access is correct.
