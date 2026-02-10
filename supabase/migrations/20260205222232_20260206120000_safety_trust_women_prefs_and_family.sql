-- Session 11 — Safety & Trust: Women Preferences + Teen/Family Accounts
--
-- Additive, deterministic migration.
--
-- Part A: Women Preferences matching (opt-in, best-effort)
-- Part B: Teen/Family accounts with guardian supervision
--
-- Preserves SKIP LOCKED semantics in dispatch_match_ride.

set lock_timeout = '5s';
set statement_timeout = '60s';

--------------------------------------------------------------------------------
-- PART A: Women Preferences Matching
--------------------------------------------------------------------------------

-- Enums for gender identity and visibility (idempotent)
do $$
begin
  if not exists (select 1 from pg_type where typname = 'gender_identity') then
    create type public.gender_identity as enum ('female', 'male', 'nonbinary', 'undisclosed');
  end if;

  if not exists (select 1 from pg_type where typname = 'gender_visibility') then
    create type public.gender_visibility as enum ('hidden', 'shown_to_matches');
  end if;

  if not exists (select 1 from pg_type where typname = 'family_member_role') then
    create type public.family_member_role as enum ('guardian', 'teen', 'adult');
  end if;

  if not exists (select 1 from pg_type where typname = 'family_member_status') then
    create type public.family_member_status as enum ('invited', 'active', 'suspended');
  end if;
end
$$;

-- Safety preferences table (user opt-in for women preferences)
create table if not exists public.safety_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Gender identity (self-reported, no verification)
  gender_identity public.gender_identity not null default 'undisclosed',
  gender_visibility public.gender_visibility not null default 'hidden',

  -- Women preferences (rider side)
  women_preferences_enabled boolean not null default false,

  -- Women preferences (driver side)
  women_preferences_driver_opt_in boolean not null default false,

  -- Server-derived eligibility (e.g., only allow if gender_identity in female/nonbinary)
  women_preferences_eligible boolean not null default false,

  -- Teen flag (ties into Part B)
  is_teen boolean not null default false
);

-- Index for driver matching queries
create index if not exists ix_safety_prefs_driver_opt_in
  on public.safety_preferences(user_id)
  where women_preferences_driver_opt_in = true and women_preferences_eligible = true;

-- Trigger to compute eligibility and update updated_at
create or replace function public.safety_preferences_before_upsert()
returns trigger
language plpgsql
security definer
set search_path = 'pg_catalog, public'
as $$
begin
  -- Compute eligibility: eligible if gender_identity in ('female', 'nonbinary')
  new.women_preferences_eligible := new.gender_identity in ('female', 'nonbinary');

  -- Update timestamp
  new.updated_at := now();

  return new;
end
$$;

drop trigger if exists safety_preferences_before_upsert_trigger on public.safety_preferences;
create trigger safety_preferences_before_upsert_trigger
  before insert or update on public.safety_preferences
  for each row execute function public.safety_preferences_before_upsert();

-- RLS: users can read/write their own preferences
alter table public.safety_preferences enable row level security;

drop policy if exists safety_preferences_own on public.safety_preferences;
create policy safety_preferences_own on public.safety_preferences
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Service role can access all
drop policy if exists safety_preferences_service on public.safety_preferences;
create policy safety_preferences_service on public.safety_preferences
  to service_role
  using (true)
  with check (true);

-- Add women preferences columns to ride_requests (if not exists)
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'ride_requests' and column_name = 'women_preferences_requested'
  ) then
    alter table public.ride_requests add column women_preferences_requested boolean not null default false;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'ride_requests' and column_name = 'women_preferences_fulfilled'
  ) then
    alter table public.ride_requests add column women_preferences_fulfilled boolean not null default false;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'ride_requests' and column_name = 'women_preferences_fallback_used'
  ) then
    alter table public.ride_requests add column women_preferences_fallback_used boolean not null default false;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'ride_requests' and column_name = 'women_preferences_match_attempt_ms'
  ) then
    alter table public.ride_requests add column women_preferences_match_attempt_ms integer null;
  end if;
end
$$;

