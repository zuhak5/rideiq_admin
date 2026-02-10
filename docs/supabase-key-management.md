# Supabase key management (types, naming, rotation)

## Key types we support

Supabase has two **API key models**:

1) **New (recommended) API keys**
- **Publishable key** (prefix: `sb_publishable_...`) — safe to expose in public clients.
- **Secret key** (prefix: `sb_secret_...`) — server-only, elevated access, bypasses RLS.

2) **Legacy API keys** (JWT-based, long-lived)
- `anon` — equivalent to publishable.
- `service_role` — equivalent to secret.

The legacy keys are JWTs signed with the project JWT secret and are **harder to rotate safely** in production. For Supabase hosted projects, use publishable + secret keys.

## Standardized env var names

### Frontend (Vite)
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY` (preferred; may contain `sb_publishable_...` or legacy `anon` JWT)

Optional alias (accepted, but avoid in new deployments):
- `VITE_SUPABASE_PUBLISHABLE_KEY` → treated as `VITE_SUPABASE_ANON_KEY`

### Backend (Edge Functions)
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY` (preferred; may contain `sb_publishable_...` or legacy `anon` JWT)
- `SUPABASE_SERVICE_ROLE_KEY` (preferred; may contain `sb_secret_...` or legacy `service_role` JWT)

Optional aliases (accepted, but avoid in new deployments):
- `SUPABASE_PUBLISHABLE_KEY` → treated as `SUPABASE_ANON_KEY`
- `SUPABASE_SECRET_KEY` → treated as `SUPABASE_SERVICE_ROLE_KEY`

## Code conventions

- **Client apps** must only use publishable/anon keys.
- **Edge Functions / servers**:
  - Use publishable/anon for user-context calls (RLS enforced).
  - Use secret/service_role only for explicitly privileged tasks (admin, scheduled jobs).

In Edge Functions we pass user JWTs via the Supabase client `accessToken` option (not by setting `Authorization` as a fixed global header).

## Rotation strategy

### Publishable key
- Treat as **public**.
- Rotation is optional; do it if you suspect abuse or as part of periodic hygiene.

Process:
1. Create a new publishable key in Supabase dashboard.
2. Update:
   - `VITE_SUPABASE_ANON_KEY` (frontend)
   - `SUPABASE_ANON_KEY` (Edge Functions)
3. Deploy.
4. Revoke the previous publishable key.

### Secret key
- Treat as a **high-value credential**.
- Rotate on a schedule (e.g., quarterly) and immediately after any suspected leak.

Process:
1. Create a new secret key in Supabase dashboard.
2. Update server environments:
   - `SUPABASE_SERVICE_ROLE_KEY` for Edge Functions (and any other backend).
3. Deploy.
4. Revoke the previous secret key.

### JWT signing keys (Auth)
If you enable asymmetric JWT signing keys (recommended), JWT verification can be done locally using JWKS.

Rotation guidance:
- Add a new signing key (standby).
- Rotate (both keys trusted).
- Wait until old JWTs expire + buffer before revoking the old key.

See Supabase docs for cache and timing guidance.

## Incident response (key leak)

1. Rotate the exposed key(s) immediately.
2. If a **secret/service_role** key leaked: assume full DB read/write; review logs and audit.
3. Re-deploy all services with the new key.
4. Revoke the old key.
5. If any JWT signing material was exposed, rotate signing keys and consider forcing re-auth.
