set lock_timeout = '5s';
set statement_timeout = '60s';

do $$
begin
  alter type public.sms_hook_status add value if not exists 'processing';
exception
  when duplicate_object then null;
end;
$$;

alter table public.auth_sms_hook_events
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists attempt_count integer not null default 0,
  add column if not exists provider_attempts jsonb not null default '[]'::jsonb,
  add column if not exists final_http_status integer,
  add column if not exists final_error_code text;

create table if not exists public.auth_sms_provider_health (
  provider_code text primary key,
  consecutive_failures integer not null default 0,
  disabled_until timestamptz,
  last_http_status integer,
  last_error_code text,
  last_failure_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint auth_sms_provider_health_provider_chk
    check (provider_code = any (array['otpiq'::text, 'bulksmsiraq'::text]))
);

create index if not exists idx_auth_sms_provider_health_disabled_until
  on public.auth_sms_provider_health (disabled_until);

alter table public.auth_sms_provider_health enable row level security;

drop policy if exists auth_sms_provider_health_service_role_all_v1
  on public.auth_sms_provider_health;

create policy auth_sms_provider_health_service_role_all_v1
  on public.auth_sms_provider_health
  to service_role
  using (true)
  with check (true);

grant all on table public.auth_sms_provider_health to service_role;

create or replace function public.auth_sms_provider_health_status_v1(
  p_provider_code text
) returns table(
  available boolean,
  disabled_until timestamptz,
  consecutive_failures integer,
  last_http_status integer,
  last_error_code text
)
language plpgsql
stable
security definer
set search_path to 'pg_catalog, public'
as $$
declare
  v_provider text := lower(btrim(p_provider_code));
begin
  if v_provider not in ('otpiq', 'bulksmsiraq') then
    raise exception 'invalid_provider_code';
  end if;

  return query
  select
    coalesce(h.disabled_until is null or h.disabled_until <= now(), true) as available,
    h.disabled_until,
    coalesce(h.consecutive_failures, 0) as consecutive_failures,
    h.last_http_status,
    h.last_error_code
  from (
    select *
    from public.auth_sms_provider_health
    where provider_code = v_provider
  ) h
  right join (select 1 as keep) keep on true
  limit 1;
end;
$$;

create or replace function public.auth_sms_provider_health_on_failure_v1(
  p_provider_code text,
  p_http_status integer default null,
  p_error_code text default null,
  p_base_cooldown_seconds integer default 30
) returns void
language plpgsql
security definer
set search_path to 'pg_catalog, public'
as $$
declare
  v_provider text := lower(btrim(p_provider_code));
  v_now timestamptz := now();
  v_base integer := greatest(5, least(coalesce(p_base_cooldown_seconds, 30), 86400));
  v_new_failures integer;
  v_effective integer;
begin
  if v_provider not in ('otpiq', 'bulksmsiraq') then
    raise exception 'invalid_provider_code';
  end if;

  insert into public.auth_sms_provider_health(provider_code)
  values (v_provider)
  on conflict (provider_code)
  do nothing;

  update public.auth_sms_provider_health
  set
    consecutive_failures = consecutive_failures + 1,
    last_http_status = p_http_status,
    last_error_code = left(coalesce(p_error_code, ''), 120),
    last_failure_at = v_now,
    updated_at = v_now
  where provider_code = v_provider
  returning consecutive_failures into v_new_failures;

  v_effective := least(
    86400,
    v_base * power(2, greatest(0, v_new_failures - 1))::int
  );

  update public.auth_sms_provider_health
  set
    disabled_until = greatest(
      coalesce(disabled_until, v_now),
      v_now + make_interval(secs => v_effective)
    ),
    updated_at = v_now
  where provider_code = v_provider;
end;
$$;

create or replace function public.auth_sms_provider_health_on_success_v1(
  p_provider_code text
) returns void
language plpgsql
security definer
set search_path to 'pg_catalog, public'
as $$
declare
  v_provider text := lower(btrim(p_provider_code));
begin
  if v_provider not in ('otpiq', 'bulksmsiraq') then
    raise exception 'invalid_provider_code';
  end if;

  insert into public.auth_sms_provider_health(provider_code)
  values (v_provider)
  on conflict (provider_code)
  do update set
    consecutive_failures = 0,
    disabled_until = null,
    last_http_status = null,
    last_error_code = null,
    last_failure_at = null,
    updated_at = now();
end;
$$;

create or replace function public.auth_sms_provider_health_reset_v1(
  p_provider_code text
) returns void
language plpgsql
security definer
set search_path to 'pg_catalog, public'
as $$
declare
  v_provider text := lower(btrim(p_provider_code));
begin
  if v_provider not in ('otpiq', 'bulksmsiraq') then
    raise exception 'invalid_provider_code';
  end if;

  insert into public.auth_sms_provider_health(provider_code)
  values (v_provider)
  on conflict (provider_code)
  do update set
    consecutive_failures = 0,
    disabled_until = null,
    last_http_status = null,
    last_error_code = null,
    last_failure_at = null,
    updated_at = now();
end;
$$;

create or replace function public.auth_sms_hook_claim_v1(
  p_webhook_id text,
  p_user_id uuid default null,
  p_phone_e164 text default null,
  p_processing_ttl_seconds integer default 60
) returns text
language plpgsql
security definer
set search_path to 'pg_catalog, public'
as $$
declare
  v_now timestamptz := now();
  v_ttl integer := greatest(5, least(coalesce(p_processing_ttl_seconds, 60), 3600));
  v_status public.sms_hook_status;
  v_updated_at timestamptz;