-- Safety mismatch reports table
create table if not exists public.safety_mismatch_reports (
  id uuid default gen_random_uuid() primary key,
  created_at timestamptz not null default now(),

  reporter_id uuid not null references auth.users(id) on delete cascade,
  reported_user_id uuid not null references auth.users(id) on delete cascade,
  ride_id uuid null,  -- optional reference to ride

  report_type text not null check (report_type in ('mismatch', 'harassment', 'safety_concern', 'other')),
  description text null,
  evidence_urls text[] null,

  -- Review status
  reviewed_at timestamptz null,
  reviewed_by uuid null,
  review_outcome text null,
  review_notes text null
);

create index if not exists ix_safety_mismatch_reports_reporter
  on public.safety_mismatch_reports(reporter_id, created_at desc);

create index if not exists ix_safety_mismatch_reports_reported
  on public.safety_mismatch_reports(reported_user_id, created_at desc);

-- RLS: users can create reports, only service_role can read/update
alter table public.safety_mismatch_reports enable row level security;

drop policy if exists safety_reports_insert_own on public.safety_mismatch_reports;
create policy safety_reports_insert_own on public.safety_mismatch_reports
  for insert
  to authenticated
  with check (auth.uid() = reporter_id);

drop policy if exists safety_reports_select_own on public.safety_mismatch_reports;
create policy safety_reports_select_own on public.safety_mismatch_reports
  for select
  to authenticated
  using (auth.uid() = reporter_id);

drop policy if exists safety_reports_service on public.safety_mismatch_reports;
create policy safety_reports_service on public.safety_mismatch_reports
  to service_role
  using (true)
  with check (true);

--------------------------------------------------------------------------------
-- PART B: Teen/Family Accounts
--------------------------------------------------------------------------------

-- Families table
create table if not exists public.families (
  id uuid default gen_random_uuid() primary key,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by_user_id uuid not null references auth.users(id) on delete cascade,
  name text null  -- optional family name
);

create index if not exists ix_families_created_by on public.families(created_by_user_id);

-- Family members table
create table if not exists public.family_members (
  id uuid default gen_random_uuid() primary key,
  family_id uuid not null references public.families(id) on delete cascade,
  user_id uuid null references auth.users(id) on delete cascade,  -- null until invite accepted
  role public.family_member_role not null,
  status public.family_member_status not null default 'invited',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Invite flow
  invite_token_hash text null,
  invite_expires_at timestamptz null,
  invite_email text null,  -- for pending invites
  joined_at timestamptz null
);

create unique index if not exists ix_family_members_user_family
  on public.family_members(family_id, user_id)
  where user_id is not null;

create index if not exists ix_family_members_family on public.family_members(family_id);
create index if not exists ix_family_members_user on public.family_members(user_id) where user_id is not null;
create index if not exists ix_family_members_invite_token on public.family_members(invite_token_hash) where invite_token_hash is not null;

-- Teen policies table
create table if not exists public.teen_policies (
  id uuid default gen_random_uuid() primary key,
  family_id uuid not null references public.families(id) on delete cascade,
  teen_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Policy controls
  destination_lock_enabled boolean not null default true,
  pickup_pin_enabled boolean not null default true,
  allowed_hours jsonb null,  -- e.g., {"weekdays": {"start": "07:00", "end": "22:00"}}
  geofence_allowlist jsonb null,  -- array of polygon/circle definitions
  spend_cap_daily numeric null,

  constraint teen_policies_family_teen_unique unique (family_id, teen_user_id)
);

create index if not exists ix_teen_policies_teen on public.teen_policies(teen_user_id);

-- Trip guardian links table (live tracking relationship)
create table if not exists public.trip_guardian_links (
  id uuid default gen_random_uuid() primary key,
  trip_id uuid not null,  -- references rides table
  teen_user_id uuid not null references auth.users(id) on delete cascade,
  guardian_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),

  guardian_live_tracking_enabled boolean not null default true,

  constraint trip_guardian_links_unique unique (trip_id, guardian_user_id)
);

create index if not exists ix_trip_guardian_links_trip on public.trip_guardian_links(trip_id);
create index if not exists ix_trip_guardian_links_guardian on public.trip_guardian_links(guardian_user_id);

-- RLS for family tables
alter table public.families enable row level security;
alter table public.family_members enable row level security;
alter table public.teen_policies enable row level security;
alter table public.trip_guardian_links enable row level security;

