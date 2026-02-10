# Session 15 — Identity & security: Passkeys (passwordless login) for riders/drivers/admins

## Goal
Adopt passkeys as a primary sign-in method (phishing-resistant, passwordless) across:
- Rider app
- Driver app
- Admin console

## References
- Apple Passkeys overview: https://developer.apple.com/passkeys/
- Apple “Supporting passkeys”: https://developer.apple.com/documentation/authenticationservices/supporting-passkeys
- Google Passkeys relying party guide (WebAuthn/Credential Manager + server considerations): https://developers.google.com/identity/passkeys/developer-guides
- WebAuthn specification (Level 3 draft): https://www.w3.org/TR/webauthn-3/
- Supabase: Third-party auth options (Clerk/Firebase/Auth0/WorkOS): https://supabase.com/docs/guides/auth/oauth-server (see “Third-party auth” section)

## Key product decisions
1) **Passkeys are the default**, but **legacy auth remains available** during migration (recommended by Google).
2) Make passkeys a **first-class** sign-in, not only MFA.
3) Admin actions require **step-up** auth (recent passkey assertion) even if a session exists.

---

# Architecture options (choose one)

## Option A (recommended): Managed IdP with passkeys + Supabase “third-party auth”
Use an identity provider that supports passkeys (WebAuthn) and issues OIDC/JWT tokens.
Examples commonly used with Supabase:
- Auth0
- Clerk
- Firebase Auth
- WorkOS (often for enterprise/admin)

### Why this is recommended
- Passkey server logic is security-critical; Google explicitly warns that building it yourself is time-consuming and risky—use mature libraries or managed solutions.
- IdPs provide device binding, recovery flows, and abuse protection.

### How Supabase fits
- Supabase remains the data layer with RLS.
- Requests include the IdP JWT; Supabase verifies it per its third-party auth configuration.

## Option B: Self-host WebAuthn server + Supabase session integration
Build passkey registration/auth in Edge Functions using a well-maintained WebAuthn server library.
- Store credentials (public key, credential id, counters) in Postgres.
- On assertion success, mint an application session and use it for API auth.

### Risks
- More surface area to secure (challenge generation, attestation policy, counter checks, replay).
- Harder to implement account recovery safely.

---

# Data model (applies to both options)

## Tables
1) `auth_identities`
- `user_id` (internal UUID)
- `provider` enum: `supabase | auth0 | clerk | firebase | workos`
- `external_subject` (string, indexed, unique)
- `created_at`

2) `auth_events` (audit)
- `user_id`, `event_type`, `ip`, `ua_hash`, `created_at`
- store minimal metadata; avoid raw UA/IP where possible (hash/truncate)

3) (Option B only) `webauthn_credentials`
- `user_id`
- `credential_id` (bytes/base64, unique)
- `public_key` (bytes)
- `sign_count` (integer)
- `transports` (json)
- `created_at`, `last_used_at`, `revoked_at`

---

# UX flows

## Registration / upgrade
- After a successful legacy login, prompt:
  - “Add a passkey” (one tap)
- Offer “Not now” and remind later (do not block).

## Sign-in
- Primary button: “Continue with passkey”
- Secondary: “Other options” (OTP / email link / SSO)
- If multiple accounts exist, support account selection UX per platform.

## Recovery
- Recovery paths should not undo the security benefits:
  - email magic link OR verified phone OTP
  - optional: backup codes
  - for admin: require additional verification or manual support

---

# Security policy

## Relying party configuration
- Use a stable RP ID (domain) across environments:
  - `staging.example.com` vs `example.com` require separate association files
- Bind mobile apps to RP domain via platform mechanisms (e.g., Android Digital Asset Links per Google docs).

## Step-up auth for sensitive actions
- Require a fresh passkey assertion for:
  - payout destination changes
  - refund approvals
  - role changes / admin actions
- Store “last_step_up_at” server-side with short TTL (e.g., 10 minutes).

## Abuse controls
- Rate-limit registration attempts and sign-in attempts by device/IP.
- Detect suspicious spikes and block.

---

# Implementation plan (Option A)

1) Select IdP (Auth0/Clerk/Firebase/WorkOS) based on:
- passkey support on iOS/Android/web
- SDK maturity
- pricing and rate limits
- multi-tenant admin support (if needed)

2) Configure IdP
- Enable WebAuthn/passkeys
- Set domain + app association (iOS associated domains, Android asset links)

3) Configure Supabase third-party auth
- Set JWT verification and claims mapping
- Ensure `sub` maps to internal `user_id` via `auth_identities`

4) Update clients
- Replace existing auth screens with passkey-first UX
- Preserve legacy options behind “Other options”

5) Update backend authorization contract
- Edge Functions validate JWT and derive `actor_id`
- RLS uses `auth.uid()` or mapped claim consistently

6) Rollout
- internal → beta cohort → general
- measure sign-in success rate and recovery issues

---

# Acceptance criteria
- Passkey sign-in works on iOS + Android + web (where applicable).
- No increase in account lockouts; recovery flow is reliable.
- Privileged actions require step-up auth and are fully audited.
