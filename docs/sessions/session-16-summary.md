# Session 16 — Edge reduction: migrate 14 endpoints to Postgres RPC

## Goals
- Reduce Edge Function count to **≤ 90** by removing DB-only / business-critical endpoints.
- Keep Edge for orchestration/external API/webhooks; move hot-path reads and privileged decisions into DB RPC.

## What changed

### Removed Edge Functions (14)
The following Edge Functions were deleted and replaced with direct RPC usage (or removed entirely):
- `support-articles` → RPC: `support_articles_list_public_v1`
- `support-article-detail` → RPC: `support_article_get_public_v1`
- `scheduled-ride-list` → RPC: `scheduled_ride_list_user_v1`
- `drivers-nearby` → RPC: `drivers_nearby_user_v1` (wraps `nearby_available_drivers_v2` and preserves rate-limit metadata)
- `live-activity` → use existing RPCs: `trip_live_activity_register`, `trip_live_activity_revoke`
- `referral-status` → use existing RPC: `referral_status`
- `family-create` → use existing RPC: `family_create`
- `family-accept-invite` → use existing RPC: `family_accept_invite`
- `family-policy-update` → use existing RPC: `family_update_policy`
- `trip-share-create` → use existing RPC: `trip_share_create_user_v1`
- `trip-share-view` → use existing RPC: `trip_share_view_public_v1`
- `admin-users-grant` → RPC: `admin_grant_user_v1`
- `admin-users-revoke` → RPC: `admin_revoke_user_v1`
- `trusted-contacts-test` → removed (test-only endpoint)

### New DB migration
Added: `supabase/migrations/20260206260000_reduce_edge_functions_move_to_rpc.sql`
- Public support content RPCs:
  - `support_articles_list_public_v1()`
  - `support_article_get_public_v1(p_slug text)`
- Authenticated user RPCs:
  - `scheduled_ride_list_user_v1(p_limit int)`
  - `drivers_nearby_user_v1(...)`
  - `admin_grant_user_v1(p_user uuid, p_note text)`
  - `admin_revoke_user_v1(p_user uuid, p_note text)`

### Web app updates
- `ScheduledRidesPage`: switched list load from Edge to `scheduled_ride_list_user_v1`.
- `RiderPage`: switched nearby driver preview from Edge to `drivers_nearby_user_v1`.
- `AdminUsersPage`: switched grant/revoke from Edge to `admin_grant_user_v1` / `admin_revoke_user_v1`.
- `FamilyPage`/`TeenInvitePage`: switched from Edge to `family_create` / `family_accept_invite`.
- `SafetyToolkitModal` + `ShareTripPage`: switched from Edge to trip-share RPCs.
- `SafetyContactsPage`: removed test-SMS button (Edge endpoint removed).

### Security/config hygiene
- Updated `config/security/edge-auth-contract.json` (removed deleted functions).
- Updated `config/security/rpc-allowlist.json` (added new RPCs).
- Updated `supabase/functions/key-requirements.json` and `supabase/config.toml` to remove deleted function references.

## Result
- Edge Functions count (excluding `_shared`) is now **90**.
- State-changing / decision logic is centralized in Postgres RPCs; Edge remains focused on orchestration.