-- Families: creator can manage, members can read
drop policy if exists families_creator on public.families;
create policy families_creator on public.families
  for all
  to authenticated
  using (auth.uid() = created_by_user_id)
  with check (auth.uid() = created_by_user_id);

drop policy if exists families_member_read on public.families;
create policy families_member_read on public.families
  for select
  to authenticated
  using (
    exists (
      select 1 from public.family_members fm
      where fm.family_id = id
        and fm.user_id = auth.uid()
        and fm.status = 'active'
    )
  );

drop policy if exists families_service on public.families;
create policy families_service on public.families
  to service_role
  using (true)
  with check (true);

-- Family members: guardians can manage, members can read own
drop policy if exists family_members_guardian on public.family_members;
create policy family_members_guardian on public.family_members
  for all
  to authenticated
  using (
    exists (
      select 1 from public.family_members fm
      where fm.family_id = family_members.family_id
        and fm.user_id = auth.uid()
        and fm.role = 'guardian'
        and fm.status = 'active'
    )
  )
  with check (
    exists (
      select 1 from public.family_members fm
      where fm.family_id = family_members.family_id
        and fm.user_id = auth.uid()
        and fm.role = 'guardian'
        and fm.status = 'active'
    )
  );

drop policy if exists family_members_own on public.family_members;
create policy family_members_own on public.family_members
  for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists family_members_service on public.family_members;
create policy family_members_service on public.family_members
  to service_role
  using (true)
  with check (true);

-- Teen policies: guardian can manage, teen can read
drop policy if exists teen_policies_guardian on public.teen_policies;
create policy teen_policies_guardian on public.teen_policies
  for all
  to authenticated
  using (
    exists (
      select 1 from public.family_members fm
      where fm.family_id = teen_policies.family_id
        and fm.user_id = auth.uid()
        and fm.role = 'guardian'
        and fm.status = 'active'
    )
  )
  with check (
    exists (
      select 1 from public.family_members fm
      where fm.family_id = teen_policies.family_id
        and fm.user_id = auth.uid()
        and fm.role = 'guardian'
        and fm.status = 'active'
    )
  );

drop policy if exists teen_policies_teen_read on public.teen_policies;
create policy teen_policies_teen_read on public.teen_policies
  for select
  to authenticated
  using (teen_user_id = auth.uid());

drop policy if exists teen_policies_service on public.teen_policies;
create policy teen_policies_service on public.teen_policies
  to service_role
  using (true)
  with check (true);

-- Trip guardian links: guardian can read
drop policy if exists trip_guardian_guardian on public.trip_guardian_links;
create policy trip_guardian_guardian on public.trip_guardian_links
  for select
  to authenticated
  using (guardian_user_id = auth.uid());

drop policy if exists trip_guardian_teen on public.trip_guardian_links;
create policy trip_guardian_teen on public.trip_guardian_links
  for select
  to authenticated
  using (teen_user_id = auth.uid());

drop policy if exists trip_guardian_service on public.trip_guardian_links;
create policy trip_guardian_service on public.trip_guardian_links
  to service_role
  using (true)
  with check (true);

-- updated_at triggers
do $$
begin
  if exists (select 1 from pg_proc where proname = 'set_updated_at' and pg_function_is_visible(oid)) then
    drop trigger if exists families_set_updated_at on public.families;
    create trigger families_set_updated_at
      before update on public.families
      for each row execute function public.set_updated_at();

    drop trigger if exists family_members_set_updated_at on public.family_members;
    create trigger family_members_set_updated_at
      before update on public.family_members
      for each row execute function public.set_updated_at();

    drop trigger if exists teen_policies_set_updated_at on public.teen_policies;
    create trigger teen_policies_set_updated_at
      before update on public.teen_policies
      for each row execute function public.set_updated_at();
  end if;
end
$$;

--------------------------------------------------------------------------------
-- MODIFIED DISPATCH FUNCTION: dispatch_match_ride with Women Preferences
--------------------------------------------------------------------------------

