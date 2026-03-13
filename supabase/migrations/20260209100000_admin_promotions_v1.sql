-- Admin: Promotions module (Next Admin)
--
-- Adds admin-safe RPCs for Gift Codes, Merchant Promotions, and Referral Campaign tuning.
--
-- Notes:
--  - Gift codes existed as single-use wallet credits; this migration adds voiding support.
--  - Admin RPCs are SECURITY DEFINER and gated by admin RBAC (promotions.* permissions).

BEGIN;
-- ------------------------------------------------------------
-- 1) Admin audit actions (extend enum)
-- ------------------------------------------------------------

ALTER TYPE public.admin_audit_action ADD VALUE IF NOT EXISTS 'gift_code_create';
ALTER TYPE public.admin_audit_action ADD VALUE IF NOT EXISTS 'gift_code_void';
ALTER TYPE public.admin_audit_action ADD VALUE IF NOT EXISTS 'merchant_promotion_toggle';
ALTER TYPE public.admin_audit_action ADD VALUE IF NOT EXISTS 'referral_campaign_update';
-- ------------------------------------------------------------
-- 2) Gift codes: add voiding fields + enforce at redemption
-- ------------------------------------------------------------

ALTER TABLE public.gift_codes
  ADD COLUMN IF NOT EXISTS voided_by uuid,
  ADD COLUMN IF NOT EXISTS voided_at timestamptz,
  ADD COLUMN IF NOT EXISTS voided_reason text;
CREATE INDEX IF NOT EXISTS ix_gift_codes_voided_at
  ON public.gift_codes(voided_at)
  WHERE voided_at IS NOT NULL;
-- Redeem: reject voided codes.
-- We replace the function (definition originates in the schema migration).
CREATE OR REPLACE FUNCTION public.redeem_gift_code(p_code text) RETURNS public.gift_codes
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog, extensions'
AS $$
DECLARE
  v_uid uuid;
  v_code text;
  v_gift public.gift_codes;
  v_entry_id bigint;
  v_memo text;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  v_code := upper(trim(coalesce(p_code, '')));
  IF v_code = '' THEN
    RAISE EXCEPTION 'missing_code';
  END IF;

  SELECT * INTO v_gift
  FROM public.gift_codes
  WHERE code = v_code
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'gift_code_not_found' USING errcode = 'P0002';
  END IF;

  IF v_gift.voided_at IS NOT NULL THEN
    RAISE EXCEPTION 'gift_code_voided';
  END IF;

  IF v_gift.redeemed_at IS NOT NULL THEN
    RAISE EXCEPTION 'gift_code_already_redeemed';
  END IF;

  INSERT INTO public.wallet_accounts(user_id)
  VALUES (v_uid)
  ON CONFLICT (user_id) DO NOTHING;

  v_memo := coalesce(v_gift.memo, 'Gift code');

  UPDATE public.wallet_accounts
  SET balance_iqd = balance_iqd + v_gift.amount_iqd
  WHERE user_id = v_uid;

  INSERT INTO public.wallet_entries (user_id, delta_iqd, kind, memo, source_type, source_id, metadata, idempotency_key)
  VALUES (
    v_uid,
    v_gift.amount_iqd,
    'adjustment',
    v_memo,
    'gift_code',
    NULL,
    jsonb_build_object('code', v_code, 'amount_iqd', v_gift.amount_iqd),
    'gift_code:' || v_code
  )
  RETURNING id INTO v_entry_id;

  UPDATE public.gift_codes
  SET redeemed_by = v_uid,
      redeemed_at = now(),
      redeemed_entry_id = v_entry_id
  WHERE code = v_code
  RETURNING * INTO v_gift;

  RETURN v_gift;
