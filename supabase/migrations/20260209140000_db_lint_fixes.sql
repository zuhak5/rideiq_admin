-- Fixes for issues found by `supabase db lint --schema public --level error`.
-- Keep this migration focused on correctness/compatibility fixes (no behavior changes unless required).

-- -------------------------------------------------------------------
-- 1) Enum consistency: wallet_entry_kind is used with 'reward' in RPCs
-- -------------------------------------------------------------------
ALTER TYPE public.wallet_entry_kind ADD VALUE IF NOT EXISTS 'reward';
-- -------------------------------------------------------------------
-- 2) public.is_admin(): simplify to avoid plpgsql_check false positives
--    (dynamic SQL referenced columns that don't exist in this schema)
-- -------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_admin() RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE
  uid uuid := (SELECT auth.uid());
BEGIN
  RETURN public.is_admin(uid);
END;
$$;
-- -------------------------------------------------------------------
-- 5) Driver details: avoid ambiguity with RETURNS TABLE plate_number
-- -------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_assigned_driver(p_ride_id uuid) RETURNS TABLE(driver_id uuid, display_name text, rating_avg numeric, rating_count integer, vehicle_make text, vehicle_model text, vehicle_color text, plate_number text)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog, public'
    AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_ride record;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  SELECT r.id, r.rider_id, r.driver_id INTO v_ride
  FROM public.rides r
  WHERE r.id = p_ride_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ride_not_found';
  END IF;

  IF v_ride.rider_id <> v_uid AND v_ride.driver_id <> v_uid AND NOT (SELECT public.is_admin()) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN QUERY
  SELECT
    d.id,
    pp.display_name,
    d.rating_avg,
    d.rating_count,
    dv.make,
    dv.model,
    dv.color,
    dv.plate_number
  FROM public.drivers d
  LEFT JOIN public.public_profiles pp ON pp.id = d.id
  LEFT JOIN LATERAL (
    SELECT v.make, v.model, v.color, v.plate_number
    FROM public.driver_vehicles v
    WHERE v.driver_id = d.id
    ORDER BY v.updated_at DESC NULLS LAST, v.created_at DESC
    LIMIT 1
  ) dv ON true
  WHERE d.id = v_ride.driver_id;