-- Updated dispatch_match_ride to support women preferences
-- Preserves SKIP LOCKED semantics
create or replace function public.dispatch_match_ride(
  p_request_id uuid,
  p_rider_id uuid,
  p_radius_m numeric default 5000,
  p_limit_n integer default 20,
  p_match_ttl_seconds integer default 120,
  p_stale_after_seconds integer default 120
)
returns table(
  id uuid,
  status public.ride_request_status,
  assigned_driver_id uuid,
  match_deadline timestamptz,
  match_attempts integer,
  matched_at timestamptz
)
language plpgsql
security definer
set search_path = 'pg_catalog, public, extensions'
as $$
declare
  rr record;
  candidate uuid;
  up record;
  tried uuid[] := '{}'::uuid[];
  v_balance bigint;
  v_held bigint;
  v_available bigint;
  v_quote bigint;
  v_req_capacity int := 4;
  v_stale_after int;
  v_pay public.ride_payment_method;
  v_women_pref_requested boolean;
  v_women_pref_start_ms bigint;
  v_women_pref_attempts int := 0;
  v_women_pref_max_attempts int := 2;  -- try women-only matching twice before fallback
  v_women_pref_fulfilled boolean := false;
  v_women_pref_fallback boolean := false;
begin
  v_stale_after := greatest(30, coalesce(p_stale_after_seconds, 120));

  perform public.expire_matched_ride_requests_v1(200);

  select * into rr
  from public.ride_requests as req
  where req.id = p_request_id
  for update;

  if not found then
    raise exception 'ride_request_not_found';
  end if;

  if rr.rider_id <> p_rider_id then
    raise exception 'forbidden';
  end if;

  if rr.status = 'accepted' then
    return query select rr.id, rr.status, rr.assigned_driver_id, rr.match_deadline, rr.match_attempts, rr.matched_at;
    return;
  end if;

  if rr.status = 'matched' and rr.match_deadline is not null and rr.match_deadline <= now() then
    perform public.transition_driver(rr.assigned_driver_id, 'available'::public.driver_status, null, 'match_expired');

    update public.ride_requests
      set status = 'requested',
          assigned_driver_id = null,
          match_deadline = null
    where id = rr.id and status = 'matched';

    rr.status := 'requested';
    rr.assigned_driver_id := null;
    rr.match_deadline := null;
  end if;

  if rr.status <> 'requested' then
    return query select rr.id, rr.status, rr.assigned_driver_id, rr.match_deadline, rr.match_attempts, rr.matched_at;
    return;
  end if;

  select capacity_min into v_req_capacity
  from public.ride_products
  where code = rr.product_code;

  v_req_capacity := coalesce(v_req_capacity, 4);

  v_quote := coalesce(rr.quote_amount_iqd, 0)::bigint;
  if v_quote <= 0 then
    raise exception 'invalid_quote';
  end if;

  v_pay := coalesce(rr.payment_method, 'wallet'::public.ride_payment_method);
  if v_pay <> 'cash'::public.ride_payment_method then
    select coalesce(w.balance_iqd, 0), coalesce(w.held_iqd, 0)
      into v_balance, v_held
    from public.wallet_accounts w
    where w.user_id = rr.rider_id;

    v_available := coalesce(v_balance, 0) - coalesce(v_held, 0);

    if v_available < v_quote then
      raise exception 'insufficient_wallet_balance';
    end if;
  end if;

  -- Check if women preferences requested
  v_women_pref_requested := coalesce(rr.women_preferences_requested, false);
  if v_women_pref_requested then
    v_women_pref_start_ms := extract(epoch from clock_timestamp()) * 1000;
  end if;

  -- Main matching loop (up to 3 attempts)
  for i in 1..3 loop
    with pickup as (
      select rr.pickup_loc as pickup
    ), candidates as (
      select d.id as driver_id
      from public.drivers d
      cross join pickup
      join public.driver_locations dl
        on dl.driver_id = d.id
       and dl.updated_at >= now() - make_interval(secs => v_stale_after)
      left join public.settlement_accounts sa
        on sa.party_type = 'driver'::public.settlement_party_type
       and sa.party_id = d.id
       and sa.currency = 'IQD'
      -- Women preferences filter (when requested and not yet in fallback mode)
      left join public.safety_preferences sp
        on sp.user_id = d.id
      where d.status = 'available'
        and not (d.id = any(tried))
        and extensions.st_dwithin(dl.loc, pickup.pickup, p_radius_m)
        and exists (
          select 1 from public.driver_vehicles v
          where v.driver_id = d.id
            and coalesce(v.is_active, true) = true
            and coalesce(v.capacity, 4) >= v_req_capacity
        )
        and not exists (
          select 1 from public.rides r
          where r.driver_id = d.id
            and r.status in ('assigned','arrived','in_progress')
        )
        and not exists (
          select 1 from public.ride_requests rr2
          where rr2.assigned_driver_id = d.id
            and rr2.status = 'matched'
            and (rr2.match_deadline is null or rr2.match_deadline > now())
        )
        and (
          v_pay <> 'cash'::public.ride_payment_method
          or (d.cash_enabled = true and coalesce(sa.balance_iqd, 0) >= (-d.cash_exposure_limit_iqd)::bigint)
        )
        -- Women preferences: filter for eligible drivers if requested and not in fallback
        and (
          not v_women_pref_requested
          or v_women_pref_fallback
          or (
            sp.women_preferences_driver_opt_in = true
            and sp.women_preferences_eligible = true
          )
        )
      order by dl.loc <-> pickup.pickup
      limit p_limit_n
    ), locked as (
      select c.driver_id
      from candidates c
      join public.drivers d on d.id = c.driver_id
      where d.status = 'available'
      for update of d skip locked
      limit 1
    )
    select driver_id into candidate from locked;

    -- If no candidate found and women preferences active, try fallback
    if candidate is null and v_women_pref_requested and not v_women_pref_fallback then
      v_women_pref_attempts := v_women_pref_attempts + 1;
      if v_women_pref_attempts >= v_women_pref_max_attempts then
        v_women_pref_fallback := true;
        continue;  -- retry with fallback
      end if;
    end if;

    exit when candidate is null;

    begin
      perform public.transition_driver(candidate, 'reserved'::public.driver_status, null, 'matching');
    exception when others then
      tried := array_append(tried, candidate);
      continue;
    end;

    -- Track if this was a women preferences match
    if v_women_pref_requested and not v_women_pref_fallback then
      v_women_pref_fulfilled := true;
    end if;

    begin
      update public.ride_requests as req
        set status = 'matched',
            assigned_driver_id = candidate,
            match_attempts = rr.match_attempts + 1,
            match_deadline = now() + make_interval(secs => p_match_ttl_seconds),
            women_preferences_fulfilled = v_women_pref_fulfilled,
            women_preferences_fallback_used = v_women_pref_fallback,
            women_preferences_match_attempt_ms = case
              when v_women_pref_requested then
                (extract(epoch from clock_timestamp()) * 1000 - v_women_pref_start_ms)::integer
              else null
            end
      where req.id = rr.id
        and req.status = 'requested'
        and req.assigned_driver_id is null
      returning req.id, req.status, req.assigned_driver_id, req.match_deadline, req.match_attempts, req.matched_at
        into up;

      if found then
        return query select up.id, up.status, up.assigned_driver_id, up.match_deadline, up.match_attempts, up.matched_at;
        return;
      end if;
    exception
      when unique_violation then
        perform public.transition_driver(candidate, 'available'::public.driver_status, null, 'match_conflict');
      when others then
        perform public.transition_driver(candidate, 'available'::public.driver_status, null, 'match_error');
        raise;
    end;

    tried := array_append(tried, candidate);
    perform public.transition_driver(candidate, 'available'::public.driver_status, null, 'match_failed');
  end loop;

  return query select rr.id, rr.status, rr.assigned_driver_id, rr.match_deadline, rr.match_attempts, rr.matched_at;
