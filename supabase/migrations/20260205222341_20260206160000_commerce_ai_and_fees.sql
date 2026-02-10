-- Session 13 — Commerce & delivery UX: AI food concierge + add-on store + fee transparency
--
-- Additive, deterministic migration.
--
-- Part A: AI food concierge conversation storage
-- Part B: Add-on store (order bundles)
-- Part C: Fee transparency + membership

set lock_timeout = '5s';
set statement_timeout = '60s';

--------------------------------------------------------------------------------
-- PART A: AI FOOD CONCIERGE
--------------------------------------------------------------------------------

-- Concierge conversation state
create table if not exists public.concierge_sessions (
  id uuid default gen_random_uuid() primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 minutes'),

  -- Session state
  mode text not null default 'chat' check (mode in ('chat', 'voice')),
  status text not null default 'active' check (status in ('active', 'completed', 'expired', 'cancelled')),

  -- Preferences captured
  preferences jsonb not null default '{}'::jsonb,
  -- e.g., {"dietary": ["vegetarian"], "allergies": ["peanuts"], "budget_max": 20, "cuisine": "italian"}

  -- Conversation history (last N turns for context)
  history jsonb not null default '[]'::jsonb,

  -- Outcome
  selected_items jsonb null,  -- final items added to cart
  merchant_id uuid null  -- if a merchant was selected
);

create index if not exists ix_concierge_sessions_user on public.concierge_sessions(user_id, created_at desc);
create index if not exists ix_concierge_sessions_active on public.concierge_sessions(user_id, status) where status = 'active';

-- RLS: users own their sessions
alter table public.concierge_sessions enable row level security;

drop policy if exists concierge_sessions_own on public.concierge_sessions;
create policy concierge_sessions_own on public.concierge_sessions
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists concierge_sessions_service on public.concierge_sessions;
create policy concierge_sessions_service on public.concierge_sessions
  to service_role
  using (true)
  with check (true);

-- Concierge feedback for quality tracking
create table if not exists public.concierge_feedback (
  id uuid default gen_random_uuid() primary key,
  session_id uuid not null references public.concierge_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),

  rating integer null check (rating >= 1 and rating <= 5),
  feedback_type text null check (feedback_type in ('bad_suggestion', 'helpful', 'too_slow', 'other')),
  comment text null
);

create index if not exists ix_concierge_feedback_session on public.concierge_feedback(session_id);

alter table public.concierge_feedback enable row level security;

drop policy if exists concierge_feedback_own on public.concierge_feedback;
create policy concierge_feedback_own on public.concierge_feedback
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists concierge_feedback_service on public.concierge_feedback;
create policy concierge_feedback_service on public.concierge_feedback
  to service_role
  using (true)
  with check (true);

--------------------------------------------------------------------------------
-- PART B: ADD-ON STORE (ORDER BUNDLES)
--------------------------------------------------------------------------------

-- Order bundle status
do $$
begin
  if not exists (select 1 from pg_type where typname = 'order_bundle_status') then
    create type public.order_bundle_status as enum ('pending', 'confirmed', 'in_progress', 'completed', 'cancelled');
  end if;
end
$$;

-- Order bundles (DoubleDash-style)
create table if not exists public.order_bundles (
  id uuid default gen_random_uuid() primary key,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  user_id uuid not null references auth.users(id) on delete cascade,
  primary_order_id uuid not null,  -- the original order
  status public.order_bundle_status not null default 'pending',

  -- Timing
  addon_window_expires_at timestamptz not null,  -- e.g., 5-10 min after primary order
  same_courier boolean not null default true,

  -- Pricing
  additional_fee_iqd bigint not null default 0,
  fee_waived boolean not null default false
);

create index if not exists ix_order_bundles_user on public.order_bundles(user_id, created_at desc);
create index if not exists ix_order_bundles_primary on public.order_bundles(primary_order_id);

-- Add bundle_id to orders table (if orders table exists)
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'orders') then
    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'orders' and column_name = 'bundle_id'
    ) then
      alter table public.orders add column bundle_id uuid null references public.order_bundles(id) on delete set null;
    end if;
  end if;
end
$$;

-- Addon offers (surfaced after primary order)
create table if not exists public.addon_offers (
  id uuid default gen_random_uuid() primary key,
  order_id uuid not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,

  eligible_merchants jsonb not null default '[]'::jsonb,
  -- e.g., [{"merchant_id": "...", "name": "...", "distance_m": 500}]

  viewed_at timestamptz null,
  converted_at timestamptz null,
  dismissed_at timestamptz null
);

create index if not exists ix_addon_offers_order on public.addon_offers(order_id);
create index if not exists ix_addon_offers_pending on public.addon_offers(expires_at) where converted_at is null and dismissed_at is null;

alter table public.order_bundles enable row level security;
alter table public.addon_offers enable row level security;

