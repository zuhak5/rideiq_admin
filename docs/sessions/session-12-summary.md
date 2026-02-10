# Session 12 Summary: Lock-screen Live Trip Tracking

## What Changed

### Database Migration
**File**: [20260206140000_lockscreen_live_trip_tracking.sql](file:///c:/Users/Thulfiqar%20AL-Zamili/Downloads/RideIQ-sessions04-10-final/supabase/migrations/20260206140000_lockscreen_live_trip_tracking.sql)

- **New enums**: `live_activity_platform` (ios/android), `trip_live_status`
- **New table**: `trip_live_activities` - stores push tokens for iOS Live Activity / Android notifications
- **New table**: `trip_status_transitions` - tracks status changes for broadcasting
- **New table**: `live_activity_throttle_config` - platform-specific throttling settings
- **New RPC functions**:
  - `trip_live_activity_register` - register push token
  - `trip_live_activity_revoke` - revoke token on trip end
  - `trip_live_activity_get_tokens` - get tokens for a trip (service_role)
  - `trip_live_activity_record_push` - increment push counter
  - `trip_record_status_transition` - log status change
  - `trip_claim_pending_broadcasts` - **USES SKIP LOCKED** for safe concurrent claiming

### Edge Functions (2 new)
| Function | Auth | Purpose |
|----------|------|---------|
| `live-activity` | user_jwt | Register/revoke live activity tokens |
| `trip-broadcast-runner` | cron_secret | Claim pending broadcasts and send push updates |

### Config Updates
- **config.toml**: Added `verify_jwt = false` for both functions
- **edge-auth-contract.json**: Added auth contracts
- **key-requirements.json**: Added service_role requirements

## Key Design Decisions

1. **SKIP LOCKED for broadcast claiming**: The `trip_claim_pending_broadcasts` function uses `FOR UPDATE SKIP LOCKED` to safely handle concurrent cron invocations
2. **Throttling built-in**: Configurable per-platform throttle settings (default 30s interval, max 50 updates per trip)
3. **Privacy controls**: Users can opt into showing full addresses on lock screen (default: off)
4. **Platform abstraction**: Same backend supports both iOS Live Activity and Android notifications

## How to Validate

### Automated
```bash
# Verify SKIP LOCKED in new migration
rg -i "skip locked" supabase/migrations/20260206140000*.sql
```

### New Endpoints to Test
1. POST `/functions/v1/live-activity` - Register token
2. DELETE `/functions/v1/live-activity` - Revoke token
3. POST `/functions/v1/trip-broadcast-runner` (cron_secret required) - Process broadcasts

## Deferred Items
- Actual APNS/FCM push implementation (marked TODO in code)
- RideCheck 2.0 integration ("Are you safe?" CTA during paused trips)
