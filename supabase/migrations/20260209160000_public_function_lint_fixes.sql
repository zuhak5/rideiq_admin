-- Fixes for warnings from `supabase db lint --linked --schema public`.
-- Keep this migration minimal and behavior-preserving where possible.

-- -------------------------------------------------------------------
-- 1) service_areas: persist optional admin notes (used by *_bbox_v2 RPC)
-- -------------------------------------------------------------------
ALTER TABLE public.service_areas
  ADD COLUMN IF NOT EXISTS notes text;

COMMENT ON COLUMN public.service_areas.notes IS
  'Optional internal notes for service area configuration (admin-supplied).';

-- -------------------------------------------------------------------
-- 2) Referral: make plpgsql_check happy about control flow + unused vars
-- -------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_referral_code(p_user_id uuid DEFAULT NULL::uuid) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog, public'
    AS $$
DECLARE
  v_uid uuid := coalesce(p_user_id, (SELECT auth.uid()));
  v_code text;
  v_try int := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  SELECT code INTO v_code FROM public.referral_codes WHERE user_id = v_uid;
  IF FOUND THEN
    RETURN v_code;
  END IF;

  LOOP
    v_try := v_try + 1;
    v_code := upper(substring(replace(encode(extensions.gen_random_bytes(6), 'base32'), '=', '') FROM 1 FOR 8));

    BEGIN
      INSERT INTO public.referral_codes(code, user_id)
      VALUES (v_code, v_uid);
      RETURN v_code;
    EXCEPTION WHEN unique_violation THEN
      IF v_try > 10 THEN
        RAISE EXCEPTION 'could_not_generate_code';
      END IF;
    END;
  END LOOP;

  -- Unreachable, but keeps plpgsql_check from warning about missing RETURN.
  RAISE EXCEPTION 'could_not_generate_code';
END;
$$;