END;
$$;
-- Admin list gift codes with basic status filtering.
CREATE OR REPLACE FUNCTION public.admin_gift_codes_list_v1(
  p_q text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS TABLE(
  code text,
  amount_iqd bigint,
  memo text,
  created_by uuid,
  created_at timestamptz,
  redeemed_by uuid,
  redeemed_at timestamptz,
  voided_by uuid,
  voided_at timestamptz,
  voided_reason text
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  st text := NULLIF(btrim(COALESCE(p_status, '')), '');
  lim integer := LEAST(200, GREATEST(1, COALESCE(p_limit, 50)));
  off integer := GREATEST(0, COALESCE(p_offset, 0));
  q text := NULLIF(btrim(COALESCE(p_q, '')), '');
BEGIN
  IF NOT public.admin_has_permission('promotions.read') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    g.code,
    g.amount_iqd,
    g.memo,
    g.created_by,
    g.created_at,
    g.redeemed_by,
    g.redeemed_at,
    g.voided_by,
    g.voided_at,
    g.voided_reason
  FROM public.gift_codes g
  WHERE
    (q IS NULL OR g.code ILIKE '%' || q || '%' OR COALESCE(g.memo, '') ILIKE '%' || q || '%')
    AND (
      st IS NULL
      OR (st = 'unredeemed' AND g.redeemed_at IS NULL AND g.voided_at IS NULL)
      OR (st = 'redeemed' AND g.redeemed_at IS NOT NULL)
      OR (st = 'voided' AND g.voided_at IS NOT NULL)
    )
  ORDER BY g.created_at DESC
  OFFSET off
  LIMIT lim;
END;
$$;
-- Admin bulk generator: creates N single-use gift codes.
CREATE OR REPLACE FUNCTION public.admin_generate_gift_codes_v1(
  p_count integer,
  p_amount_iqd bigint,
  p_prefix text DEFAULT NULL,
  p_length integer DEFAULT 12,
  p_memo text DEFAULT NULL
)
RETURNS TABLE(code text)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  actor uuid := auth.uid();
  n integer := LEAST(500, GREATEST(1, COALESCE(p_count, 1)));
  amt bigint := COALESCE(p_amount_iqd, 0);
  pref text := upper(regexp_replace(COALESCE(p_prefix, ''), '[^A-Za-z0-9]+', '', 'g'));
  len integer := LEAST(24, GREATEST(8, COALESCE(p_length, 12)));
  memo text := NULLIF(btrim(COALESCE(p_memo, '')), '');
  inserted integer := 0;
  token text;
  c text;
BEGIN
  IF NOT public.admin_has_permission('promotions.manage') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF amt IS NULL OR amt <= 0 THEN
    RAISE EXCEPTION 'invalid_amount' USING ERRCODE = '22023';
  END IF;

  IF length(pref) >= len THEN
    RAISE EXCEPTION 'prefix_too_long' USING ERRCODE = '22023';
  END IF;

  WHILE inserted < n LOOP
    token := upper(substr(replace(extensions.gen_random_uuid()::text, '-', ''), 1, len - length(pref)));
    c := pref || token;
    BEGIN
      INSERT INTO public.gift_codes(code, amount_iqd, memo, created_by)
      VALUES (c, amt, memo, actor);
      inserted := inserted + 1;
      RETURN QUERY SELECT c;
    EXCEPTION WHEN unique_violation THEN
      -- retry with a new token
      NULL;
    END;
  END LOOP;

  INSERT INTO public.admin_audit_log(actor_id, action, target_user_id, note, details)
  VALUES (
    actor,
    'gift_code_create',
    actor,
    memo,
    jsonb_build_object('count', n, 'amount_iqd', amt, 'prefix', pref, 'length', len)
  );
END;
$$;
-- Admin void single gift code.
CREATE OR REPLACE FUNCTION public.admin_void_gift_code_v1(
  p_code text,
  p_reason text DEFAULT NULL
)
RETURNS public.gift_codes
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  actor uuid := auth.uid();
  c text := upper(trim(COALESCE(p_code, '')));
  r text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_row public.gift_codes;
BEGIN
  IF NOT public.admin_has_permission('promotions.manage') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF c = '' THEN
    RAISE EXCEPTION 'missing_code' USING ERRCODE = '22004';
  END IF;

  SELECT * INTO v_row
  FROM public.gift_codes
  WHERE code = c
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'gift_code_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_row.redeemed_at IS NOT NULL THEN
    RAISE EXCEPTION 'gift_code_already_redeemed' USING ERRCODE = '22023';
  END IF;

  IF v_row.voided_at IS NULL THEN
    UPDATE public.gift_codes
    SET voided_by = actor,
        voided_at = now(),
        voided_reason = r
    WHERE code = c
    RETURNING * INTO v_row;

    INSERT INTO public.admin_audit_log(actor_id, action, target_user_id, note, details)
    VALUES (
      actor,
      'gift_code_void',
      actor,
      r,
      jsonb_build_object('code', c)
    );
  END IF;

  RETURN v_row;
END;
$$;
-- ------------------------------------------------------------
-- 3) Merchant promotions: admin list + toggle active
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_merchant_promotions_list_v1(
  p_q text DEFAULT NULL,
  p_only_active boolean DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS TABLE(
  id uuid,
  merchant_id uuid,
  merchant_name text,
  merchant_status public.merchant_status,
  product_id uuid,
  category text,
  discount_type public.merchant_promotion_discount_type,
  value numeric,
  starts_at timestamptz,
  ends_at timestamptz,
  is_active boolean,
  created_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  lim integer := LEAST(200, GREATEST(1, COALESCE(p_limit, 50)));
  off integer := GREATEST(0, COALESCE(p_offset, 0));
  q text := NULLIF(btrim(COALESCE(p_q, '')), '');
BEGIN
  IF NOT public.admin_has_permission('promotions.read') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    mp.id,
    mp.merchant_id,
    m.business_name AS merchant_name,
    m.status AS merchant_status,
    mp.product_id,
    mp.category,
    mp.discount_type,
    mp.value,
    mp.starts_at,
    mp.ends_at,
    mp.is_active,
    mp.created_at
  FROM public.merchant_promotions mp
  JOIN public.merchants m ON m.id = mp.merchant_id
  WHERE
    (q IS NULL OR m.business_name ILIKE '%' || q || '%' OR COALESCE(mp.category, '') ILIKE '%' || q || '%')
    AND (p_only_active IS NULL OR mp.is_active = p_only_active)
  ORDER BY mp.created_at DESC
  OFFSET off
  LIMIT lim;
END;
$$;
CREATE OR REPLACE FUNCTION public.admin_set_merchant_promotion_active_v1(
  p_id uuid,
  p_is_active boolean,
  p_note text DEFAULT NULL
)
RETURNS public.merchant_promotions
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  actor uuid := auth.uid();
  row public.merchant_promotions;
  note text := NULLIF(btrim(COALESCE(p_note, '')), '');
  owner_id uuid;
BEGIN
  IF NOT public.admin_has_permission('promotions.manage') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF p_id IS NULL THEN
    RAISE EXCEPTION 'missing_id' USING ERRCODE = '22004';
  END IF;

  UPDATE public.merchant_promotions
  SET is_active = COALESCE(p_is_active, true)
  WHERE id = p_id
  RETURNING * INTO row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'promotion_not_found' USING ERRCODE = 'P0002';
  END IF;

  SELECT m.owner_profile_id INTO owner_id FROM public.merchants m WHERE m.id = row.merchant_id;

  INSERT INTO public.admin_audit_log(actor_id, action, target_user_id, note, details)
  VALUES (
    actor,
    'merchant_promotion_toggle',
    COALESCE(owner_id, actor),
    note,
    jsonb_build_object('promotion_id', row.id, 'merchant_id', row.merchant_id, 'is_active', row.is_active)
  );

  RETURN row;
END;
$$;
-- ------------------------------------------------------------
-- 4) Referral campaigns: admin list + update
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_referral_campaigns_list_v1()
RETURNS TABLE(
  id uuid,
  key text,
  referrer_reward_iqd integer,
  referred_reward_iqd integer,
  active boolean,
  created_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT rc.id, rc.key, rc.referrer_reward_iqd, rc.referred_reward_iqd, rc.active, rc.created_at
  FROM public.referral_campaigns rc
  WHERE public.admin_has_permission('promotions.read')
  ORDER BY rc.created_at DESC;
$$;
CREATE OR REPLACE FUNCTION public.admin_update_referral_campaign_v1(
  p_key text,
  p_referrer_reward_iqd integer,
  p_referred_reward_iqd integer,
  p_active boolean
)
RETURNS public.referral_campaigns
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  actor uuid := auth.uid();
  k text := NULLIF(btrim(COALESCE(p_key, '')), '');
  row public.referral_campaigns;
BEGIN
  IF NOT public.admin_has_permission('promotions.manage') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF k IS NULL THEN
    RAISE EXCEPTION 'missing_key' USING ERRCODE = '22004';
  END IF;

  UPDATE public.referral_campaigns
  SET referrer_reward_iqd = COALESCE(p_referrer_reward_iqd, referrer_reward_iqd),
      referred_reward_iqd = COALESCE(p_referred_reward_iqd, referred_reward_iqd),
      active = COALESCE(p_active, active)
  WHERE key = k
  RETURNING * INTO row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'campaign_not_found' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.admin_audit_log(actor_id, action, target_user_id, note, details)
  VALUES (
    actor,
    'referral_campaign_update',
    actor,
    NULL,
    jsonb_build_object(
      'key', row.key,
      'referrer_reward_iqd', row.referrer_reward_iqd,
      'referred_reward_iqd', row.referred_reward_iqd,
      'active', row.active
    )
  );

  RETURN row;
END;
$$;
-- ------------------------------------------------------------
-- 5) Grants (RPC allowlist is handled in repo config)
-- ------------------------------------------------------------

GRANT EXECUTE ON FUNCTION public.admin_gift_codes_list_v1(text, text, integer, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_generate_gift_codes_v1(integer, bigint, text, integer, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_void_gift_code_v1(text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_merchant_promotions_list_v1(text, boolean, integer, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_merchant_promotion_active_v1(uuid, boolean, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_referral_campaigns_list_v1() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_update_referral_campaign_v1(text, integer, integer, boolean) TO authenticated, service_role;
COMMIT;