END;
$$;
-- -------------------------------------------------------------------
-- 6) Outboxes: avoid ambiguity with RETURNS TABLE(id ...)
-- -------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notification_outbox_claim(p_limit integer DEFAULT 50, p_lock_id uuid DEFAULT NULL::uuid) RETURNS TABLE(id bigint, notification_id uuid, user_id uuid, device_token_id bigint, payload jsonb, attempts integer)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
BEGIN
  RETURN QUERY
  WITH picked AS (
    SELECT o.id
    FROM public.notification_outbox o
    WHERE o.status = 'pending'
      AND o.next_attempt_at <= now()
    ORDER BY o.id
    LIMIT greatest(1, least(coalesce(p_limit, 50), 200))
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.notification_outbox o
    SET status = 'processing',
        attempts = o.attempts + 1,
        last_attempt_at = now(),
        lock_id = p_lock_id,
        locked_at = now()
  WHERE o.id IN (SELECT p.id FROM picked p)
  RETURNING o.id, o.notification_id, o.user_id, o.device_token_id, o.payload, o.attempts;
END;
$$;
CREATE OR REPLACE FUNCTION public.trusted_contact_outbox_claim(p_limit integer DEFAULT 50) RETURNS TABLE(id uuid, user_id uuid, contact_id uuid, sos_event_id uuid, ride_id uuid, channel public.contact_channel, to_phone text, payload jsonb, attempts integer)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog, public'
    AS $$
BEGIN
  RETURN QUERY
  WITH picked AS (
    SELECT o.id
    FROM public.trusted_contact_outbox o
    WHERE (
      (o.status = 'pending' AND o.next_attempt_at <= now())
      OR
      (o.status = 'processing' AND o.last_attempt_at < now() - interval '15 minutes')
    )
    ORDER BY o.created_at ASC
    LIMIT greatest(1, least(coalesce(p_limit, 50), 200))
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.trusted_contact_outbox o
    SET status = 'processing',
        attempts = o.attempts + 1,
        last_attempt_at = now(),
        updated_at = now()
  WHERE o.id IN (SELECT p.id FROM picked p)
  RETURNING o.id, o.user_id, o.contact_id, o.sos_event_id, o.ride_id, o.channel, o.to_phone, o.payload, o.attempts;
END;
$$;
-- -------------------------------------------------------------------
-- 7) Referral + WebAuthn: qualify extensions.gen_random_bytes()
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
END;
$$;
CREATE OR REPLACE FUNCTION public.webauthn_create_challenge(p_challenge_type text, p_user_id uuid DEFAULT NULL::uuid, p_session_id text DEFAULT NULL::text, p_user_agent text DEFAULT NULL::text, p_challenge bytea DEFAULT NULL::bytea) RETURNS TABLE(challenge_id uuid, challenge bytea, expires_at timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_challenge bytea;
BEGIN
  v_challenge := coalesce(p_challenge, extensions.gen_random_bytes(32));

  INSERT INTO public.webauthn_challenges AS wc (challenge_type, user_id, session_id, user_agent, challenge, expires_at)
  VALUES (p_challenge_type, p_user_id, p_session_id, left(p_user_agent, 500), v_challenge, now() + interval '5 minutes')
  RETURNING wc.id, wc.challenge, wc.expires_at
  INTO challenge_id, challenge, expires_at;
END;
$$;
-- -------------------------------------------------------------------
-- 8) Driver rank snapshots: fix column name (fare_amount_iqd exists)
-- -------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.refresh_driver_rank_snapshots(p_period public.driver_rank_period, p_period_start date, p_limit integer DEFAULT 200) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog, public'
    AS $$
DECLARE
  v_period public.driver_rank_period := coalesce(p_period, 'weekly'::public.driver_rank_period);
  v_start date := p_period_start;
  v_end date;
  v_limit integer := greatest(1, least(coalesce(p_limit, 200), 1000));
BEGIN
  IF v_start IS NULL THEN
    RAISE EXCEPTION 'period_start_required';
  END IF;

  IF v_period = 'weekly'::public.driver_rank_period THEN
    v_end := (v_start + interval '7 days')::date;
  ELSE
    v_end := (date_trunc('month', v_start::timestamptz) + interval '1 month')::date;
  END IF;

  DELETE FROM public.driver_rank_snapshots
  WHERE period = v_period AND period_start = v_start;

  INSERT INTO public.driver_rank_snapshots(period, period_start, period_end, driver_id, rank, score_iqd, rides_completed)
  SELECT
    v_period,
    v_start,
    v_end,
    s.driver_id,
    row_number() OVER (ORDER BY s.earnings_iqd DESC, s.rides_completed DESC, s.driver_id) AS rank,
    s.earnings_iqd,
    s.rides_completed
  FROM (
    SELECT
      r.driver_id,
      sum(coalesce(r.fare_amount_iqd, 0) - coalesce(r.platform_fee_iqd, 0))::bigint AS earnings_iqd,
      count(*)::int AS rides_completed
    FROM public.rides r
    WHERE r.status = 'completed'
      AND r.completed_at >= v_start
      AND r.completed_at < v_end
    GROUP BY r.driver_id
    HAVING count(*) > 0
    ORDER BY earnings_iqd DESC
    LIMIT v_limit
  ) s;
END;
$$;
-- -------------------------------------------------------------------
-- 9) Withdraw hooks: align wallet_holds status with enum (captured)
-- -------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.system_withdraw_mark_paid(p_request_id uuid, p_payout_reference text DEFAULT NULL::text, p_provider_payload jsonb DEFAULT NULL::jsonb) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog, public'
    AS $$
DECLARE
  r record;
  h record;
BEGIN
  -- Ensure only service_role can execute
  IF current_user <> 'service_role' THEN
    RAISE EXCEPTION 'not_allowed';
  END IF;

  SELECT * INTO r
  FROM public.wallet_withdraw_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'withdraw_request_not_found';
  END IF;

  IF r.status <> 'approved' THEN
    RAISE EXCEPTION 'invalid_status_transition';
  END IF;

  -- lock active hold
  SELECT * INTO h
  FROM public.wallet_holds
  WHERE withdraw_request_id = r.id AND status = 'active'
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  -- lock wallet account
  PERFORM 1 FROM public.wallet_accounts wa WHERE wa.user_id = r.user_id FOR UPDATE;

  UPDATE public.wallet_accounts
  SET held_iqd = greatest(held_iqd - r.amount_iqd, 0),
      balance_iqd = balance_iqd - r.amount_iqd,
      updated_at = now()
  WHERE user_id = r.user_id;

  -- mark hold captured if present
  IF h.id IS NOT NULL THEN
    UPDATE public.wallet_holds
      SET status = 'captured',
          captured_at = COALESCE(captured_at, now()),
          updated_at = now()
    WHERE id = h.id;
  END IF;

  UPDATE public.wallet_withdraw_requests
  SET status = 'paid',
      payout_reference = coalesce(nullif(p_payout_reference,''), payout_reference),
      paid_at = now(),
      updated_at = now()
  WHERE id = r.id;

  -- best-effort attempt log update with provider payload
  INSERT INTO public.wallet_payout_attempts(
    withdraw_request_id, payout_kind, amount_iqd, destination, status, provider_reference, request_payload, response_payload
  ) VALUES (
    r.id, r.payout_kind, r.amount_iqd, r.destination, 'succeeded', p_payout_reference, p_provider_payload, null
  )
  ON CONFLICT (withdraw_request_id) DO UPDATE
    SET status = 'succeeded',
        provider_reference = coalesce(excluded.provider_reference, public.wallet_payout_attempts.provider_reference),
        response_payload = coalesce(excluded.request_payload, public.wallet_payout_attempts.response_payload),
        updated_at = now();