end;
$$;

-- Keep RPC access scoped to service_role
revoke all on function public.dispatch_match_ride(uuid, uuid, numeric, integer, integer, integer) from public;
grant all on function public.dispatch_match_ride(uuid, uuid, numeric, integer, integer, integer) to service_role;

--------------------------------------------------------------------------------
-- RPC Functions for Family Management
--------------------------------------------------------------------------------

-- Create a family
create or replace function public.family_create(p_name text default null)
returns public.families
language plpgsql
security definer
set search_path = 'pg_catalog, public'
as $$
declare
  v_family public.families;
begin
  -- Create family
  insert into public.families (created_by_user_id, name)
  values (auth.uid(), p_name)
  returning * into v_family;

  -- Add creator as guardian
  insert into public.family_members (family_id, user_id, role, status, joined_at)
  values (v_family.id, auth.uid(), 'guardian', 'active', now());

  return v_family;
end;
$$;

grant execute on function public.family_create(text) to authenticated;

-- Invite a teen to family
create or replace function public.family_invite_teen(
  p_family_id uuid,
  p_invite_email text,
  p_invite_token text  -- caller generates and passes token; we store hash
)
returns public.family_members
language plpgsql
security definer
set search_path = 'pg_catalog, public, extensions'
as $$
declare
  v_member public.family_members;
  v_token_hash text;
