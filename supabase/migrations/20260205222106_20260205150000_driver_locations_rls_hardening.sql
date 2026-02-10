-- Session 08 (deep check) — driver_locations RLS hardening
--
-- Why:
-- - `driver_locations` contains high-sensitivity location data.
-- - Supabase projects often grant default privileges to authenticated.
-- - RLS must be explicit and replayable via migrations (avoid relying on schema.sql drift).
--
-- Policy model:
-- - authenticated: driver can read/write only their own row (driver_id = auth.uid()).
-- - service_role: full access for dispatch + backends.

begin;

-- Ensure RLS is enabled.
alter table if exists public.driver_locations enable row level security;

-- Authenticated policies (self-scope).
drop policy if exists rls_select on public.driver_locations;
create policy rls_select
  on public.driver_locations
  for select
  to authenticated
  using (driver_id = (select auth.uid() as uid));

drop policy if exists rls_insert on public.driver_locations;
create policy rls_insert
  on public.driver_locations
  for insert
  to authenticated
  with check (driver_id = (select auth.uid() as uid));

drop policy if exists rls_update on public.driver_locations;
create policy rls_update
  on public.driver_locations
  for update
  to authenticated
  using (driver_id = (select auth.uid() as uid))
  with check (driver_id = (select auth.uid() as uid));

drop policy if exists rls_delete on public.driver_locations;
create policy rls_delete
  on public.driver_locations
  for delete
  to authenticated
  using (driver_id = (select auth.uid() as uid));

-- Service role full access.
drop policy if exists rls_service_role_all on public.driver_locations;
create policy rls_service_role_all
  on public.driver_locations
  for all
  to service_role
  using (true)
  with check (true);

-- Explicit privileges (defense-in-depth).
revoke all on table public.driver_locations from anon, authenticated;
grant all on table public.driver_locations to authenticated, service_role;

commit;
;