drop policy if exists order_bundles_own on public.order_bundles;
create policy order_bundles_own on public.order_bundles
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists order_bundles_service on public.order_bundles;
create policy order_bundles_service on public.order_bundles
  to service_role
  using (true)
  with check (true);

drop policy if exists addon_offers_service on public.addon_offers;
create policy addon_offers_service on public.addon_offers
  to service_role
  using (true)
  with check (true);

--------------------------------------------------------------------------------
-- PART C: FEE TRANSPARENCY + MEMBERSHIP
--------------------------------------------------------------------------------

-- Membership plan status
do $$
begin
  if not exists (select 1 from pg_type where typname = 'membership_status') then
    create type public.membership_status as enum ('active', 'cancelled', 'expired', 'paused');
  end if;
end
$$;

-- Membership plans
create table if not exists public.membership_plans (
  id uuid default gen_random_uuid() primary key,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  code text not null unique,  -- e.g., 'rideiq_plus', 'family_plan'
  name text not null,
  description text null,

  price_iqd bigint not null,
  billing_interval text not null check (billing_interval in ('monthly', 'annual')),

  -- Benefits
  free_delivery_min_order_iqd bigint null,  -- min order for $0 delivery
  service_fee_discount_pct numeric null,  -- e.g., 0.5 = 50% off
  member_exclusive_promos boolean not null default true,
  family_sharing_slots integer null,  -- max additional family members

  -- Status
  is_active boolean not null default true,
  available_regions text[] null  -- null = all regions
);

create index if not exists ix_membership_plans_active on public.membership_plans(is_active, code) where is_active = true;

