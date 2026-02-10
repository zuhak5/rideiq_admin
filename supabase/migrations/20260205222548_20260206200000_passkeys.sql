-- Session 15 — Identity: Passkeys for passwordless login
--
-- Additive, deterministic migration.
--
-- WebAuthn credential storage following FIDO2/W3C WebAuthn Level 2 spec.
-- Supports account recovery via multiple passkeys and backup codes.

set lock_timeout = '5s';
set statement_timeout = '60s';

--------------------------------------------------------------------------------
-- PASSKEY CREDENTIALS
--------------------------------------------------------------------------------

-- Passkey credential type
do $$
begin
  if not exists (select 1 from pg_type where typname = 'passkey_type') then
    create type public.passkey_type as enum ('platform', 'cross_platform');
  end if;

  if not exists (select 1 from pg_type where typname = 'passkey_status') then
    create type public.passkey_status as enum ('active', 'revoked');
  end if;
end
$$;

-- User passkeys (WebAuthn credentials)
create table if not exists public.user_passkeys (
  id uuid default gen_random_uuid() primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- WebAuthn credential data
  credential_id bytea not null unique,  -- binary credential.id from authenticator
  public_key bytea not null,  -- COSE public key
  sign_count bigint not null default 0,  -- signature counter for clone detection
  aaguid bytea null,  -- authenticator attestation GUID

  -- Metadata
  passkey_type public.passkey_type not null,
  status public.passkey_status not null default 'active',
  friendly_name text null,  -- user-set name like "iPhone" or "YubiKey"
  last_used_at timestamptz null,
  use_count integer not null default 0,

  -- Device info (for display)
  user_agent text null,
  device_type text null,  -- 'mobile', 'desktop', 'tablet'

  -- Backup eligibility
  backup_eligible boolean not null default false,
  backup_state boolean not null default false,

  -- Revocation
  revoked_at timestamptz null,
  revoked_reason text null
);

create index if not exists ix_user_passkeys_user on public.user_passkeys(user_id) where status = 'active';
create unique index if not exists ix_user_passkeys_credential on public.user_passkeys(credential_id);

-- RLS: users manage their own passkeys
alter table public.user_passkeys enable row level security;

drop policy if exists user_passkeys_own on public.user_passkeys;
create policy user_passkeys_own on public.user_passkeys
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists user_passkeys_service on public.user_passkeys;
create policy user_passkeys_service on public.user_passkeys
  to service_role
  using (true)
  with check (true);

--------------------------------------------------------------------------------
-- WEBAUTHN CHALLENGES (Ephemeral)
--------------------------------------------------------------------------------

-- WebAuthn challenge storage (short-lived)
create table if not exists public.webauthn_challenges (
  id uuid default gen_random_uuid() primary key,
  user_id uuid null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '5 minutes'),

  -- Challenge data
  challenge bytea not null unique,
  challenge_type text not null check (challenge_type in ('registration', 'authentication')),
  
  -- Session binding
  session_id text null,
  user_agent text null,

  -- State
  used_at timestamptz null
);

create index if not exists ix_webauthn_challenges_active on public.webauthn_challenges(expires_at)
  where used_at is null;

-- Auto-delete expired challenges
create index if not exists ix_webauthn_challenges_cleanup on public.webauthn_challenges(expires_at);

-- RLS: service_role only (challenges are created/consumed by backend)
alter table public.webauthn_challenges enable row level security;

drop policy if exists webauthn_challenges_service on public.webauthn_challenges;
create policy webauthn_challenges_service on public.webauthn_challenges
  to service_role
  using (true)
  with check (true);

--------------------------------------------------------------------------------
-- BACKUP CODES (Account Recovery)
--------------------------------------------------------------------------------