END;
$$;
-- -------------------------------------------------------------------
-- 10) Service areas: fix broken bbox_v2 overload (missing params)
-- -------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_create_service_area_bbox_v2(p_name text, p_governorate text, p_min_lat double precision, p_min_lng double precision, p_max_lat double precision, p_max_lng double precision, p_priority integer DEFAULT 0, p_is_active boolean DEFAULT true, p_pricing_config_id uuid DEFAULT NULL::uuid, p_notes text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
BEGIN
  RETURN public.admin_create_service_area_bbox_v2(
    p_name,
    p_governorate,
    p_min_lat,
    p_min_lng,
    p_max_lat,
    p_max_lng,
    p_priority,
    p_is_active,
    p_pricing_config_id,
    NULL::integer,
    NULL::numeric,
    NULL::text,
    p_notes
  );
END;
$$;
-- -------------------------------------------------------------------
-- 11) Maps providers: SUM() returns bigint, but RPC returns integer cols
-- -------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_maps_provider_list_v1() RETURNS TABLE(provider_code text, priority integer, enabled boolean, language text, region text, monthly_soft_cap_units integer, monthly_hard_cap_units integer, note text, mtd_render integer, mtd_directions integer, mtd_geocode integer, mtd_distance_matrix integer, updated_at timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_month_start date := date_trunc('month', (now() AT TIME ZONE 'UTC'))::date;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF NOT (SELECT public.is_admin()) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  RETURN QUERY
  SELECT
    mp.provider_code,
    mp.priority,
    mp.enabled,
    mp.language,
    mp.region,
    mp.monthly_soft_cap_units,
    mp.monthly_hard_cap_units,
    mp.note,
    COALESCE((SELECT SUM(units) FROM public.maps_usage_daily mu WHERE mu.provider_code=mp.provider_code AND mu.day>=v_month_start AND mu.capability='render'),0)::int AS mtd_render,
    COALESCE((SELECT SUM(units) FROM public.maps_usage_daily mu WHERE mu.provider_code=mp.provider_code AND mu.day>=v_month_start AND mu.capability='directions'),0)::int AS mtd_directions,
    COALESCE((SELECT SUM(units) FROM public.maps_usage_daily mu WHERE mu.provider_code=mp.provider_code AND mu.day>=v_month_start AND mu.capability='geocode'),0)::int AS mtd_geocode,
    COALESCE((SELECT SUM(units) FROM public.maps_usage_daily mu WHERE mu.provider_code=mp.provider_code AND mu.day>=v_month_start AND mu.capability='distance_matrix'),0)::int AS mtd_distance_matrix,
    mp.updated_at
  FROM public.maps_providers mp
  ORDER BY mp.priority DESC;
END;
$$;
CREATE OR REPLACE FUNCTION public.admin_maps_provider_list_v2() RETURNS TABLE(provider_code text, priority integer, enabled boolean, language text, region text, monthly_soft_cap_units integer, monthly_hard_cap_units integer, cache_enabled boolean, cache_ttl_seconds integer, note text, mtd_render integer, mtd_directions integer, mtd_geocode integer, mtd_distance_matrix integer, updated_at timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_month_start date := date_trunc('month', (now() AT TIME ZONE 'UTC'))::date;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF NOT (SELECT public.is_admin()) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  RETURN QUERY
  SELECT
    mp.provider_code,
    mp.priority,
    mp.enabled,
    mp.language,
    mp.region,
    mp.monthly_soft_cap_units,
    mp.monthly_hard_cap_units,
    mp.cache_enabled,
    mp.cache_ttl_seconds,
    mp.note,
    COALESCE((SELECT SUM(units) FROM public.maps_usage_daily mu WHERE mu.provider_code=mp.provider_code AND mu.day>=v_month_start AND mu.capability='render'),0)::int AS mtd_render,
    COALESCE((SELECT SUM(units) FROM public.maps_usage_daily mu WHERE mu.provider_code=mp.provider_code AND mu.day>=v_month_start AND mu.capability='directions'),0)::int AS mtd_directions,
    COALESCE((SELECT SUM(units) FROM public.maps_usage_daily mu WHERE mu.provider_code=mp.provider_code AND mu.day>=v_month_start AND mu.capability='geocode'),0)::int AS mtd_geocode,
    COALESCE((SELECT SUM(units) FROM public.maps_usage_daily mu WHERE mu.provider_code=mp.provider_code AND mu.day>=v_month_start AND mu.capability='distance_matrix'),0)::int AS mtd_distance_matrix,
    mp.updated_at
  FROM public.maps_providers mp
  ORDER BY mp.priority DESC;
END;
$$;
-- -------------------------------------------------------------------
-- 12) Support tickets (user): cast text filter to enum type
-- -------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.support_ticket_list_user_v1(p_status text DEFAULT NULL::text, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog, public'
    AS $$
DECLARE
  v_uid uuid;
  v_limit integer;
  v_offset integer;
  v_status text;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  v_limit := GREATEST(1, LEAST(COALESCE(p_limit, 20), 50));
  v_offset := GREATEST(0, LEAST(COALESCE(p_offset, 0), 100000));
  v_status := NULLIF(trim(COALESCE(p_status, '')), '');

  IF v_status IS NOT NULL AND v_status NOT IN ('open','pending','resolved','closed') THEN
    RAISE EXCEPTION 'invalid_status';
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'tickets', COALESCE(
      (
        SELECT jsonb_agg(to_jsonb(t) ORDER BY t.updated_at DESC)
        FROM (
          SELECT
            id,
            category_code,
            subject,
            status,
            priority,
            ride_id,
            created_by,
            created_at,
            updated_at,
            last_message,
            last_message_at,
            messages_count
          FROM public.support_ticket_summaries
          WHERE (v_status IS NULL OR status = v_status::public.support_ticket_status)
          ORDER BY updated_at DESC
          OFFSET v_offset
          LIMIT v_limit
        ) t
      ),
      '[]'::jsonb
    ),
    'next_offset', v_offset + (
      SELECT COALESCE(count(*), 0)
      FROM (
        SELECT 1
        FROM public.support_ticket_summaries
        WHERE (v_status IS NULL OR status = v_status::public.support_ticket_status)
        ORDER BY updated_at DESC
        OFFSET v_offset
        LIMIT v_limit
      ) x
    )
  );
END;
$$;
-- -------------------------------------------------------------------
-- 13) Withdraw admin: fix ON CONFLICT target to match unique index
-- -------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_withdraw_mark_paid(p_request_id uuid, p_payout_reference text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog, extensions'
    AS $$
DECLARE
  r record;
  h record;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'not_admin';
  END IF;

  SELECT * INTO r
  FROM public.wallet_withdraw_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'withdraw_request_not_found';
  END IF;

  IF r.status <> 'approved' THEN
    RAISE EXCEPTION 'invalid_status_transition';
  END IF;

  -- lock active hold
  SELECT * INTO h
  FROM public.wallet_holds
  WHERE withdraw_request_id = r.id AND status = 'active'
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  -- lock wallet account
  PERFORM 1 FROM public.wallet_accounts wa WHERE wa.user_id = r.user_id FOR UPDATE;

  UPDATE public.wallet_accounts
  SET held_iqd = GREATEST(held_iqd - r.amount_iqd, 0),
      balance_iqd = balance_iqd - r.amount_iqd,
      updated_at = now()
  WHERE user_id = r.user_id;

  -- ledger entry
  INSERT INTO public.wallet_entries (user_id, delta_iqd, kind, memo, source_type, source_id, metadata, idempotency_key)
  VALUES (
    r.user_id,
    -r.amount_iqd,
    'withdrawal',
    'Driver withdrawal',
    'withdraw',
    r.id,
    jsonb_build_object(
      'payout_kind', r.payout_kind,
      'destination', r.destination,
      'payout_reference', p_payout_reference
    ),
    'withdraw:' || r.id::text
  )
  ON CONFLICT (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;

  UPDATE public.wallet_holds
  SET status = 'captured', captured_at = now(), updated_at = now()
  WHERE id = h.id AND status = 'active';

  UPDATE public.wallet_withdraw_requests
  SET status = 'paid',
      payout_reference = COALESCE(p_payout_reference, payout_reference),
      paid_at = now(),
      updated_at = now()
  WHERE id = r.id;

  PERFORM public.notify_user(r.user_id, 'withdraw_paid', 'Withdrawal paid',
    CASE WHEN p_payout_reference IS NULL OR p_payout_reference = '' THEN 'Your withdrawal has been paid.'
      ELSE 'Your withdrawal has been paid. Reference: ' || p_payout_reference END,
    jsonb_build_object('request_id', r.id, 'amount_iqd', r.amount_iqd, 'payout_kind', r.payout_kind, 'payout_reference', p_payout_reference)
  );
END;
$$;
-- -------------------------------------------------------------------
-- 14) RideCheck: resolve variable/column ambiguity in ON CONFLICT target
-- -------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ridecheck_respond_user(p_event_id uuid, p_response public.ridecheck_response, p_note text DEFAULT NULL::text) RETURNS TABLE(ride_id uuid, event_id uuid, kind public.ridecheck_kind, status public.ridecheck_event_status, already_closed boolean, role public.party_role)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'extensions'
    AS $$
#variable_conflict use_column
DECLARE
  v_uid uuid;
  v_role public.party_role;
  v_kind public.ridecheck_kind;
  v_status public.ridecheck_event_status;
  v_ride_id uuid;
  v_rider_id uuid;
  v_driver_id uuid;
  v_note text;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING errcode = '28000';
  END IF;

  SELECT e.ride_id, e.kind, e.status, r.rider_id, r.driver_id
    INTO v_ride_id, v_kind, v_status, v_rider_id, v_driver_id
  FROM public.ridecheck_events e
  JOIN public.rides r ON r.id = e.ride_id
  WHERE e.id = p_event_id
  FOR UPDATE;

  IF v_ride_id IS NULL THEN
    RAISE EXCEPTION 'RideCheck event not found' USING errcode = 'P0002';
  END IF;

  IF v_uid = v_driver_id THEN
    v_role := 'driver'::public.party_role;
  ELSIF v_uid = v_rider_id THEN
    v_role := 'rider'::public.party_role;
  ELSE
    RAISE EXCEPTION 'Forbidden' USING errcode = '42501';
  END IF;

  -- If the event is already closed, treat as idempotent.
  IF v_status <> 'open'::public.ridecheck_event_status THEN
    ride_id := v_ride_id;
    event_id := p_event_id;
    kind := v_kind;
    status := v_status;
    already_closed := true;
    role := v_role;
    RETURN NEXT;
    RETURN;
  END IF;

  v_note := nullif(left(coalesce(p_note, ''), 500), '');

  INSERT INTO public.ridecheck_responses (event_id, ride_id, user_id, role, response, note)
  VALUES (p_event_id, v_ride_id, v_uid, v_role, p_response, v_note)
  ON CONFLICT (event_id, user_id) DO UPDATE
    SET response = excluded.response,
        note = excluded.note;

  UPDATE public.ridecheck_events
     SET status = CASE
                    WHEN p_response = 'need_help'::public.ridecheck_response
                      THEN 'escalated'::public.ridecheck_event_status
                    ELSE 'resolved'::public.ridecheck_event_status
                  END,
         updated_at = now(),
         resolved_at = now(),
         metadata = coalesce(metadata, '{}'::jsonb)
                   || jsonb_build_object('responded_by', v_role, 'response', p_response)
   WHERE id = p_event_id
     AND status = 'open'::public.ridecheck_event_status
   RETURNING status INTO v_status;

  ride_id := v_ride_id;
  event_id := p_event_id;
  kind := v_kind;
  status := v_status;
  already_closed := false;
  role := v_role;
  RETURN NEXT;
END;
$$;
-- -------------------------------------------------------------------
-- 3) Settlement RPCs: disambiguate RETURN TABLE column names (id/status)
-- -------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_settlement_approve_payment_request_v1(p_request_id uuid, p_admin_note text DEFAULT NULL::text, p_reference_override text DEFAULT NULL::text) RETURNS TABLE(id uuid, status text, processed_at timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE
  v_req public.settlement_payment_requests;
  v_idem text;
BEGIN
  IF NOT (SELECT is_admin()) THEN
    RAISE EXCEPTION 'admin_only';
  END IF;

  SELECT * INTO v_req
  FROM public.settlement_payment_requests r
  WHERE r.id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'request_not_found';
  END IF;

  IF v_req.status <> 'requested'::public.settlement_request_status THEN
    RETURN QUERY SELECT v_req.id, v_req.status::text, v_req.processed_at;
    RETURN;
  END IF;

  v_idem := 'approve_payment_request:' || v_req.id::text;

  PERFORM public.admin_settlement_record_receipt_v1(
    v_req.party_type,
    v_req.party_id,
    v_req.amount_iqd,
    v_req.method,
    COALESCE(NULLIF(trim(p_reference_override), ''), v_req.reference),
    v_idem
  );

  UPDATE public.settlement_payment_requests r
  SET status = 'approved'::public.settlement_request_status,
      processed_by = auth.uid(),
      processed_at = now(),
      admin_note = NULLIF(trim(COALESCE(p_admin_note, '')), '')
  WHERE r.id = v_req.id
  RETURNING * INTO v_req;

  RETURN QUERY SELECT v_req.id, v_req.status::text, v_req.processed_at;
END;
$$;
CREATE OR REPLACE FUNCTION public.admin_settlement_approve_payout_request_v1(p_request_id uuid, p_admin_note text DEFAULT NULL::text, p_reference_override text DEFAULT NULL::text) RETURNS TABLE(id uuid, status text, processed_at timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE
  v_req public.settlement_payout_requests;
  v_idem text;
  v_bal bigint;
BEGIN
  IF NOT (SELECT is_admin()) THEN
    RAISE EXCEPTION 'admin_only';
  END IF;

  SELECT * INTO v_req
  FROM public.settlement_payout_requests r
  WHERE r.id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'request_not_found';
  END IF;

  IF v_req.status <> 'requested'::public.settlement_request_status THEN
    RETURN QUERY SELECT v_req.id, v_req.status::text, v_req.processed_at;
    RETURN;
  END IF;

  SELECT COALESCE(sa.balance_iqd, 0) INTO v_bal
  FROM public.settlement_accounts sa
  WHERE sa.party_type = v_req.party_type
    AND sa.party_id = v_req.party_id
    AND sa.currency = 'IQD'
  LIMIT 1;

  IF v_bal < v_req.amount_iqd THEN
    RAISE EXCEPTION 'insufficient_balance';
  END IF;

  v_idem := 'approve_payout_request:' || v_req.id::text;

  PERFORM public.admin_settlement_record_payout_v1(
    v_req.party_type,
    v_req.party_id,
    v_req.amount_iqd,
    v_req.method,
    COALESCE(NULLIF(trim(p_reference_override), ''), v_req.reference),
    v_idem
  );

  UPDATE public.settlement_payout_requests r
  SET status = 'approved'::public.settlement_request_status,
      processed_by = auth.uid(),
      processed_at = now(),
      admin_note = NULLIF(trim(COALESCE(p_admin_note, '')), '')
  WHERE r.id = v_req.id
  RETURNING * INTO v_req;

  RETURN QUERY SELECT v_req.id, v_req.status::text, v_req.processed_at;
END;
$$;
CREATE OR REPLACE FUNCTION public.admin_settlement_reject_payment_request_v1(p_request_id uuid, p_admin_note text DEFAULT NULL::text) RETURNS TABLE(id uuid, status text, processed_at timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE
  v_req public.settlement_payment_requests;
BEGIN
  IF NOT (SELECT is_admin()) THEN
    RAISE EXCEPTION 'admin_only';
  END IF;

  UPDATE public.settlement_payment_requests r
  SET status = 'rejected'::public.settlement_request_status,
      processed_by = auth.uid(),
      processed_at = now(),
      admin_note = NULLIF(trim(COALESCE(p_admin_note, '')), '')
  WHERE r.id = p_request_id
    AND r.status = 'requested'::public.settlement_request_status
  RETURNING * INTO v_req;

  IF NOT FOUND THEN
    SELECT * INTO v_req FROM public.settlement_payment_requests r WHERE r.id = p_request_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'request_not_found';
    END IF;
  END IF;

  RETURN QUERY SELECT v_req.id, v_req.status::text, v_req.processed_at;
END;
$$;
CREATE OR REPLACE FUNCTION public.admin_settlement_reject_payout_request_v1(p_request_id uuid, p_admin_note text DEFAULT NULL::text) RETURNS TABLE(id uuid, status text, processed_at timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE
  v_req public.settlement_payout_requests;
BEGIN
  IF NOT (SELECT is_admin()) THEN
    RAISE EXCEPTION 'admin_only';
  END IF;

  UPDATE public.settlement_payout_requests r
  SET status = 'rejected'::public.settlement_request_status,
      processed_by = auth.uid(),
      processed_at = now(),
      admin_note = NULLIF(trim(COALESCE(p_admin_note, '')), '')
  WHERE r.id = p_request_id
    AND r.status = 'requested'::public.settlement_request_status
  RETURNING * INTO v_req;

  IF NOT FOUND THEN
    SELECT * INTO v_req FROM public.settlement_payout_requests r WHERE r.id = p_request_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'request_not_found';
    END IF;
  END IF;

  RETURN QUERY SELECT v_req.id, v_req.status::text, v_req.processed_at;
END;
$$;
CREATE OR REPLACE FUNCTION public.admin_settlement_record_receipt_v2(p_party_type public.settlement_party_type, p_party_id uuid, p_amount_iqd integer, p_method text, p_reference text, p_agent_id uuid, p_day date, p_idempotency_key text) RETURNS TABLE(id uuid, receipt_no text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_is_admin boolean := COALESCE((SELECT public.is_admin()), false);
  v_id uuid;
  v_receipt_no text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF p_amount_iqd IS NULL OR p_amount_iqd <= 0 THEN
    RAISE EXCEPTION 'invalid_amount';
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    RETURN QUERY
      SELECT sr.id, sr.receipt_no
      FROM public.settlement_receipts sr
      WHERE sr.idempotency_key = p_idempotency_key
      LIMIT 1;
    IF FOUND THEN
      RETURN;
    END IF;
  END IF;

  IF p_agent_id IS NOT NULL THEN
    v_receipt_no := public.admin_cash_agent_next_doc_no_v1(p_agent_id, 'receipt', COALESCE(p_day, current_date));
  END IF;

  INSERT INTO public.settlement_receipts AS sr (party_type, party_id, amount_iqd, method, reference, received_by, agent_id, receipt_no, idempotency_key)
  VALUES (p_party_type, p_party_id, p_amount_iqd, COALESCE(p_method, 'cash'), NULLIF(btrim(p_reference), ''), v_uid, p_agent_id, v_receipt_no, p_idempotency_key)
  RETURNING sr.id INTO v_id;

  PERFORM public.settlement_post_entry(
    p_party_type,
    p_party_id,
    p_amount_iqd::bigint,
    'admin_receipt',
    'settlement_receipt',
    v_id,
    CASE WHEN p_idempotency_key IS NULL THEN NULL ELSE 'receipt_entry:' || p_idempotency_key END
  );

  RETURN QUERY SELECT v_id, v_receipt_no;
END;
$$;
CREATE OR REPLACE FUNCTION public.admin_settlement_record_payout_v2(p_party_type public.settlement_party_type, p_party_id uuid, p_amount_iqd integer, p_method text, p_reference text, p_agent_id uuid, p_day date, p_idempotency_key text) RETURNS TABLE(id uuid, payout_no text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_is_admin boolean := COALESCE((SELECT public.is_admin()), false);
  v_id uuid;
  v_payout_no text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF p_amount_iqd IS NULL OR p_amount_iqd <= 0 THEN
    RAISE EXCEPTION 'invalid_amount';
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    RETURN QUERY
      SELECT sp.id, sp.payout_no
      FROM public.settlement_payouts sp
      WHERE sp.idempotency_key = p_idempotency_key
      LIMIT 1;
    IF FOUND THEN
      RETURN;
    END IF;
  END IF;

  IF p_agent_id IS NOT NULL THEN
    v_payout_no := public.admin_cash_agent_next_doc_no_v1(p_agent_id, 'payout', COALESCE(p_day, current_date));
  END IF;

  INSERT INTO public.settlement_payouts AS sp (party_type, party_id, amount_iqd, method, reference, paid_by, agent_id, payout_no, idempotency_key)
  VALUES (p_party_type, p_party_id, p_amount_iqd, COALESCE(p_method, 'cash'), NULLIF(btrim(p_reference), ''), v_uid, p_agent_id, v_payout_no, p_idempotency_key)
  RETURNING sp.id INTO v_id;

  PERFORM public.settlement_post_entry(
    p_party_type,
    p_party_id,
    -p_amount_iqd::bigint,
    'admin_payout',
    'settlement_payout',
    v_id,
    CASE WHEN p_idempotency_key IS NULL THEN NULL ELSE 'payout_entry:' || p_idempotency_key END
  );

  RETURN QUERY SELECT v_id, v_payout_no;
END;
$$;
-- -------------------------------------------------------------------
-- 4) Ride matching: fix ambiguous id reference (RETURNS TABLE(id ...))
-- -------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dispatch_match_ride(p_request_id uuid, p_rider_id uuid, p_radius_m numeric DEFAULT 5000, p_limit_n integer DEFAULT 20, p_match_ttl_seconds integer DEFAULT 120, p_stale_after_seconds integer DEFAULT 120) RETURNS TABLE(id uuid, status public.ride_request_status, assigned_driver_id uuid, match_deadline timestamp with time zone, match_attempts integer, matched_at timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'extensions'
    AS $$
DECLARE
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
BEGIN
  v_stale_after := greatest(30, coalesce(p_stale_after_seconds, 120));

  PERFORM public.expire_matched_ride_requests_v1(200);

  SELECT * INTO rr
  FROM public.ride_requests AS req
  WHERE req.id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ride_request_not_found';
  END IF;

  IF rr.rider_id <> p_rider_id THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF rr.status = 'accepted' THEN
    RETURN QUERY SELECT rr.id, rr.status, rr.assigned_driver_id, rr.match_deadline, rr.match_attempts, rr.matched_at;
    RETURN;
  END IF;

  IF rr.status = 'matched' AND rr.match_deadline IS NOT NULL AND rr.match_deadline <= now() THEN
    PERFORM public.transition_driver(rr.assigned_driver_id, 'available'::public.driver_status, NULL, 'match_expired');

    UPDATE public.ride_requests AS req
      SET status = 'requested',
          assigned_driver_id = NULL,
          match_deadline = NULL
    WHERE req.id = rr.id AND req.status = 'matched';

    rr.status := 'requested';
    rr.assigned_driver_id := NULL;
    rr.match_deadline := NULL;
  END IF;

  IF rr.status <> 'requested' THEN
    RETURN QUERY SELECT rr.id, rr.status, rr.assigned_driver_id, rr.match_deadline, rr.match_attempts, rr.matched_at;
    RETURN;
  END IF;

  SELECT capacity_min INTO v_req_capacity
  FROM public.ride_products
  WHERE code = rr.product_code;

  v_req_capacity := coalesce(v_req_capacity, 4);

  v_quote := coalesce(rr.quote_amount_iqd, 0)::bigint;
  IF v_quote <= 0 THEN
    RAISE EXCEPTION 'invalid_quote';
  END IF;

  v_pay := coalesce(rr.payment_method, 'wallet'::public.ride_payment_method);
  IF v_pay <> 'cash'::public.ride_payment_method THEN
    SELECT coalesce(w.balance_iqd, 0), coalesce(w.held_iqd, 0)
      INTO v_balance, v_held
    FROM public.wallet_accounts w
    WHERE w.user_id = rr.rider_id;

    v_available := coalesce(v_balance, 0) - coalesce(v_held, 0);

    IF v_available < v_quote THEN
      RAISE EXCEPTION 'insufficient_wallet_balance';
    END IF;
  END IF;

  -- Check if women preferences requested
  v_women_pref_requested := coalesce(rr.women_preferences_requested, false);
  IF v_women_pref_requested THEN
    v_women_pref_start_ms := extract(epoch from clock_timestamp()) * 1000;
  END IF;

  -- Main matching loop (up to 3 attempts)
  FOR i IN 1..3 LOOP
    WITH pickup AS (
      SELECT rr.pickup_loc AS pickup
    ), candidates AS (
      SELECT d.id AS driver_id
      FROM public.drivers d
      CROSS JOIN pickup
      JOIN public.driver_locations dl
        ON dl.driver_id = d.id
       AND dl.updated_at >= now() - make_interval(secs => v_stale_after)
      LEFT JOIN public.settlement_accounts sa
        ON sa.party_type = 'driver'::public.settlement_party_type
       AND sa.party_id = d.id
       AND sa.currency = 'IQD'
      -- Women preferences filter (when requested and not yet in fallback mode)
      LEFT JOIN public.safety_preferences sp
        ON sp.user_id = d.id
      WHERE d.status = 'available'
        AND NOT (d.id = ANY(tried))
        AND extensions.st_dwithin(dl.loc, pickup.pickup, p_radius_m)
        AND EXISTS (
          SELECT 1 FROM public.driver_vehicles v
          WHERE v.driver_id = d.id
            AND coalesce(v.is_active, true) = true
            AND coalesce(v.capacity, 4) >= v_req_capacity
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.rides r
          WHERE r.driver_id = d.id
            AND r.status IN ('assigned','arrived','in_progress')
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.ride_requests rr2
          WHERE rr2.assigned_driver_id = d.id
            AND rr2.status = 'matched'
            AND (rr2.match_deadline IS NULL OR rr2.match_deadline > now())
        )
        AND (
          v_pay <> 'cash'::public.ride_payment_method
          OR (d.cash_enabled = true AND coalesce(sa.balance_iqd, 0) >= (-d.cash_exposure_limit_iqd)::bigint)
        )
        -- Women preferences: filter for eligible drivers if requested and not in fallback
        AND (
          NOT v_women_pref_requested
          OR v_women_pref_fallback
          OR (
            sp.women_preferences_driver_opt_in = true
            AND sp.women_preferences_eligible = true
          )
        )
      ORDER BY dl.loc <-> pickup.pickup
      LIMIT p_limit_n
    ), locked AS (
      SELECT c.driver_id
      FROM candidates c
      JOIN public.drivers d ON d.id = c.driver_id
      WHERE d.status = 'available'
      FOR UPDATE OF d SKIP LOCKED
      LIMIT 1
    )
    SELECT driver_id INTO candidate FROM locked;

    -- If no candidate found and women preferences active, try fallback
    IF candidate IS NULL AND v_women_pref_requested AND NOT v_women_pref_fallback THEN
      v_women_pref_attempts := v_women_pref_attempts + 1;
      IF v_women_pref_attempts >= v_women_pref_max_attempts THEN
        v_women_pref_fallback := true;
        CONTINUE;  -- retry with fallback
      END IF;
    END IF;

    EXIT WHEN candidate IS NULL;

    BEGIN
      PERFORM public.transition_driver(candidate, 'reserved'::public.driver_status, NULL, 'matching');
    EXCEPTION WHEN OTHERS THEN
      tried := array_append(tried, candidate);
      CONTINUE;
    END;

    -- Track if this was a women preferences match
    IF v_women_pref_requested AND NOT v_women_pref_fallback THEN
      v_women_pref_fulfilled := true;
    END IF;

    BEGIN
      UPDATE public.ride_requests AS req
        SET status = 'matched',
            assigned_driver_id = candidate,
            match_attempts = rr.match_attempts + 1,
            match_deadline = now() + make_interval(secs => p_match_ttl_seconds),
            women_preferences_fulfilled = v_women_pref_fulfilled,
            women_preferences_fallback_used = v_women_pref_fallback,
            women_preferences_match_attempt_ms = CASE
              WHEN v_women_pref_requested THEN
                (extract(epoch from clock_timestamp()) * 1000 - v_women_pref_start_ms)::integer
              ELSE NULL
            END
      WHERE req.id = rr.id
        AND req.status = 'requested'
        AND req.assigned_driver_id IS NULL
      RETURNING req.id, req.status, req.assigned_driver_id, req.match_deadline, req.match_attempts, req.matched_at
        INTO up;

      IF FOUND THEN
        RETURN QUERY SELECT up.id, up.status, up.assigned_driver_id, up.match_deadline, up.match_attempts, up.matched_at;
        RETURN;
      END IF;
    EXCEPTION
      WHEN unique_violation THEN
        PERFORM public.transition_driver(candidate, 'available'::public.driver_status, NULL, 'match_conflict');
      WHEN OTHERS THEN
        PERFORM public.transition_driver(candidate, 'available'::public.driver_status, NULL, 'match_error');
        RAISE;
    END;

    tried := array_append(tried, candidate);
    PERFORM public.transition_driver(candidate, 'available'::public.driver_status, NULL, 'match_failed');
  END LOOP;

  RETURN QUERY SELECT rr.id, rr.status, rr.assigned_driver_id, rr.match_deadline, rr.match_attempts, rr.matched_at;
END;
$$;
