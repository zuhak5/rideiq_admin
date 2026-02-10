-- Session 12 — Safety superpowers: lock-screen live trip tracking
--
-- Additive, deterministic migration.
--
-- Provides:
-- - trip_live_activities table for push token storage
-- - Trip status broadcaster helper functions
-- - Throttling rules storage

set lock_timeout = '5s';
set statement_timeout = '60s';

--------------------------------------------------------------------------------
-- LIVE ACTIVITY TOKEN STORAGE
--------------------------------------------------------------------------------

-- Platform enum for live activities
do $$
begin
  if not exists (select 1 from pg_type where typname = 'live_activity_platform') then
    create type public.live_activity_platform as enum ('ios', 'android');
  end if;

  if not exists (select 1 from pg_type where typname = 'trip_live_status') then
    create type public.trip_live_status as enum (
      'driver_assigned',
      'driver_arriving',
      'driver_arrived',
      'trip_started',
      'trip_paused',
      'near_destination',
      'trip_completed',
      'trip_cancelled'
    );
  end if;
end
$$;

-- Trip live activities table (push tokens for lock-screen updates)
create table if not exists public.trip_live_activities (
  id uuid default gen_random_uuid() primary key,
  trip_id uuid not null,  -- references rides table
  user_id uuid not null references auth.users(id) on delete cascade,
  platform public.live_activity_platform not null,
  token text not null,  -- platform-specific push token
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_at timestamptz null,
  last_pushed_at timestamptz null,
  push_count integer not null default 0,

  -- Privacy settings
  show_full_addresses boolean not null default false,

  constraint trip_live_activities_trip_platform_unique unique (trip_id, platform, user_id)
);

create index if not exists ix_trip_live_activities_trip on public.trip_live_activities(trip_id) where revoked_at is null;
create index if not exists ix_trip_live_activities_user on public.trip_live_activities(user_id, created_at desc);

-- RLS: users can manage their own live activities
alter table public.trip_live_activities enable row level security;

drop policy if exists trip_live_activities_own on public.trip_live_activities;
create policy trip_live_activities_own on public.trip_live_activities
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists trip_live_activities_service on public.trip_live_activities;
create policy trip_live_activities_service on public.trip_live_activities
  to service_role
  using (true)
  with check (true);

-- Trip status history for broadcasting
create table if not exists public.trip_status_transitions (
  id uuid default gen_random_uuid() primary key,
  trip_id uuid not null,
  old_status text null,
  new_status text not null,
  eta_minutes integer null,
  distance_remaining_m integer null,
  created_at timestamptz not null default now(),
  broadcast_sent boolean not null default false,
  broadcast_at timestamptz null
);

create index if not exists ix_trip_status_transitions_trip
  on public.trip_status_transitions(trip_id, created_at desc);

create index if not exists ix_trip_status_transitions_pending
  on public.trip_status_transitions(created_at)
  where broadcast_sent = false;

-- RLS: service_role only
alter table public.trip_status_transitions enable row level security;

drop policy if exists trip_status_transitions_service on public.trip_status_transitions;
create policy trip_status_transitions_service on public.trip_status_transitions
  to service_role
  using (true)
  with check (true);

--------------------------------------------------------------------------------
-- LIVE ACTIVITY MANAGEMENT RPC
--------------------------------------------------------------------------------

-- Register a live activity token
create or replace function public.trip_live_activity_register(
  p_trip_id uuid,
  p_platform public.live_activity_platform,
  p_token text,
  p_show_full_addresses boolean default false
)
returns public.trip_live_activities
language plpgsql
security definer
set search_path = 'pg_catalog, public'
as $$
declare
  v_activity public.trip_live_activities;
begin
  insert into public.trip_live_activities (
    trip_id, user_id, platform, token, show_full_addresses
  ) values (
    p_trip_id, auth.uid(), p_platform, p_token, p_show_full_addresses
  )
  on conflict (trip_id, platform, user_id) do update set
    token = excluded.token,
    show_full_addresses = excluded.show_full_addresses,
    revoked_at = null,
    updated_at = now()
  returning * into v_activity;

  return v_activity;
end;
$$;

grant execute on function public.trip_live_activity_register(uuid, public.live_activity_platform, text, boolean) to authenticated;

-- Revoke a live activity (trip ended)
create or replace function public.trip_live_activity_revoke(p_trip_id uuid)
returns void
language plpgsql
security definer
set search_path = 'pg_catalog, public'
as $$
begin
  update public.trip_live_activities
  set revoked_at = now(), updated_at = now()
  where trip_id = p_trip_id
    and user_id = auth.uid()
    and revoked_at is null;
end;
$$;

grant execute on function public.trip_live_activity_revoke(uuid) to authenticated;

-- Get active tokens for a trip (service_role only, for broadcasting)
create or replace function public.trip_live_activity_get_tokens(p_trip_id uuid)
returns table(
  id uuid,
  user_id uuid,
  platform public.live_activity_platform,
  token text,
  show_full_addresses boolean,
  push_count integer
)
language sql
security definer
set search_path = 'pg_catalog, public'
as $$
  select a.id, a.user_id, a.platform, a.token, a.show_full_addresses, a.push_count
  from public.trip_live_activities a
  where a.trip_id = p_trip_id
    and a.revoked_at is null