-- Backup recovery codes
create table if not exists public.recovery_codes (
  id uuid default gen_random_uuid() primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),

  -- Code (hashed)
  code_hash text not null,  -- bcrypt or SHA-256 hash of the code
  used_at timestamptz null,

  -- Batch tracking
  batch_id uuid not null,  -- all codes from one generation share a batch_id

  constraint recovery_codes_unique unique (user_id, code_hash)
);

create index if not exists ix_recovery_codes_user on public.recovery_codes(user_id, batch_id);

alter table public.recovery_codes enable row level security;

drop policy if exists recovery_codes_service on public.recovery_codes;
create policy recovery_codes_service on public.recovery_codes
  to service_role
  using (true)
  with check (true);

--------------------------------------------------------------------------------
-- PASSKEY AUTHENTICATION LOG (Audit)
--------------------------------------------------------------------------------

create table if not exists public.passkey_auth_log (
  id uuid default gen_random_uuid() primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  passkey_id uuid null references public.user_passkeys(id) on delete set null,
  created_at timestamptz not null default now(),

  event_type text not null,  -- 'registration', 'authentication', 'revocation', 'recovery'
  success boolean not null,
  failure_reason text null,

  ip_address inet null,
  user_agent text null,
  device_info jsonb null
);

create index if not exists ix_passkey_auth_log_user on public.passkey_auth_log(user_id, created_at desc);

alter table public.passkey_auth_log enable row level security;

drop policy if exists passkey_auth_log_own on public.passkey_auth_log;
create policy passkey_auth_log_own on public.passkey_auth_log
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists passkey_auth_log_service on public.passkey_auth_log;
create policy passkey_auth_log_service on public.passkey_auth_log
  to service_role
  using (true)
  with check (true);

--------------------------------------------------------------------------------
-- RPC FUNCTIONS
--------------------------------------------------------------------------------