begin
  -- Verify caller is guardian of this family
  if not exists (
    select 1 from public.family_members
    where family_id = p_family_id
      and user_id = auth.uid()
      and role = 'guardian'
      and status = 'active'
  ) then
    raise exception 'forbidden';
  end if;

  -- Hash the invite token
  v_token_hash := encode(extensions.digest(p_invite_token, 'sha256'), 'hex');

  -- Create pending invite
  insert into public.family_members (
    family_id, role, status, invite_token_hash, invite_expires_at, invite_email
  ) values (
    p_family_id, 'teen', 'invited', v_token_hash, now() + interval '7 days', p_invite_email
  )
  returning * into v_member;

  return v_member;
end;
$$;

grant execute on function public.family_invite_teen(uuid, text, text) to authenticated;

-- Accept family invite
create or replace function public.family_accept_invite(p_invite_token text)
returns public.family_members
language plpgsql
security definer
set search_path = 'pg_catalog, public, extensions'
as $$
declare
  v_token_hash text;
  v_member public.family_members;
begin
  v_token_hash := encode(extensions.digest(p_invite_token, 'sha256'), 'hex');

  -- Find and claim the invite
  update public.family_members
  set user_id = auth.uid(),
      status = 'active',
      invite_token_hash = null,
      invite_expires_at = null,
      joined_at = now(),
      updated_at = now()
  where invite_token_hash = v_token_hash
    and status = 'invited'
    and (invite_expires_at is null or invite_expires_at > now())
    and user_id is null
  returning * into v_member;

  if not found then
    raise exception 'invite_not_found_or_expired';
  end if;

  -- Mark user as teen in safety_preferences
  insert into public.safety_preferences (user_id, is_teen)
  values (auth.uid(), true)
  on conflict (user_id) do update set is_teen = true, updated_at = now();

  -- Create default teen policy
  insert into public.teen_policies (family_id, teen_user_id)
  values (v_member.family_id, auth.uid())
  on conflict (family_id, teen_user_id) do nothing;

  return v_member;
end;
$$;

grant execute on function public.family_accept_invite(text) to authenticated;

-- Update teen policy
create or replace function public.family_update_policy(
  p_family_id uuid,
  p_teen_user_id uuid,
  p_destination_lock_enabled boolean default null,
  p_pickup_pin_enabled boolean default null,
  p_allowed_hours jsonb default null,
  p_geofence_allowlist jsonb default null,
  p_spend_cap_daily numeric default null
)
returns public.teen_policies
language plpgsql
security definer
set search_path = 'pg_catalog, public'
as $$
declare
  v_policy public.teen_policies;
begin
  -- Verify caller is guardian of this family
  if not exists (
    select 1 from public.family_members
    where family_id = p_family_id
      and user_id = auth.uid()
      and role = 'guardian'
      and status = 'active'
  ) then
    raise exception 'forbidden';
  end if;

  update public.teen_policies
  set destination_lock_enabled = coalesce(p_destination_lock_enabled, destination_lock_enabled),
      pickup_pin_enabled = coalesce(p_pickup_pin_enabled, pickup_pin_enabled),
      allowed_hours = coalesce(p_allowed_hours, allowed_hours),
      geofence_allowlist = coalesce(p_geofence_allowlist, geofence_allowlist),
      spend_cap_daily = coalesce(p_spend_cap_daily, spend_cap_daily),
      updated_at = now()
  where family_id = p_family_id
    and teen_user_id = p_teen_user_id
  returning * into v_policy;

  if not found then
    raise exception 'policy_not_found';
  end if;

  return v_policy;
end;
$$;

