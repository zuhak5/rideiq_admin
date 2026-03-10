CREATE OR REPLACE FUNCTION public.ride_request_create_user_v1(
  p_pickup_lat double precision,
  p_pickup_lng double precision,
  p_dropoff_lat double precision,
  p_dropoff_lng double precision,
  p_pickup_address text DEFAULT NULL::text,
  p_dropoff_address text DEFAULT NULL::text,
  p_product_code text DEFAULT 'standard'::text,
  p_preferences jsonb DEFAULT '{}'::jsonb,
  p_payment_method text DEFAULT 'wallet'::text,
  p_fare_quote_id uuid DEFAULT NULL::uuid,
  p_request_id uuid DEFAULT NULL::uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $$
DECLARE
  v_uid uuid;
  v_product text;
  v_payment_method text;
  v_quote public.fare_quotes;
  v_area_id uuid;
  v_request public.ride_requests;
  v_existing public.ride_requests;
  v_pending_count integer;
  v_coord_tolerance double precision := 0.00001;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  v_product := lower(left(coalesce(p_product_code, 'standard'), 32));
  IF NOT EXISTS (
    SELECT 1
    FROM public.ride_products rp
    WHERE rp.code = v_product
      AND rp.is_active
  ) THEN
    RAISE EXCEPTION 'invalid_product';
  END IF;

  v_payment_method := lower(trim(coalesce(p_payment_method, 'wallet')));
  IF v_payment_method NOT IN ('wallet', 'cash') THEN
    RAISE EXCEPTION 'invalid_payment_method';
  END IF;

  IF p_request_id IS NOT NULL THEN
    SELECT * INTO v_existing
    FROM public.ride_requests
    WHERE id = p_request_id;

    IF FOUND THEN
      IF v_existing.rider_id <> v_uid THEN
        RAISE EXCEPTION 'forbidden';
      END IF;

      RETURN jsonb_build_object(
        'ride_request', to_jsonb(v_existing),
        'already_exists', true
      );
    END IF;
  END IF;

  IF p_fare_quote_id IS NULL THEN
    RAISE EXCEPTION 'missing_fare_quote';
  END IF;

  SELECT * INTO v_quote
  FROM public.fare_quotes
  WHERE id = p_fare_quote_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_fare_quote';
  END IF;

  IF v_quote.rider_id <> v_uid THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF v_quote.product_code <> v_product THEN
    RAISE EXCEPTION 'invalid_fare_quote';
  END IF;

  IF abs(v_quote.pickup_lat - p_pickup_lat) > v_coord_tolerance
     OR abs(v_quote.pickup_lng - p_pickup_lng) > v_coord_tolerance
     OR abs(v_quote.dropoff_lat - p_dropoff_lat) > v_coord_tolerance
     OR abs(v_quote.dropoff_lng - p_dropoff_lng) > v_coord_tolerance
  THEN
    RAISE EXCEPTION 'invalid_fare_quote';
  END IF;

  v_area_id := v_quote.service_area_id;
  IF v_area_id IS NULL THEN
    SELECT sa.id INTO v_area_id
    FROM public.resolve_service_area(p_pickup_lat, p_pickup_lng) sa;
  END IF;

  IF v_area_id IS NULL
     OR NOT EXISTS (
       SELECT 1
       FROM public.service_areas sa
       WHERE sa.id = v_area_id
         AND sa.is_active
     )
  THEN
    RAISE EXCEPTION 'outside_service_area';
  END IF;

  SELECT count(*) INTO v_pending_count
  FROM public.ride_requests
  WHERE rider_id = v_uid
    AND status IN (
      'requested'::public.ride_request_status,
      'matched'::public.ride_request_status
    );

  IF v_pending_count >= 3 THEN
    RAISE EXCEPTION 'too_many_pending';
  END IF;

  BEGIN
    INSERT INTO public.ride_requests(
      id,
      rider_id,
      pickup_lat,
      pickup_lng,
      dropoff_lat,
      dropoff_lng,
      pickup_address,
      dropoff_address,
      product_code,
      preferences,
      service_area_id,
      fare_quote_id,
      quote_amount_iqd,
      currency,
      payment_method,
      payment_status
    ) VALUES (
      coalesce(p_request_id, gen_random_uuid()),
      v_uid,
      p_pickup_lat,
      p_pickup_lng,
      p_dropoff_lat,
      p_dropoff_lng,
      p_pickup_address,
      p_dropoff_address,
      v_product,
      coalesce(p_preferences, '{}'::jsonb),
      v_area_id,
      v_quote.id,
      v_quote.total_iqd,
      v_quote.currency,
      v_payment_method::public.ride_payment_method,
      'unpaid'::public.ride_payment_status
    )
    RETURNING * INTO v_request;
  EXCEPTION
    WHEN unique_violation THEN
      IF p_request_id IS NULL THEN
        RAISE;
      END IF;

      SELECT * INTO v_existing
      FROM public.ride_requests
      WHERE id = p_request_id;

      IF NOT FOUND THEN
        RAISE;
      END IF;

      IF v_existing.rider_id <> v_uid THEN
        RAISE EXCEPTION 'forbidden';
      END IF;

      RETURN jsonb_build_object(
        'ride_request', to_jsonb(v_existing),
        'already_exists', true
      );
  END;

  RETURN jsonb_build_object(
    'ride_request', to_jsonb(v_request),
    'already_exists', false
  );
END;
$$;

COMMENT ON FUNCTION public.ride_request_create_user_v1(
  double precision,
  double precision,
  double precision,
  double precision,
  text,
  text,
  text,
  jsonb,
  text,
  uuid,
  uuid
) IS 'Creates a rider-owned immediate ride request with fare-quote ownership checks, wallet/cash payment validation, and optional idempotency.';

REVOKE ALL ON FUNCTION public.ride_request_create_user_v1(
  double precision,
  double precision,
  double precision,
  double precision,
  text,
  text,
  text,
  jsonb,
  text,
  uuid,
  uuid
) FROM PUBLIC;

GRANT ALL ON FUNCTION public.ride_request_create_user_v1(
  double precision,
  double precision,
  double precision,
  double precision,
  text,
  text,
  text,
  jsonb,
  text,
  uuid,
  uuid
) TO service_role;

GRANT ALL ON FUNCTION public.ride_request_create_user_v1(
  double precision,
  double precision,
  double precision,
  double precision,
  text,
  text,
  text,
  jsonb,
  text,
  uuid,
  uuid
) TO authenticated;