-- Create a WebAuthn challenge for registration/authentication
create or replace function public.webauthn_create_challenge(
  p_challenge_type text,
  p_user_id uuid default null,
  p_session_id text default null,
  p_user_agent text default null
)
returns table(
  challenge_id uuid,
  challenge bytea,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = 'pg_catalog, public'
as $$
declare
  v_challenge bytea;
  v_id uuid;
  v_expires timestamptz;
begin
  -- Generate 32-byte random challenge
  v_challenge := gen_random_bytes(32);
  v_expires := now() + interval '5 minutes';

  insert into public.webauthn_challenges (
    user_id, challenge, challenge_type, session_id, user_agent, expires_at
  ) values (
    p_user_id, v_challenge, p_challenge_type, p_session_id, p_user_agent, v_expires
  )
  returning id into v_id;

  return query select v_id, v_challenge, v_expires;
end;
$$;

revoke all on function public.webauthn_create_challenge(text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.webauthn_create_challenge(text, uuid, text, text) to service_role;

-- Consume a WebAuthn challenge (mark as used)
create or replace function public.webauthn_consume_challenge(p_challenge_id uuid)
returns boolean
language plpgsql
security definer
set search_path = 'pg_catalog, public'
as $$
declare
  v_found boolean;
begin
  update public.webauthn_challenges
  set used_at = now()
  where id = p_challenge_id
    and used_at is null
    and expires_at > now()
  returning true into v_found;

  return coalesce(v_found, false);
end;
$$;

revoke all on function public.webauthn_consume_challenge(uuid) from public, anon, authenticated;
grant execute on function public.webauthn_consume_challenge(uuid) to service_role;

-- Register a new passkey
create or replace function public.passkey_register(
  p_user_id uuid,
  p_credential_id bytea,
  p_public_key bytea,
  p_passkey_type public.passkey_type,
  p_friendly_name text default null,
  p_aaguid bytea default null,
  p_backup_eligible boolean default false,
  p_user_agent text default null,
  p_device_type text default null
)
returns public.user_passkeys
language plpgsql
security definer
set search_path = 'pg_catalog, public'
as $$
declare
  v_passkey public.user_passkeys;
begin
  insert into public.user_passkeys (
    user_id, credential_id, public_key, passkey_type, friendly_name,
    aaguid, backup_eligible, user_agent, device_type
  ) values (
    p_user_id, p_credential_id, p_public_key, p_passkey_type, p_friendly_name,
    p_aaguid, p_backup_eligible, p_user_agent, p_device_type
  )
  returning * into v_passkey;

  -- Log registration
  insert into public.passkey_auth_log (user_id, passkey_id, event_type, success, user_agent)
  values (p_user_id, v_passkey.id, 'registration', true, p_user_agent);

  return v_passkey;
end;
$$;

revoke all on function public.passkey_register(uuid, bytea, bytea, public.passkey_type, text, bytea, boolean, text, text) from public, anon, authenticated;
grant execute on function public.passkey_register(uuid, bytea, bytea, public.passkey_type, text, bytea, boolean, text, text) to service_role;

-- Update passkey sign count after authentication (for clone detection)
create or replace function public.passkey_update_sign_count(
  p_credential_id bytea,
  p_new_sign_count bigint
)
returns boolean
language plpgsql
security definer
set search_path = 'pg_catalog, public'
as $$
declare
  v_current_count bigint;
begin
  select sign_count into v_current_count
  from public.user_passkeys
  where credential_id = p_credential_id
    and status = 'active';

  if not found then
    return false;
  end if;

  -- Clone detection: new count should be greater than current
  if p_new_sign_count <= v_current_count and v_current_count > 0 then
    -- Possible clone detected - don't update, return false
    return false;
  end if;

  update public.user_passkeys
  set sign_count = p_new_sign_count,
      last_used_at = now(),
      use_count = use_count + 1,
      updated_at = now()
  where credential_id = p_credential_id;

  return true;
end;
$$;

revoke all on function public.passkey_update_sign_count(bytea, bigint) from public, anon, authenticated;
grant execute on function public.passkey_update_sign_count(bytea, bigint) to service_role;

-- Get user's passkeys (for listing)
create or replace function public.get_user_passkeys(p_user_id uuid default null)
returns table(
  id uuid,
  created_at timestamptz,
  passkey_type public.passkey_type,
  friendly_name text,
  last_used_at timestamptz,
  use_count integer,
  device_type text
)
language sql
security definer
set search_path = 'pg_catalog, public'
as $$
  select
    p.id,
    p.created_at,
    p.passkey_type,
    p.friendly_name,
    p.last_used_at,
    p.use_count,
    p.device_type
  from public.user_passkeys p
  where p.user_id = coalesce(p_user_id, auth.uid())
    and p.status = 'active'
  order by p.last_used_at desc nulls last
$$;

grant execute on function public.get_user_passkeys(uuid) to authenticated;

-- Revoke a passkey
create or replace function public.passkey_revoke(
  p_passkey_id uuid,
  p_reason text default null
)
returns boolean
language plpgsql
security definer
set search_path = 'pg_catalog, public'
as $$
declare
  v_user_id uuid;
begin
  update public.user_passkeys
  set status = 'revoked',
      revoked_at = now(),
      revoked_reason = p_reason,
      updated_at = now()
  where id = p_passkey_id
    and user_id = auth.uid()
    and status = 'active'
  returning user_id into v_user_id;

  if not found then
    return false;
  end if;

  -- Log revocation
  insert into public.passkey_auth_log (user_id, passkey_id, event_type, success)
  values (v_user_id, p_passkey_id, 'revocation', true);

  return true;
end;
$$;

grant execute on function public.passkey_revoke(uuid, text) to authenticated;

--------------------------------------------------------------------------------
-- GRANTS
--------------------------------------------------------------------------------

grant select on table public.user_passkeys to authenticated;
grant select on table public.passkey_auth_log to authenticated;

grant all on table public.user_passkeys to service_role;
grant all on table public.webauthn_challenges to service_role;
grant all on table public.recovery_codes to service_role;
grant all on table public.passkey_auth_log to service_role;
;
