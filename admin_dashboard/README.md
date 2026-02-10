# RideIQ Admin Dashboard

A standalone admin console for the RideIQ stack (Supabase backend) built with Next.js (App Router) + Supabase SSR auth.

## Quickstart

```bash
pnpm -C admin_dashboard install
cp admin_dashboard/.env.example admin_dashboard/.env.local
pnpm -C admin_dashboard dev
```

Open: http://localhost:3001

## Security model

- Auth: Supabase Auth with HTTP-only session cookies (SSR-compatible).
- Authorization: Admin-only pages check `public.is_admin()` via RPC.
- Data access: Calls to Supabase Edge Functions / RPC are made with the logged-in user's JWT and guarded server-side.

## Test

```bash
pnpm -C admin_dashboard test
pnpm -C admin_dashboard test:e2e
```