grant execute on function public.family_update_policy(uuid, uuid, boolean, boolean, jsonb, jsonb, numeric) to authenticated;

-- Create guardian link for a trip
create or replace function public.trip_guardian_link_create(
  p_trip_id uuid,
  p_teen_user_id uuid
)
returns setof public.trip_guardian_links
language plpgsql
security definer
set search_path = 'pg_catalog, public'
as $$
declare
  v_guardian record;
begin
  -- Find all active guardians for this teen
  for v_guardian in
    select fm.user_id as guardian_id
    from public.family_members fm
    join public.family_members teen_fm on teen_fm.family_id = fm.family_id
    where teen_fm.user_id = p_teen_user_id
      and teen_fm.role = 'teen'
      and teen_fm.status = 'active'
      and fm.role = 'guardian'
      and fm.status = 'active'
  loop
    insert into public.trip_guardian_links (trip_id, teen_user_id, guardian_user_id)
    values (p_trip_id, p_teen_user_id, v_guardian.guardian_id)
    on conflict (trip_id, guardian_user_id) do nothing;
  end loop;

  return query select * from public.trip_guardian_links where trip_id = p_trip_id;
end;
$$;

revoke all on function public.trip_guardian_link_create(uuid, uuid) from public;
grant execute on function public.trip_guardian_link_create(uuid, uuid) to service_role;

-- Check if destination lock is enabled for a rider
create or replace function public.check_destination_lock(p_rider_id uuid)
returns boolean
language sql
security definer
set search_path = 'pg_catalog, public'
as $$
  select coalesce(
    (
      select tp.destination_lock_enabled
      from public.teen_policies tp
      where tp.teen_user_id = p_rider_id
      limit 1
    ),
    false
  )
$$;

revoke all on function public.check_destination_lock(uuid) from public;
grant execute on function public.check_destination_lock(uuid) to service_role;
grant execute on function public.check_destination_lock(uuid) to authenticated;

-- Get guardian tracking info for a trip
create or replace function public.get_guardian_trip_info(p_trip_id uuid, p_guardian_id uuid)
returns table(
  trip_id uuid,
  status text,
  eta_minutes integer,
  driver_first_name text,
  vehicle_make text,
  vehicle_model text,
  vehicle_color text,
  current_lat double precision,
  current_lng double precision
)
language plpgsql
security definer
set search_path = 'pg_catalog, public'
as $$
begin
  -- Verify guardian has access to this trip
  if not exists (
    select 1 from public.trip_guardian_links tgl
    where tgl.trip_id = p_trip_id
      and tgl.guardian_user_id = p_guardian_id
      and tgl.guardian_live_tracking_enabled = true
  ) then
    raise exception 'forbidden';
  end if;

  return query
  select
    r.id as trip_id,
    r.status::text,
    null::integer as eta_minutes,  -- would be computed from route
    coalesce(split_part(u.raw_user_meta_data->>'full_name', ' ', 1), 'Driver') as driver_first_name,
    v.make as vehicle_make,
    v.model as vehicle_model,
    v.color as vehicle_color,
    dl.lat as current_lat,
    dl.lng as current_lng
  from public.rides r
  join public.drivers d on d.id = r.driver_id
  join auth.users u on u.id = d.id
  left join public.driver_vehicles v on v.driver_id = d.id and coalesce(v.is_active, true) = true
  left join public.driver_locations dl on dl.driver_id = d.id
  where r.id = p_trip_id;
end;
$$;

grant execute on function public.get_guardian_trip_info(uuid, uuid) to authenticated;

--------------------------------------------------------------------------------
-- Grants for new tables
--------------------------------------------------------------------------------

grant select, insert, update on table public.safety_preferences to authenticated;
grant select, insert on table public.safety_mismatch_reports to authenticated;
grant select, insert, update on table public.families to authenticated;
grant select, insert, update on table public.family_members to authenticated;
grant select, update on table public.teen_policies to authenticated;
grant select on table public.trip_guardian_links to authenticated;

grant all on table public.safety_preferences to service_role;
grant all on table public.safety_mismatch_reports to service_role;
grant all on table public.families to service_role;
grant all on table public.family_members to service_role;
grant all on table public.teen_policies to service_role;
grant all on table public.trip_guardian_links to service_role;
;
