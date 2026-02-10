# Session 15 Summary: Passkeys

## Changes
- **Migration**: `20260206200000_passkeys.sql`
  - `user_passkeys` table for WebAuthn credentials
  - `webauthn_challenges` for ephemeral challenge storage
  - `recovery_codes` for account recovery
  - `passkey_auth_log` for audit trail

- **Edge Functions**: `passkey-register`, `passkey-authenticate`

## Key Features
- FIDO2/WebAuthn compliant credential storage
- Clone detection via sign count verification
- Platform and cross-platform authenticator support
- Backup code generation for recovery

## Security Notes
- Challenges expire after 5 minutes
- Sign count validation prevents credential cloning
- All auth events are logged for audit

## Follow-up hardening (sessions 18–19)
- Passkey Edge Functions are now wrapped in `withRequestContext()` to ensure consistent request/trace IDs are echoed in JSON bodies (since `functions.invoke()` does not expose response headers to clients).
- Registration and authentication ceremonies are rate-limited (per-user + per-IP) as defense-in-depth against abuse and resource exhaustion.