-- User memberships
create table if not exists public.memberships (
  id uuid default gen_random_uuid() primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_id uuid not null references public.membership_plans(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  status public.membership_status not null default 'active',
  started_at timestamptz not null default now(),
  renew_at timestamptz null,
  cancelled_at timestamptz null,
  expires_at timestamptz null,

  -- Billing
  last_billed_at timestamptz null,
  next_bill_at timestamptz null,

  -- Family sharing
  shared_from_membership_id uuid null references public.memberships(id) on delete set null,
  is_primary boolean not null default true
);

create unique index if not exists ix_memberships_user_active
  on public.memberships(user_id, plan_id)
  where status = 'active';

create index if not exists ix_memberships_renew on public.memberships(next_bill_at) where status = 'active';

-- Pricing rules (for fee calculations)
create table if not exists public.pricing_rules (
  id uuid default gen_random_uuid() primary key,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  code text not null unique,
  name text not null,
  description text null,

  -- Applicability
  priority integer not null default 0,  -- higher = evaluated first
  environment text null,  -- null = all, or 'staging', 'production'
  regions text[] null,  -- null = all

  -- Conditions
  min_subtotal_iqd bigint null,
  max_subtotal_iqd bigint null,
  requires_membership boolean not null default false,
  membership_plan_codes text[] null,  -- specific plans, or null = any

  -- Effects
  delivery_fee_iqd bigint null,  -- override
  delivery_fee_waived boolean not null default false,
  service_fee_pct numeric null,  -- override
  small_order_fee_iqd bigint null,

  -- Status
  is_active boolean not null default true,
  valid_from timestamptz null,
  valid_until timestamptz null
);

create index if not exists ix_pricing_rules_active on public.pricing_rules(priority desc, is_active) where is_active = true;

-- Fee disclosures (localized strings for UI)
create table if not exists public.fee_disclosures (
  id uuid default gen_random_uuid() primary key,
  fee_type text not null,  -- 'delivery', 'service', 'small_order', 'priority'
  locale text not null default 'en',
  title text not null,
  explanation text not null,

  constraint fee_disclosures_unique unique (fee_type, locale)
);

-- Insert default fee disclosures
insert into public.fee_disclosures (fee_type, locale, title, explanation)
values
  ('delivery', 'en', 'Delivery Fee', 'This fee helps pay drivers for bringing your order.'),
  ('service', 'en', 'Service Fee', 'This fee supports platform operations and customer support.'),
  ('small_order', 'en', 'Small Order Fee', 'Applied to orders under the minimum to cover handling costs.'),
  ('priority', 'en', 'Priority Fee', 'Optional fee for faster delivery when demand is high.'),
  ('delivery', 'ar', 'رسوم التوصيل', 'تساعد هذه الرسوم على دفع أجور السائقين لإيصال طلبك.'),
  ('service', 'ar', 'رسوم الخدمة', 'تدعم هذه الرسوم عمليات المنصة وخدمة العملاء.')
on conflict (fee_type, locale) do nothing;

-- RLS for membership tables
alter table public.membership_plans enable row level security;
alter table public.memberships enable row level security;
alter table public.pricing_rules enable row level security;
alter table public.fee_disclosures enable row level security;

-- Plans are publicly readable
drop policy if exists membership_plans_read on public.membership_plans;
create policy membership_plans_read on public.membership_plans
  for select
  to authenticated, anon
  using (is_active = true);

drop policy if exists membership_plans_service on public.membership_plans;
create policy membership_plans_service on public.membership_plans
  to service_role
  using (true)
  with check (true);

-- Memberships: users see their own
drop policy if exists memberships_own on public.memberships;
create policy memberships_own on public.memberships
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists memberships_service on public.memberships;
create policy memberships_service on public.memberships
  to service_role
  using (true)
  with check (true);

-- Pricing rules: service_role only for management
drop policy if exists pricing_rules_service on public.pricing_rules;
create policy pricing_rules_service on public.pricing_rules
  to service_role
  using (true)
  with check (true);

-- Fee disclosures: publicly readable
drop policy if exists fee_disclosures_read on public.fee_disclosures;
create policy fee_disclosures_read on public.fee_disclosures
  for select
  to authenticated, anon
  using (true);

drop policy if exists fee_disclosures_service on public.fee_disclosures;
create policy fee_disclosures_service on public.fee_disclosures
  to service_role
  using (true)
  with check (true);

--------------------------------------------------------------------------------
-- RPC FUNCTIONS
--------------------------------------------------------------------------------

-- Get applicable pricing rules for an order
create or replace function public.get_applicable_pricing_rules(
  p_subtotal_iqd bigint,
  p_region text default null,
  p_user_id uuid default null
)
returns table(
  id uuid,
  code text,
  name text,
  delivery_fee_iqd bigint,
  delivery_fee_waived boolean,
  service_fee_pct numeric,
  small_order_fee_iqd bigint
)
language plpgsql
security definer
set search_path = 'pg_catalog, public'
as $$
declare
  v_has_membership boolean := false;
  v_membership_plan_codes text[];
begin
  -- Check if user has active membership
  if p_user_id is not null then
    select true, array_agg(mp.code)
    into v_has_membership, v_membership_plan_codes
    from public.memberships m
    join public.membership_plans mp on mp.id = m.plan_id
    where m.user_id = p_user_id
      and m.status = 'active'
      and (m.expires_at is null or m.expires_at > now());
  end if;

  return query
  select
    pr.id,
    pr.code,
    pr.name,
    pr.delivery_fee_iqd,
    pr.delivery_fee_waived,
    pr.service_fee_pct,
    pr.small_order_fee_iqd
  from public.pricing_rules pr
  where pr.is_active = true
    and (pr.valid_from is null or pr.valid_from <= now())
    and (pr.valid_until is null or pr.valid_until > now())
    and (pr.min_subtotal_iqd is null or p_subtotal_iqd >= pr.min_subtotal_iqd)
    and (pr.max_subtotal_iqd is null or p_subtotal_iqd <= pr.max_subtotal_iqd)
    and (pr.regions is null or p_region = any(pr.regions))
    and (
      pr.requires_membership = false
      or (v_has_membership and (pr.membership_plan_codes is null or pr.membership_plan_codes && v_membership_plan_codes))
    )
  order by pr.priority desc
  limit 5;
end;
$$;

grant execute on function public.get_applicable_pricing_rules(bigint, text, uuid) to authenticated;
grant execute on function public.get_applicable_pricing_rules(bigint, text, uuid) to service_role;

-- Check user membership status
create or replace function public.get_user_membership(p_user_id uuid default null)
returns table(
  membership_id uuid,
  plan_code text,
  plan_name text,
  status public.membership_status,
  expires_at timestamptz,
  free_delivery_min_order_iqd bigint,
  service_fee_discount_pct numeric
)
language sql
security definer
set search_path = 'pg_catalog, public'
as $$
  select
    m.id as membership_id,
    mp.code as plan_code,
    mp.name as plan_name,
    m.status,
    m.expires_at,
    mp.free_delivery_min_order_iqd,
    mp.service_fee_discount_pct
  from public.memberships m
  join public.membership_plans mp on mp.id = m.plan_id
  where m.user_id = coalesce(p_user_id, auth.uid())
    and m.status = 'active'
    and (m.expires_at is null or m.expires_at > now())
  order by m.created_at desc
  limit 1
$$;

grant execute on function public.get_user_membership(uuid) to authenticated;

--------------------------------------------------------------------------------
-- GRANTS
--------------------------------------------------------------------------------

grant select, insert, update on table public.concierge_sessions to authenticated;
grant select, insert on table public.concierge_feedback to authenticated;
grant select, insert, update on table public.order_bundles to authenticated;
grant select on table public.membership_plans to authenticated, anon;
grant select, insert, update on table public.memberships to authenticated;
grant select on table public.fee_disclosures to authenticated, anon;

grant all on table public.concierge_sessions to service_role;
grant all on table public.concierge_feedback to service_role;
grant all on table public.order_bundles to service_role;
grant all on table public.addon_offers to service_role;
grant all on table public.membership_plans to service_role;
grant all on table public.memberships to service_role;
grant all on table public.pricing_rules to service_role;
grant all on table public.fee_disclosures to service_role;
;
