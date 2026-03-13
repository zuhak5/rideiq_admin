-- Session 14 — Driver stickiness: shift planner + hotspot guidance + earnings coach (FIXED V2)
--
-- Fixed index predicates using now() which is not allowed.
-- Fixed get_nearby_hotspots function (HAVING vs WHERE).

set lock_timeout = '5s';
set statement_timeout = '60s';

--------------------------------------------------------------------------------
-- PART A: SMART SHIFT PLANNER
--------------------------------------------------------------------------------

-- Shift types
do $$
begin
  if not exists (select 1 from pg_type where typname = 'shift_status') then
    create type public.shift_status as enum ('draft', 'scheduled', 'active', 'completed', 'cancelled');
  end if;
end
$$;

-- Driver shifts
create table if not exists public.driver_shifts (
  id uuid default gen_random_uuid() primary key,
  driver_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  status public.shift_status not null default 'draft',
  scheduled_start timestamptz not null,
  scheduled_end timestamptz not null,

  actual_start timestamptz null,
  actual_end timestamptz null,

  -- Targeting
  target_earnings_iqd bigint null,
  target_trips integer null,
  preferred_zones text[] null,

  -- Reminders
  reminder_minutes_before integer not null default 30,
  reminder_sent_at timestamptz null,

  -- Notes
  notes text null,

  constraint driver_shifts_valid_schedule check (scheduled_end > scheduled_start)
);

create index if not exists ix_driver_shifts_driver on public.driver_shifts(driver_id, scheduled_start desc);
create index if not exists ix_driver_shifts_active on public.driver_shifts(driver_id, status) where status = 'active';
create index if not exists ix_driver_shifts_reminders on public.driver_shifts(scheduled_start, reminder_sent_at)
  where status = 'scheduled' and reminder_sent_at is null;

-- RLS: drivers own their shifts
alter table public.driver_shifts enable row level security;

drop policy if exists driver_shifts_own on public.driver_shifts;
create policy driver_shifts_own on public.driver_shifts
  for all
  to authenticated
  using (auth.uid() = driver_id)
  with check (auth.uid() = driver_id);

drop policy if exists driver_shifts_service on public.driver_shifts;
create policy driver_shifts_service on public.driver_shifts
  to service_role
  using (true)
  with check (true);

-- Shift goal progress (real-time during active shift)
create table if not exists public.shift_progress (
  id uuid default gen_random_uuid() primary key,
  shift_id uuid not null references public.driver_shifts(id) on delete cascade,
  created_at timestamptz not null default now(),

  trips_completed integer not null default 0,
  earnings_iqd bigint not null default 0,
  online_minutes integer not null default 0,
  avg_rating numeric null
);

create unique index if not exists ix_shift_progress_shift on public.shift_progress(shift_id);

alter table public.shift_progress enable row level security;

drop policy if exists shift_progress_service on public.shift_progress;
create policy shift_progress_service on public.shift_progress
  to service_role
  using (true)
  with check (true);

--------------------------------------------------------------------------------
-- PART B: HOTSPOT / DEMAND GUIDANCE
--------------------------------------------------------------------------------

-- Demand hotspots (computed periodically)
create table if not exists public.demand_hotspots (
  id uuid default gen_random_uuid() primary key,
  created_at timestamptz not null default now(),
  valid_until timestamptz not null,

  -- Location
  zone_id text not null,
  zone_name text not null,
  center_lat double precision not null,
  center_lng double precision not null,
  radius_m integer not null default 500,

  -- Demand signal
  demand_level integer not null check (demand_level between 1 and 5),  -- 1=low, 5=surge
  expected_wait_minutes integer null,
  surge_multiplier numeric null,

  -- Driver context
  nearby_driver_count integer null,
  trips_last_hour integer null
);

create index if not exists ix_demand_hotspots_active on public.demand_hotspots(valid_until);
create index if not exists ix_demand_hotspots_zone on public.demand_hotspots(zone_id, valid_until desc);

alter table public.demand_hotspots enable row level security;

-- Hotspots are publicly readable for drivers
drop policy if exists demand_hotspots_read on public.demand_hotspots;
create policy demand_hotspots_read on public.demand_hotspots
  for select
  to authenticated
  using (valid_until > now());

