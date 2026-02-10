-- Session 08 — Dispatch + geospatial performance
--
-- Goals:
-- - Ensure driver location storage supports PostGIS query patterns at scale
-- - Ensure dispatch matching uses radius filtering (ST_DWithin) + KNN ordering (<->)
--
-- Notes:
-- - Supabase typically installs PostGIS in the `extensions` schema.
-- - We keep this migration largely idempotent to tolerate environments that
--   already have portions of this schema.

-- Ensure the `extensions` schema exists for PostGIS.
create schema if not exists extensions;

-- Install PostGIS if missing (do nothing if already installed).
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'postgis') then
    execute 'create extension postgis with schema extensions';
  end if;
end $$;

-- Driver location storage (one row per driver, overwritten as they move).
create table if not exists public.driver_locations (
  driver_id uuid default auth.uid() not null,
  lat double precision not null,
  lng double precision not null,
  loc extensions.geography(Point,4326)
    generated always as (
      (extensions.st_setsrid(extensions.st_makepoint(lng, lat), 4326))::extensions.geography
    ) stored,
  heading numeric,
  speed_mps numeric,
  accuracy_m numeric,
  updated_at timestamptz default now() not null,
  vehicle_type text,
  constraint driver_locations_lat_check check (lat >= -90 and lat <= 90),
  constraint driver_locations_lng_check check (lng >= -180 and lng <= 180)
);

-- Primary key (one row per driver).
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'driver_locations_pkey'
      and conrelid = 'public.driver_locations'::regclass
  ) then
    alter table public.driver_locations add constraint driver_locations_pkey primary key (driver_id);
  end if;
end $$;

-- FK to drivers (best-effort; skip if drivers table isn't present yet).
do $$
begin
  if exists (select 1 from pg_class where oid = 'public.drivers'::regclass) then
    if not exists (
      select 1
      from pg_constraint
      where conname = 'driver_locations_driver_id_fkey'
        and conrelid = 'public.driver_locations'::regclass
    ) then
      alter table public.driver_locations
        add constraint driver_locations_driver_id_fkey
        foreign key (driver_id)
        references public.drivers(id)
        on delete cascade;
    end if;
  end if;
exception
  when undefined_table then
    -- ignore
    null;
end $$;

-- Indexes for geospatial + freshness lookups.
create index if not exists ix_driver_locations_loc_gist on public.driver_locations using gist (loc);
create index if not exists ix_driver_locations_updated_at on public.driver_locations (updated_at desc);

-- Optional but helpful: avoid sequential scans when filtering to available drivers.
-- Guarded in case the `drivers` table/type isn't present in a fresh bootstrap.
do $$
begin
  if to_regclass('public.drivers') is not null then
    execute 'create index if not exists ix_drivers_status_available on public.drivers (id) where status = ''available''::public.driver_status';
  end if;
end $$;

-- Dispatch: radius filter + KNN ordering.
-- We keep the same signature and behavior, only improving candidate ordering.
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

    exit when candidate is null;

    begin
      perform public.transition_driver(candidate, 'reserved'::public.driver_status, null, 'matching');
    exception when others then
      tried := array_append(tried, candidate);
      continue;
    end;

    begin
      update public.ride_requests as req
        set status = 'matched',
            assigned_driver_id = candidate,
            match_attempts = rr.match_attempts + 1,
            match_deadline = now() + make_interval(secs => p_match_ttl_seconds)
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

-- Keep RPC access scoped to service_role.
revoke all on function public.dispatch_match_ride(uuid, uuid, numeric, integer, integer, integer) from public;
grant all on function public.dispatch_match_ride(uuid, uuid, numeric, integer, integer, integer) to service_role;
;