$$;

revoke all on function public.trip_live_activity_get_tokens(uuid) from public, anon, authenticated;
grant execute on function public.trip_live_activity_get_tokens(uuid) to service_role;

-- Record a push and update counters
create or replace function public.trip_live_activity_record_push(p_activity_id uuid)
returns void
language plpgsql
security definer
set search_path = 'pg_catalog, public'
as $$
begin
  update public.trip_live_activities
  set push_count = push_count + 1,
      last_pushed_at = now(),
      updated_at = now()
  where id = p_activity_id;
end;
$$;

revoke all on function public.trip_live_activity_record_push(uuid) from public, anon, authenticated;
grant execute on function public.trip_live_activity_record_push(uuid) to service_role;

--------------------------------------------------------------------------------
-- TRIP STATUS BROADCASTER HELPERS
--------------------------------------------------------------------------------

-- Record a status transition for broadcasting
create or replace function public.trip_record_status_transition(
  p_trip_id uuid,
  p_old_status text,
  p_new_status text,
  p_eta_minutes integer default null,
  p_distance_remaining_m integer default null
)
returns public.trip_status_transitions
language plpgsql
security definer
set search_path = 'pg_catalog, public'
as $$
declare
  v_transition public.trip_status_transitions;
begin
  insert into public.trip_status_transitions (
    trip_id, old_status, new_status, eta_minutes, distance_remaining_m
  ) values (
    p_trip_id, p_old_status, p_new_status, p_eta_minutes, p_distance_remaining_m
  )
  returning * into v_transition;

  return v_transition;
end;
$$;

revoke all on function public.trip_record_status_transition(uuid, text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.trip_record_status_transition(uuid, text, text, integer, integer) to service_role;

-- Claim pending transitions for broadcasting (using SKIP LOCKED)
create or replace function public.trip_claim_pending_broadcasts(p_limit integer default 100)
returns table(
  transition_id uuid,
  trip_id uuid,
  new_status text,
  eta_minutes integer,
  distance_remaining_m integer
)
language plpgsql
security definer
set search_path = 'pg_catalog, public'
as $$
begin
  return query
  with claimed as (
    select t.id, t.trip_id, t.new_status, t.eta_minutes, t.distance_remaining_m
    from public.trip_status_transitions t
    where t.broadcast_sent = false
    order by t.created_at asc
    limit p_limit
    for update skip locked
  )
  update public.trip_status_transitions ts
  set broadcast_sent = true, broadcast_at = now()
  from claimed c
  where ts.id = c.id
  returning c.id as transition_id, c.trip_id, c.new_status, c.eta_minutes, c.distance_remaining_m;
end;
$$;

revoke all on function public.trip_claim_pending_broadcasts(integer) from public, anon, authenticated;
grant execute on function public.trip_claim_pending_broadcasts(integer) to service_role;

--------------------------------------------------------------------------------
-- THROTTLING CONFIG
--------------------------------------------------------------------------------

-- Live activity update throttling settings
create table if not exists public.live_activity_throttle_config (
  id uuid default gen_random_uuid() primary key,
  platform public.live_activity_platform not null unique,
  min_interval_seconds integer not null default 30,
  max_updates_per_trip integer not null default 50,
  significant_eta_change_minutes integer not null default 2,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- RLS: service_role only
alter table public.live_activity_throttle_config enable row level security;

drop policy if exists live_activity_throttle_config_service on public.live_activity_throttle_config;
create policy live_activity_throttle_config_service on public.live_activity_throttle_config
  to service_role
  using (true)
  with check (true);

-- Insert default throttle config
insert into public.live_activity_throttle_config (platform, min_interval_seconds, max_updates_per_trip, significant_eta_change_minutes)
values
  ('ios', 30, 50, 2),
  ('android', 30, 50, 2)
on conflict (platform) do nothing;

-- Get throttle config for platform
create or replace function public.get_live_activity_throttle_config(p_platform public.live_activity_platform)
returns table(
  min_interval_seconds integer,
  max_updates_per_trip integer,
  significant_eta_change_minutes integer
)
language sql
security definer
set search_path = 'pg_catalog, public'
as $$
  select c.min_interval_seconds, c.max_updates_per_trip, c.significant_eta_change_minutes
  from public.live_activity_throttle_config c
  where c.platform = p_platform
$$;

grant execute on function public.get_live_activity_throttle_config(public.live_activity_platform) to authenticated;
grant execute on function public.get_live_activity_throttle_config(public.live_activity_platform) to service_role;

--------------------------------------------------------------------------------
-- GRANTS
--------------------------------------------------------------------------------

grant select, insert, update on table public.trip_live_activities to authenticated;
grant all on table public.trip_live_activities to service_role;

grant all on table public.trip_status_transitions to service_role;
grant all on table public.live_activity_throttle_config to service_role;
;