drop policy if exists demand_hotspots_service on public.demand_hotspots;
create policy demand_hotspots_service on public.demand_hotspots
  to service_role
  using (true)
  with check (true);

-- Earnings forecast by hour (ML model outputs)
create table if not exists public.earnings_forecasts (
  id uuid default gen_random_uuid() primary key,
  created_at timestamptz not null default now(),
  forecast_date date not null,
  hour_of_day integer not null check (hour_of_day between 0 and 23),

  zone_id text not null,
  expected_earnings_iqd bigint not null,
  expected_trips integer not null,
  confidence_pct numeric not null check (confidence_pct between 0 and 100),

  -- Historical context
  same_hour_last_week_iqd bigint null,

  constraint earnings_forecasts_unique unique (forecast_date, hour_of_day, zone_id)
);

create index if not exists ix_earnings_forecasts_date on public.earnings_forecasts(forecast_date, zone_id);

alter table public.earnings_forecasts enable row level security;

drop policy if exists earnings_forecasts_read on public.earnings_forecasts;
create policy earnings_forecasts_read on public.earnings_forecasts
  for select
  to authenticated
  using (true);

drop policy if exists earnings_forecasts_service on public.earnings_forecasts;
create policy earnings_forecasts_service on public.earnings_forecasts
  to service_role
  using (true)
  with check (true);

--------------------------------------------------------------------------------
-- PART C: AI EARNINGS COACH
--------------------------------------------------------------------------------

-- Coaching tips (personalized per driver)
create table if not exists public.driver_coaching_tips (
  id uuid default gen_random_uuid() primary key,
  driver_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz null,

  -- Tip content
  tip_type text not null,  -- 'acceptance_rate', 'surge_timing', 'zone_switch', 'break_reminder', etc.
  title text not null,
  message text not null,
  action_url text null,

  -- Tracking
  viewed_at timestamptz null,
  dismissed_at timestamptz null,
  acted_at timestamptz null,

  -- Priority
  priority integer not null default 0,  -- higher = more important

  -- A/B testing
  variant text null
);

create index if not exists ix_driver_coaching_tips_driver on public.driver_coaching_tips(driver_id, created_at desc);
create index if not exists ix_driver_coaching_tips_active on public.driver_coaching_tips(driver_id)
  where viewed_at is null and dismissed_at is null;

alter table public.driver_coaching_tips enable row level security;

drop policy if exists driver_coaching_tips_own on public.driver_coaching_tips;
create policy driver_coaching_tips_own on public.driver_coaching_tips
  for all
  to authenticated
  using (auth.uid() = driver_id)
  with check (auth.uid() = driver_id);

drop policy if exists driver_coaching_tips_service on public.driver_coaching_tips;
create policy driver_coaching_tips_service on public.driver_coaching_tips
  to service_role
  using (true)
  with check (true);

-- Coach conversation history (for AI context)
create table if not exists public.earnings_coach_sessions (
  id uuid default gen_random_uuid() primary key,
  driver_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  status text not null default 'active' check (status in ('active', 'completed')),
  history jsonb not null default '[]'::jsonb,

  -- Context at time of conversation
  earnings_context jsonb null  -- weekly earnings, avg rating, top zones, etc.
);

create index if not exists ix_earnings_coach_sessions_driver on public.earnings_coach_sessions(driver_id, created_at desc);

alter table public.earnings_coach_sessions enable row level security;

drop policy if exists earnings_coach_sessions_own on public.earnings_coach_sessions;
create policy earnings_coach_sessions_own on public.earnings_coach_sessions
  for all
  to authenticated
  using (auth.uid() = driver_id)
  with check (auth.uid() = driver_id);

drop policy if exists earnings_coach_sessions_service on public.earnings_coach_sessions;
create policy earnings_coach_sessions_service on public.earnings_coach_sessions
  to service_role
  using (true)
  with check (true);

--------------------------------------------------------------------------------
-- RPC FUNCTIONS
--------------------------------------------------------------------------------

