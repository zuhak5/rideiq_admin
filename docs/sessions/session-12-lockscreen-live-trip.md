# Session 12 — Safety superpowers: lock-screen live trip tracking (iOS Live Activity + Android equivalents)

## Goal
Provide “always-visible” trip status without opening the app:

- **iOS**: Live Activity (ActivityKit) shown on Lock Screen + Dynamic Island (supported devices).
- **Android**: Progress-centric notifications / Live Updates (Android 16+) + high-quality ongoing notifications for older versions.

## References
- Apple ActivityKit overview: https://developer.apple.com/documentation/ActivityKit/
- Starting/updating Live Activities with push notifications: https://developer.apple.com/documentation/activitykit/starting-and-updating-live-activities-with-activitykit-push-notifications
- Android 16 progress-centric notifications: https://developer.android.com/about/versions/16/features/progress-centric-notifications

## Non-goals
- Replace the in-app trip screen; this is an “at-a-glance” surface.
- Real-time, high-frequency GPS streaming on lock-screen (cost/privacy/battery risk).

---

# Part A: iOS Live Activity design

## UX states
- Driver assigned → show driver initials + ETA to pickup
- Driver arriving → show minutes + pickup address
- Trip started → show ETA to destination + route summary
- Trip paused/long stop → show stop timer + “Are you safe?” CTA (ties into RideCheck 2.0)
- Trip completed → end activity promptly

## Data minimization / privacy
- Avoid exposing exact pickup/destination addresses on lock-screen by default.
- Provide an option:
  - “Show full addresses on lock screen” (off by default)
- Never show phone numbers on lock screen.

## Update strategy (battery + rate limits)
- Update only on **meaningful state changes**:
  - assignment, arrived, start, significant ETA change, near destination, completion
- Throttle location-driven updates:
  - max N updates per minute; degrade to “next milestone” updates.
- Prefer server-push updates when the app is backgrounded (push-driven Activity updates).

## Technical approach
1) Client starts Live Activity when trip enters “assigned” state.
2) Client receives Activity push token and sends to backend.
3) Backend sends push updates on state transitions.
4) Client ends activity on completion/cancel.

### Backend changes
- Store per-trip live activity tokens:
  - `trip_live_activities(trip_id, platform, token, created_at, revoked_at)`
- Add a “trip status broadcaster” component:
  - listens to trip events and emits platform-specific updates
  - enforces throttling rules

### Security
- Push updates are authorized by server and scoped to a trip_id.
- Token storage is encrypted-at-rest (DB encryption) and access controlled.

---

# Part B: Android Live Updates / progress-centric notifications

## Supported targets
- Android 16+: ProgressStyle notification / Live Update surface (lock screen + shade prominence).
- Android <16: Foreground service + ongoing notification with consistent actions and content.

## UX states (parity with iOS)
- Driver assigned, arriving, trip started, stop, completed.

## Technical approach
- Implement a unified “TripLiveSurface” abstraction in the mobile app:
  - iOS Live Activity provider
  - Android Live Update provider
  - Android ongoing notification provider
- Backend can remain platform-agnostic:
  - emits trip state transitions + minimal payload
  - client renders to surface (for older Android) or server pushes when allowed

## Rate limiting & spam controls
- Enforce minimum update interval.
- If client is active (foreground), do not send push updates (avoid duplicate surfaces).

---

# Rollout plan
- Phase 0: internal only
- Phase 1: iOS Live Activity only (simpler), small region
- Phase 2: Android ongoing notifications
- Phase 3: Android 16 Live Updates when platform adoption supports it
- Phase 4: integrate RideCheck 2.0 triggers (Session 13/next)

## Acceptance criteria
- Users can track pickup and in-ride ETA from the lock screen with correct state transitions.
- No excessive background updates; battery impact is acceptable.
- Push token handling is secure and revocable.