begin
  if coalesce(btrim(p_webhook_id), '') = '' then
    raise exception 'webhook_id_required';
  end if;

  insert into public.auth_sms_hook_events(
    webhook_id,
    user_id,
    phone_e164,
    status,
    updated_at
  )
  values (
    p_webhook_id,
    p_user_id,
    p_phone_e164,
    'processing',
    v_now
  )
  on conflict (webhook_id)
  do nothing;

  if found then
    return 'claimed';
  end if;

  select
    status,
    coalesce(updated_at, created_at)
  into
    v_status,
    v_updated_at
  from public.auth_sms_hook_events
  where webhook_id = p_webhook_id
  for update;

  if v_status = 'sent' then
    return 'skip_sent';
  end if;

  if v_status = 'processing'
     and v_updated_at > v_now - make_interval(secs => v_ttl) then
    return 'skip_processing';
  end if;

  update public.auth_sms_hook_events
  set
    user_id = coalesce(p_user_id, user_id),
    phone_e164 = coalesce(p_phone_e164, phone_e164),
    provider_used = null,
    status = 'processing',
    error = null,
    final_http_status = null,
    final_error_code = null,
    attempt_count = 0,
    provider_attempts = '[]'::jsonb,
    updated_at = v_now
  where webhook_id = p_webhook_id;

  if v_status = 'failed' then
    return 'reclaimed_failed';
  end if;

  return 'reclaimed_stale';
end;
$$;

create or replace function public.auth_sms_hook_complete_v1(
  p_webhook_id text,
  p_status public.sms_hook_status,
  p_provider_used text default null,
  p_error text default null,
  p_final_http_status integer default null,
  p_final_error_code text default null,
  p_provider_attempts jsonb default '[]'::jsonb,
  p_attempt_count integer default null
) returns void
language plpgsql
security definer
set search_path to 'pg_catalog, public'
as $$
declare
  v_attempts jsonb := case
    when jsonb_typeof(coalesce(p_provider_attempts, '[]'::jsonb)) = 'array'
      then coalesce(p_provider_attempts, '[]'::jsonb)
    else '[]'::jsonb
  end;
begin
  if p_status not in ('sent', 'failed') then
    raise exception 'invalid_completion_status';
  end if;

  update public.auth_sms_hook_events
  set
    provider_used = p_provider_used,
    status = p_status,
    error = nullif(left(coalesce(p_error, ''), 500), ''),
    final_http_status = p_final_http_status,
    final_error_code = nullif(left(coalesce(p_final_error_code, ''), 120), ''),
    provider_attempts = v_attempts,
    attempt_count = coalesce(p_attempt_count, jsonb_array_length(v_attempts)),
    updated_at = now()
  where webhook_id = p_webhook_id;
end;
$$;

revoke all on function public.auth_sms_provider_health_status_v1(text) from public;
revoke all on function public.auth_sms_provider_health_status_v1(text) from anon;
revoke all on function public.auth_sms_provider_health_status_v1(text) from authenticated;
grant execute on function public.auth_sms_provider_health_status_v1(text) to service_role;

revoke all on function public.auth_sms_provider_health_on_failure_v1(text, integer, text, integer) from public;
revoke all on function public.auth_sms_provider_health_on_failure_v1(text, integer, text, integer) from anon;
revoke all on function public.auth_sms_provider_health_on_failure_v1(text, integer, text, integer) from authenticated;
grant execute on function public.auth_sms_provider_health_on_failure_v1(text, integer, text, integer) to service_role;

revoke all on function public.auth_sms_provider_health_on_success_v1(text) from public;
revoke all on function public.auth_sms_provider_health_on_success_v1(text) from anon;
revoke all on function public.auth_sms_provider_health_on_success_v1(text) from authenticated;
grant execute on function public.auth_sms_provider_health_on_success_v1(text) to service_role;

revoke all on function public.auth_sms_provider_health_reset_v1(text) from public;
revoke all on function public.auth_sms_provider_health_reset_v1(text) from anon;
revoke all on function public.auth_sms_provider_health_reset_v1(text) from authenticated;
grant execute on function public.auth_sms_provider_health_reset_v1(text) to service_role;

revoke all on function public.auth_sms_hook_claim_v1(text, uuid, text, integer) from public;
revoke all on function public.auth_sms_hook_claim_v1(text, uuid, text, integer) from anon;
revoke all on function public.auth_sms_hook_claim_v1(text, uuid, text, integer) from authenticated;
grant execute on function public.auth_sms_hook_claim_v1(text, uuid, text, integer) to service_role;

revoke all on function public.auth_sms_hook_complete_v1(text, public.sms_hook_status, text, text, integer, text, jsonb, integer) from public;
revoke all on function public.auth_sms_hook_complete_v1(text, public.sms_hook_status, text, text, integer, text, jsonb, integer) from anon;
revoke all on function public.auth_sms_hook_complete_v1(text, public.sms_hook_status, text, text, integer, text, jsonb, integer) from authenticated;
grant execute on function public.auth_sms_hook_complete_v1(text, public.sms_hook_status, text, text, integer, text, jsonb, integer) to service_role;