CREATE OR REPLACE FUNCTION public.referral_apply_code(p_code text) RETURNS TABLE(applied boolean, referrer_id uuid, campaign_key text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog, public'
    AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_code text := upper(trim(coalesce(p_code, '')));
  v_referrer uuid;
  v_campaign public.referral_campaigns%rowtype;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;
  IF v_code = '' THEN
    RAISE EXCEPTION 'invalid_code';
  END IF;

  SELECT user_id INTO v_referrer FROM public.referral_codes WHERE code = v_code;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'code_not_found';
  END IF;
  IF v_referrer = v_uid THEN
    RAISE EXCEPTION 'self_referral_not_allowed';
  END IF;

  SELECT * INTO v_campaign FROM public.referral_campaigns WHERE key = 'default' AND active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'campaign_not_found';
  END IF;

  -- Existence check only (avoid unused variable warnings).
  PERFORM 1 FROM public.referral_redemptions WHERE referred_id = v_uid;
  IF FOUND THEN
    -- already referred (idempotent)
    RETURN QUERY SELECT false, v_referrer, v_campaign.key;
    RETURN;
  END IF;

  INSERT INTO public.referral_redemptions(campaign_id, referrer_id, referred_id, code, status)
  VALUES (v_campaign.id, v_referrer, v_uid, v_code, 'pending');

  PERFORM public.notify_user(v_uid, 'referral_applied', 'Referral applied', 'Referral code applied successfully.', jsonb_build_object('code', v_code));
  PERFORM public.notify_user(v_referrer, 'referral_pending', 'New referral', 'A new user joined with your referral code.', jsonb_build_object('code', v_code, 'referred_id', v_uid));

  RETURN QUERY SELECT true, v_referrer, v_campaign.key;
END;
$$;

CREATE OR REPLACE FUNCTION public.referral_claim(p_code text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions', 'pg_temp'
    AS $$
DECLARE
  v_uid uuid;
  v_referrer uuid;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT user_id INTO v_referrer
  FROM public.referral_codes
  WHERE code = upper(p_code);

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_code';
  END IF;

  IF v_referrer = v_uid THEN
    RAISE EXCEPTION 'cannot_self_refer';
  END IF;

  -- Existence check only (avoid unused variable warnings).
  PERFORM 1
  FROM public.referral_invites
  WHERE referred_user_id = v_uid;

  IF FOUND THEN
    RAISE EXCEPTION 'already_claimed';
  END IF;

  INSERT INTO public.referral_invites (referrer_id, referred_user_id, code_used, status)
  VALUES (v_referrer, v_uid, upper(p_code), 'pending');

  PERFORM public.notify_user(v_referrer, 'referral_new', 'New referral', 'A new user joined using your code', jsonb_build_object('referred_user_id', v_uid));
  PERFORM public.notify_user(v_uid, 'referral_applied', 'Referral applied', 'Complete your first ride to unlock your reward', jsonb_build_object('referrer_id', v_referrer));

  RETURN jsonb_build_object('ok', true, 'referrer_id', v_referrer);
END;
$$;

-- -------------------------------------------------------------------
-- 3) Service areas: use p_notes (avoid unused parameter warnings)
-- -------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_create_service_area_bbox_v2(
  p_name text,
  p_governorate text,
  p_min_lat double precision,
  p_min_lng double precision,
  p_max_lat double precision,
  p_max_lng double precision,
  p_priority integer DEFAULT 0,
  p_is_active boolean DEFAULT true,
  p_pricing_config_id uuid DEFAULT NULL::uuid,
  p_min_base_fare_iqd integer DEFAULT NULL::integer,
  p_surge_multiplier numeric DEFAULT NULL::numeric,
  p_surge_reason text DEFAULT NULL::text,
  p_notes text DEFAULT NULL::text
) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.service_areas (
    name,
    governorate,
    is_active,
    priority,
    pricing_config_id,
    min_base_fare_iqd,
    surge_multiplier,
    surge_reason,
    notes,
    geom
  )
  VALUES (
    p_name,
    p_governorate,
    COALESCE(p_is_active, true),
    COALESCE(p_priority, 0),
    p_pricing_config_id,
    p_min_base_fare_iqd,
    GREATEST(COALESCE(p_surge_multiplier, 1.0), 1.0),
    p_surge_reason,
    p_notes,
    extensions.ST_Multi(extensions.ST_MakeEnvelope(p_min_lng, p_min_lat, p_max_lng, p_max_lat, 4326))
  )
  ON CONFLICT (name, governorate) DO UPDATE
    SET is_active = EXCLUDED.is_active,
        priority = EXCLUDED.priority,
        pricing_config_id = EXCLUDED.pricing_config_id,
        min_base_fare_iqd = EXCLUDED.min_base_fare_iqd,
        surge_multiplier = EXCLUDED.surge_multiplier,
        surge_reason = EXCLUDED.surge_reason,
        notes = COALESCE(EXCLUDED.notes, service_areas.notes),
        geom = EXCLUDED.geom,
        updated_at = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- -------------------------------------------------------------------
-- 4) Withdrawals: lock wallet row without unused record variables
-- -------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_withdraw_reject(
  p_request_id uuid,
  p_note text DEFAULT NULL::text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  r record;
  h record;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'not_admin' USING errcode = '42501';
  END IF;
  IF NOT public.admin_has_permission('withdrawals.reject') THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  SELECT * INTO r
  FROM public.wallet_withdraw_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'withdraw_request_not_found' USING errcode = 'P0002';
  END IF;

  IF r.status NOT IN ('requested','approved') THEN
    RAISE EXCEPTION 'invalid_status_transition' USING errcode = '22023';
  END IF;

  SELECT * INTO h
  FROM public.wallet_holds
  WHERE withdraw_request_id = r.id AND status = 'active'
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'withdraw_hold_missing' USING errcode = 'P0001';
  END IF;

  IF h.amount_iqd < r.amount_iqd THEN
    RAISE EXCEPTION 'withdraw_hold_insufficient' USING errcode = '22023';
  END IF;

  -- Lock wallet account row (existence check only).
  PERFORM 1 FROM public.wallet_accounts WHERE user_id = r.user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'wallet_account_not_found' USING errcode = 'P0002';
  END IF;

  UPDATE public.wallet_holds
  SET status = 'released', released_at = now(), updated_at = now()
  WHERE id = h.id AND status = 'active';

  UPDATE public.wallet_accounts
  SET held_iqd = GREATEST(held_iqd - r.amount_iqd, 0),
      updated_at = now()
  WHERE user_id = r.user_id;

  UPDATE public.wallet_withdraw_requests
  SET status = 'rejected',
      note = COALESCE(p_note, note),
      rejected_at = now(),
      updated_at = now()
  WHERE id = r.id;

  PERFORM public.notify_user(
    r.user_id,
    'withdraw_rejected',
    'Withdrawal rejected',
    COALESCE(p_note, 'Your withdrawal request was rejected and funds were released.'),
    jsonb_build_object('request_id', r.id, 'amount_iqd', r.amount_iqd, 'payout_kind', r.payout_kind)
  );
END;
$$;

