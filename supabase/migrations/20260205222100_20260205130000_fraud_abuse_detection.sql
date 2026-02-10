-- Session 09 - Fraud/abuse detection primitives
--
-- Additive, deterministic migration.
--
-- Provides:
-- - Fraud event log (privacy-aware)
-- - Manual review queue (cases)
-- - Enforcement actions (temporary blocks/holds)
-- - Service-role-only RPC helpers
-- - Anomaly candidate queries (route deviation, repeated short rides)

set lock_timeout = '5s';
set statement_timeout = '60s';

-- Enums (idempotent)
do $$
begin
  if not exists (select 1 from pg_type where typname = 'fraud_subject_kind') then
    create type public.fraud_subject_kind as enum ('user', 'driver', 'device', 'ip_prefix');
  end if;

  if not exists (select 1 from pg_type where typname = 'fraud_case_status') then
    create type public.fraud_case_status as enum ('open', 'closed');
  end if;
end
$$;

-- Core tables
create table if not exists public.fraud_events (
  id uuid default gen_random_uuid() primary key,
  created_at timestamptz not null default now(),

  reason text not null,
  severity int not null default 1 check (severity >= 1 and severity <= 5),
  score int not null default 0,
  dedupe_key text null,

  subject_kind public.fraud_subject_kind not null,
  subject_key text not null,

  ip_prefix text null,
  device_hash text null,

  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.fraud_cases (
  id uuid default gen_random_uuid() primary key,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  status public.fraud_case_status not null default 'open',
  reason text not null,
  severity int not null default 1 check (severity >= 1 and severity <= 5),

  subject_kind public.fraud_subject_kind not null,
  subject_key text not null,

  opened_by text not null default 'system',
  closed_at timestamptz null,
  closed_by uuid null,
  closure_notes text null,

  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.fraud_case_events (
  case_id uuid not null references public.fraud_cases(id) on delete cascade,
  event_id uuid not null references public.fraud_events(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (case_id, event_id)
);

create table if not exists public.fraud_enforcement_actions (
  id uuid default gen_random_uuid() primary key,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  action_type text not null,
  subject_kind public.fraud_subject_kind not null,
  subject_key text not null,

  reason text not null,
  severity int not null default 1 check (severity >= 1 and severity <= 5),

  expires_at timestamptz null,
  expired_at timestamptz null,
  resolved_at timestamptz null,
  resolved_by uuid null,
  resolution_notes text null,

  metadata jsonb not null default '{}'::jsonb
);

-- Indexes
create unique index if not exists fraud_events_dedupe_key_unique
  on public.fraud_events(dedupe_key)
  where dedupe_key is not null;

create unique index if not exists fraud_cases_one_open_per_subject_reason
  on public.fraud_cases(subject_kind, subject_key, reason)
  where status = 'open';

create unique index if not exists fraud_actions_one_active_per_subject_type
  on public.fraud_enforcement_actions(subject_kind, subject_key, action_type)
  where expired_at is null and resolved_at is null;

create index if not exists fraud_events_subject_created_at
  on public.fraud_events(subject_kind, subject_key, created_at desc);

create index if not exists fraud_actions_subject_expires
  on public.fraud_enforcement_actions(subject_kind, subject_key, expires_at);

-- RLS + privileges (service_role only)
alter table public.fraud_events enable row level security;
alter table public.fraud_cases enable row level security;
alter table public.fraud_case_events enable row level security;
alter table public.fraud_enforcement_actions enable row level security;

drop policy if exists rls_service_role_all on public.fraud_events;
create policy rls_service_role_all on public.fraud_events to service_role using (true) with check (true);

drop policy if exists rls_service_role_all on public.fraud_cases;
create policy rls_service_role_all on public.fraud_cases to service_role using (true) with check (true);

drop policy if exists rls_service_role_all on public.fraud_case_events;
create policy rls_service_role_all on public.fraud_case_events to service_role using (true) with check (true);

drop policy if exists rls_service_role_all on public.fraud_enforcement_actions;
create policy rls_service_role_all on public.fraud_enforcement_actions to service_role using (true) with check (true);

revoke all on table public.fraud_events from public, anon, authenticated;
revoke all on table public.fraud_cases from public, anon, authenticated;
revoke all on table public.fraud_case_events from public, anon, authenticated;
revoke all on table public.fraud_enforcement_actions from public, anon, authenticated;

grant select, insert, update, delete on table public.fraud_events to service_role;
grant select, insert, update, delete on table public.fraud_cases to service_role;
grant select, insert, update, delete on table public.fraud_case_events to service_role;
grant select, insert, update, delete on table public.fraud_enforcement_actions to service_role;

-- updated_at triggers (guarded)
do $$
begin
  if exists (select 1 from pg_proc where proname = 'set_updated_at' and pg_function_is_visible(oid)) then
    drop trigger if exists fraud_cases_set_updated_at on public.fraud_cases;
    create trigger fraud_cases_set_updated_at
      before update on public.fraud_cases
      for each row execute function public.set_updated_at();

    drop trigger if exists fraud_actions_set_updated_at on public.fraud_enforcement_actions;
    create trigger fraud_actions_set_updated_at
      before update on public.fraud_enforcement_actions
      for each row execute function public.set_updated_at();
  end if;
end
$$;

-- Internal helper: enforce service_role
create or replace function public._fraud_require_service_role()
returns void
language plpgsql
security definer
set search_path to 'pg_catalog, public'
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'forbidden';
  end if;
end
$$;

revoke all on function public._fraud_require_service_role() from public, anon, authenticated;
grant execute on function public._fraud_require_service_role() to service_role;

-- RPC: log event (idempotent via dedupe_key)
create or replace function public.fraud_log_event(
  p_reason text,
  p_subject_kind public.fraud_subject_kind,
  p_subject_key text,
  p_severity int default 1,
  p_score int default 0,
  p_dedupe_key text default null,
  p_ip_prefix text default null,
  p_device_hash text default null,
  p_metadata jsonb default '{}'::jsonb
) returns public.fraud_events
language plpgsql
security definer
set search_path to 'pg_catalog, public'
as $$
declare
  out public.fraud_events;
begin
  perform public._fraud_require_service_role();

  insert into public.fraud_events (
    reason, subject_kind, subject_key, severity, score, dedupe_key, ip_prefix, device_hash, metadata
  ) values (
    p_reason, p_subject_kind, p_subject_key, greatest(1, least(5, p_severity)), p_score, p_dedupe_key, p_ip_prefix, p_device_hash, coalesce(p_metadata, '{}'::jsonb)
  )
  on conflict (dedupe_key) where (dedupe_key is not null)
  do update set metadata = public.fraud_events.metadata || excluded.metadata
  returning * into out;

  return out;
end
$$;

revoke all on function public.fraud_log_event(text, public.fraud_subject_kind, text, int, int, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.fraud_log_event(text, public.fraud_subject_kind, text, int, int, text, text, text, jsonb) to service_role;

-- RPC: open/merge a manual review case (idempotent for open cases)
create or replace function public.fraud_open_case(
  p_reason text,
  p_subject_kind public.fraud_subject_kind,
  p_subject_key text,
  p_severity int default 1,
  p_metadata jsonb default '{}'::jsonb,
  p_opened_by text default 'system'
) returns public.fraud_cases
language plpgsql
security definer
set search_path to 'pg_catalog, public'
as $$
declare
  out public.fraud_cases;
begin
  perform public._fraud_require_service_role();

  insert into public.fraud_cases (
    reason, subject_kind, subject_key, severity, metadata, opened_by, status
  ) values (
    p_reason, p_subject_kind, p_subject_key, greatest(1, least(5, p_severity)), coalesce(p_metadata, '{}'::jsonb), coalesce(nullif(p_opened_by, ''), 'system'), 'open'
  )
  on conflict (subject_kind, subject_key, reason) where (status = 'open')
  do update set
    severity = greatest(public.fraud_cases.severity, excluded.severity),
    metadata = public.fraud_cases.metadata || excluded.metadata,
    updated_at = now()
  returning * into out;

  return out;
end
$$;

revoke all on function public.fraud_open_case(text, public.fraud_subject_kind, text, int, jsonb, text) from public, anon, authenticated;
grant execute on function public.fraud_open_case(text, public.fraud_subject_kind, text, int, jsonb, text) to service_role;

-- RPC: attach event to case (idempotent)
create or replace function public.fraud_attach_event_to_case(p_case_id uuid, p_event_id uuid)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog, public'
as $$
begin
  perform public._fraud_require_service_role();

  insert into public.fraud_case_events(case_id, event_id)
  values (p_case_id, p_event_id)
  on conflict do nothing;
end
$$;

revoke all on function public.fraud_attach_event_to_case(uuid, uuid) from public, anon, authenticated;
grant execute on function public.fraud_attach_event_to_case(uuid, uuid) to service_role;

-- RPC: enforce action (idempotent for active action)
create or replace function public.fraud_enforce_action(
  p_action_type text,
  p_subject_kind public.fraud_subject_kind,
  p_subject_key text,
  p_reason text,
  p_severity int default 1,
  p_expires_at timestamptz default null,
  p_metadata jsonb default '{}'::jsonb
) returns public.fraud_enforcement_actions
language plpgsql
security definer
set search_path to 'pg_catalog, public'
as $$
declare
  out public.fraud_enforcement_actions;
begin
  perform public._fraud_require_service_role();

  insert into public.fraud_enforcement_actions (
    action_type, subject_kind, subject_key, reason, severity, expires_at, metadata
  ) values (
    p_action_type, p_subject_kind, p_subject_key, p_reason, greatest(1, least(5, p_severity)), p_expires_at, coalesce(p_metadata, '{}'::jsonb)
  )
  on conflict (subject_kind, subject_key, action_type) where (expired_at is null and resolved_at is null)
  do update set
    severity = greatest(public.fraud_enforcement_actions.severity, excluded.severity),
    reason = excluded.reason,
    expires_at = case
      when public.fraud_enforcement_actions.expires_at is null then excluded.expires_at
      when excluded.expires_at is null then public.fraud_enforcement_actions.expires_at
      else greatest(public.fraud_enforcement_actions.expires_at, excluded.expires_at)
    end,
    metadata = public.fraud_enforcement_actions.metadata || excluded.metadata,
    updated_at = now()
  returning * into out;

  return out;
end
$$;

revoke all on function public.fraud_enforce_action(text, public.fraud_subject_kind, text, text, int, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.fraud_enforce_action(text, public.fraud_subject_kind, text, text, int, timestamptz, jsonb) to service_role;

-- RPC: get active action
create or replace function public.fraud_get_active_action(
  p_action_type text,
  p_subject_kind public.fraud_subject_kind,
  p_subject_key text
) returns table(id uuid, reason text, severity int, expires_at timestamptz, metadata jsonb)
language sql
security definer
set search_path to 'pg_catalog, public'
as $$
  select a.id, a.reason, a.severity, a.expires_at, a.metadata
  from public.fraud_enforcement_actions a
  where a.action_type = p_action_type
    and a.subject_kind = p_subject_kind
    and a.subject_key = p_subject_key
    and a.expired_at is null
    and a.resolved_at is null
    and (a.expires_at is null or a.expires_at > now())
  order by a.severity desc, a.created_at desc
  limit 1
$$;

revoke all on function public.fraud_get_active_action(text, public.fraud_subject_kind, text) from public, anon, authenticated;
grant execute on function public.fraud_get_active_action(text, public.fraud_subject_kind, text) to service_role;

create or replace function public.fraud_has_active_action(
  p_action_type text,
  p_subject_kind public.fraud_subject_kind,
  p_subject_key text
) returns boolean
language plpgsql
security definer
set search_path to 'pg_catalog, public'
as $$
declare
  v_exists boolean;
begin
  perform public._fraud_require_service_role();

  select exists(
    select 1
    from public.fraud_enforcement_actions a
    where a.action_type = p_action_type
      and a.subject_kind = p_subject_kind
      and a.subject_key = p_subject_key
      and a.expired_at is null
      and a.resolved_at is null
      and (a.expires_at is null or a.expires_at > now())
  ) into v_exists;

  return v_exists;
end
$$;

revoke all on function public.fraud_has_active_action(text, public.fraud_subject_kind, text) from public, anon, authenticated;
grant execute on function public.fraud_has_active_action(text, public.fraud_subject_kind, text) to service_role;

-- RPC: expire actions whose expires_at has passed
create or replace function public.fraud_expire_actions()
returns int
language plpgsql
security definer
set search_path to 'pg_catalog, public'
as $$
declare
  n int;
begin
  perform public._fraud_require_service_role();

  update public.fraud_enforcement_actions
    set expired_at = now(),
        updated_at = now()
  where expired_at is null
    and resolved_at is null
    and expires_at is not null
    and expires_at <= now();

  get diagnostics n = row_count;
  return n;
end
$$;

revoke all on function public.fraud_expire_actions() from public, anon, authenticated;
grant execute on function public.fraud_expire_actions() to service_role;

create or replace function public.fraud_resolve_action(p_action_id uuid, p_resolved_by uuid, p_notes text default null)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog, public'
as $$
begin
  perform public._fraud_require_service_role();

  update public.fraud_enforcement_actions
    set resolved_at = now(),
        resolved_by = p_resolved_by,
        resolution_notes = p_notes,
        updated_at = now()
  where id = p_action_id;
end
$$;

revoke all on function public.fraud_resolve_action(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.fraud_resolve_action(uuid, uuid, text) to service_role;

create or replace function public.fraud_close_case(p_case_id uuid, p_closed_by uuid, p_notes text default null)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog, public'
as $$
begin
  perform public._fraud_require_service_role();

  update public.fraud_cases
    set status = 'closed',
        closed_at = now(),
        closed_by = p_closed_by,
        closure_notes = p_notes,
        updated_at = now()
  where id = p_case_id;
end
$$;

revoke all on function public.fraud_close_case(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.fraud_close_case(uuid, uuid, text) to service_role;

-- Anomaly candidates: route deviation (based on ridecheck_state)
create or replace function public.fraud_find_route_deviation_candidates(
  p_min_streak int default 3,
  p_seen_since interval default interval '30 minutes'
) returns table(ride_id uuid, rider_id uuid, driver_id uuid, distance_increase_streak int, last_seen_at timestamptz)
language sql
security definer
set search_path to 'pg_catalog, public, extensions'
as $$
  select s.ride_id, r.rider_id, r.driver_id, s.distance_increase_streak, s.last_seen_at
  from public.ridecheck_state s
  join public.rides r on r.id = s.ride_id
  where s.distance_increase_streak >= p_min_streak
    and s.last_seen_at >= now() - p_seen_since
    and r.status in ('in_progress','arrived','assigned')
$$;

revoke all on function public.fraud_find_route_deviation_candidates(int, interval) from public, anon, authenticated;
grant execute on function public.fraud_find_route_deviation_candidates(int, interval) to service_role;

-- Anomaly candidates: repeated short rides (potential collusion)
create or replace function public.fraud_find_collusion_candidates(
  p_since interval default interval '7 days',
  p_min_count int default 5,
  p_max_trip_distance_m int default 2000
) returns table(driver_id uuid, rider_id uuid, ride_count int, first_ride_at timestamptz, last_ride_at timestamptz)
language sql
security definer
set search_path to 'pg_catalog, public, extensions'
as $$
  with pairs as (
    select
      r.driver_id,
      rr.rider_id,
      count(*)::int as ride_count,
      min(r.created_at) as first_ride_at,
      max(r.created_at) as last_ride_at
    from public.rides r
    join public.ride_requests rr on rr.id = r.request_id
    where r.status = 'completed'
      and r.created_at >= now() - p_since
      and extensions.st_distance(rr.pickup_loc, rr.dropoff_loc) <= p_max_trip_distance_m
    group by r.driver_id, rr.rider_id
  )
  select * from pairs
  where ride_count >= p_min_count
  order by ride_count desc, last_ride_at desc
$$;

revoke all on function public.fraud_find_collusion_candidates(interval, int, int) from public, anon, authenticated;
grant execute on function public.fraud_find_collusion_candidates(interval, int, int) to service_role;

-- Ops view: event/case/action counts
create or replace view public.ops_fraud_metrics_15m as
select
  date_trunc('minute', now()) - make_interval(mins => (extract(minute from now())::int % 15)) as bucket_start,
  (select count(*) from public.fraud_events e where e.created_at >= now() - interval '15 minutes') as events_15m,
  (select count(*) from public.fraud_cases c where c.created_at >= now() - interval '15 minutes' and c.status = 'open') as open_cases_created_15m,
  (select count(*) from public.fraud_enforcement_actions a where a.expired_at is null and a.resolved_at is null and (a.expires_at is null or a.expires_at > now())) as active_actions;

revoke all on table public.ops_fraud_metrics_15m from public, anon, authenticated;
grant select on table public.ops_fraud_metrics_15m to service_role;
;