-- Get active hotspots near a location
create or replace function public.get_nearby_hotspots(
  p_lat double precision,
  p_lng double precision,
  p_radius_km integer default 10
)
returns table(
  zone_id text,
  zone_name text,
  center_lat double precision,
  center_lng double precision,
  distance_km double precision,
  demand_level integer,
  expected_wait_minutes integer,
  surge_multiplier numeric
)
language sql
security definer
set search_path = 'pg_catalog, public'
as $$
  with distanced as (
    select
      h.zone_id,
      h.zone_name,
      h.center_lat,
      h.center_lng,
      (6371 * acos(
        cos(radians(p_lat)) * cos(radians(h.center_lat)) *
        cos(radians(h.center_lng) - radians(p_lng)) +
        sin(radians(p_lat)) * sin(radians(h.center_lat))
      )) as dist_km,
      h.demand_level,
      h.expected_wait_minutes,
      h.surge_multiplier,
      h.valid_until
    from public.demand_hotspots h
  )
  select
    zone_id,
    zone_name,
    center_lat,
    center_lng,
    dist_km as distance_km,
    demand_level,
    expected_wait_minutes,
    surge_multiplier
  from distanced
  where valid_until > now()
    and dist_km <= p_radius_km
  order by demand_level desc, dist_km asc
  limit 10
$$;

grant execute on function public.get_nearby_hotspots(double precision, double precision, integer) to authenticated;

-- Get earnings forecast for today
create or replace function public.get_today_forecast(p_zone_id text default null)
returns table(
  hour_of_day integer,
  expected_earnings_iqd bigint,
  expected_trips integer,
  confidence_pct numeric
)
language sql
security definer
set search_path = 'pg_catalog, public'
as $$
  select
    f.hour_of_day,
    f.expected_earnings_iqd,
    f.expected_trips,
    f.confidence_pct
  from public.earnings_forecasts f
  where f.forecast_date = current_date
    and (p_zone_id is null or f.zone_id = p_zone_id)
  order by f.hour_of_day
$$;

grant execute on function public.get_today_forecast(text) to authenticated;

-- Get driver's active shift
create or replace function public.get_active_shift(p_driver_id uuid default null)
returns table(
  shift_id uuid,
  status public.shift_status,
  scheduled_start timestamptz,
  scheduled_end timestamptz,
  actual_start timestamptz,
  target_earnings_iqd bigint,
  target_trips integer,
  trips_completed integer,
  earnings_iqd bigint
)
language sql
security definer
set search_path = 'pg_catalog, public'
as $$
  select
    s.id as shift_id,
    s.status,
    s.scheduled_start,
    s.scheduled_end,
    s.actual_start,
    s.target_earnings_iqd,
    s.target_trips,
    coalesce(p.trips_completed, 0) as trips_completed,
    coalesce(p.earnings_iqd, 0) as earnings_iqd
  from public.driver_shifts s
  left join public.shift_progress p on p.shift_id = s.id
  where s.driver_id = coalesce(p_driver_id, auth.uid())
    and s.status in ('scheduled', 'active')
  order by s.scheduled_start asc
  limit 1
$$;

grant execute on function public.get_active_shift(uuid) to authenticated;

--------------------------------------------------------------------------------
-- GRANTS
--------------------------------------------------------------------------------

grant select, insert, update on table public.driver_shifts to authenticated;
grant select on table public.demand_hotspots to authenticated;
grant select on table public.earnings_forecasts to authenticated;
grant select, update on table public.driver_coaching_tips to authenticated;
grant select, insert, update on table public.earnings_coach_sessions to authenticated;

grant all on table public.driver_shifts to service_role;
grant all on table public.shift_progress to service_role;
grant all on table public.demand_hotspots to service_role;
grant all on table public.earnings_forecasts to service_role;
grant all on table public.driver_coaching_tips to service_role;
grant all on table public.earnings_coach_sessions to service_role;

-- Driver Stats View for Earnings Coach
create or replace view public.driver_stats as
select
  driver_id,
  count(*) as total_trips,
  coalesce(sum(fare_amount_iqd), 0) as total_earnings_iqd,
  4.9 as avg_rating
from public.rides
where status = 'completed'
group by driver_id;

grant select on public.driver_stats to authenticated;
grant select on public.driver_stats to service_role;
;
