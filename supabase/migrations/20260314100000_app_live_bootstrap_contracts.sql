CREATE OR REPLACE FUNCTION public.rider_home_bootstrap_v1()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $$
DECLARE
  v_uid uuid;
  v_pickup_base text;
  v_wallet_balance bigint := 0;
  v_saved_places jsonb := '[]'::jsonb;
  v_quick_destinations jsonb := '[]'::jsonb;
  v_offers jsonb := '[]'::jsonb;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT
    coalesce(nullif(trim(ca.label), ''), nullif(trim(ca.address_line1), ''), 'Current location')
  INTO v_pickup_base
  FROM public.customer_addresses ca
  WHERE ca.user_id = v_uid
  ORDER BY ca.is_default DESC, ca.updated_at DESC, ca.created_at DESC
  LIMIT 1;

  SELECT coalesce(wa.balance_iqd, 0)
  INTO v_wallet_balance
  FROM public.wallet_accounts wa
  WHERE wa.user_id = v_uid;

  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', saved_place.id,
        'title', saved_place.title,
        'subtitle', saved_place.subtitle,
        'icon', saved_place.icon
      )
      ORDER BY saved_place.sort_order
    ),
    '[]'::jsonb
  )
  INTO v_saved_places
  FROM (
    SELECT
      ca.id,
      coalesce(nullif(trim(ca.label), ''), 'Saved place') AS title,
      concat_ws(', ', nullif(trim(ca.area), ''), nullif(trim(ca.address_line1), '')) AS subtitle,
      CASE
        WHEN lower(coalesce(ca.label, '')) LIKE '%home%' THEN 'home'
        WHEN lower(coalesce(ca.label, '')) LIKE '%work%' THEN 'work'
        ELSE 'place'
      END AS icon,
      row_number() OVER (ORDER BY ca.is_default DESC, ca.updated_at DESC, ca.created_at DESC) AS sort_order
    FROM public.customer_addresses ca
    WHERE ca.user_id = v_uid
    ORDER BY ca.is_default DESC, ca.updated_at DESC, ca.created_at DESC
    LIMIT 4
  ) AS saved_place;

  SELECT coalesce(
    jsonb_agg(to_jsonb(quick_destination.label) ORDER BY quick_destination.sort_at DESC),
    '[]'::jsonb
  )
  INTO v_quick_destinations
  FROM (
    SELECT *
    FROM (
      SELECT
        nullif(trim(rr.dropoff_address), '') AS label,
        coalesce(rr.updated_at, rr.created_at) AS sort_at,
        row_number() OVER (
          PARTITION BY nullif(trim(rr.dropoff_address), '')
          ORDER BY coalesce(rr.updated_at, rr.created_at) DESC
        ) AS dedupe_rank
      FROM public.ride_requests rr
      WHERE rr.rider_id = v_uid

      UNION ALL

      SELECT
        coalesce(nullif(trim(ca.label), ''), nullif(trim(ca.address_line1), '')) AS label,
        coalesce(ca.updated_at, ca.created_at) AS sort_at,
        row_number() OVER (
          PARTITION BY coalesce(nullif(trim(ca.label), ''), nullif(trim(ca.address_line1), ''))
          ORDER BY coalesce(ca.updated_at, ca.created_at) DESC
        ) AS dedupe_rank
      FROM public.customer_addresses ca
      WHERE ca.user_id = v_uid
    ) AS labels
    WHERE labels.label IS NOT NULL
      AND labels.label <> ''
      AND labels.dedupe_rank = 1
    ORDER BY labels.sort_at DESC
    LIMIT 6
  ) AS quick_destination;

  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', promo.id,
        'title', promo.title,
        'subtitle', promo.subtitle,
        'badge_text', promo.badge_text,
        'image_type', promo.image_type,
        'is_new', promo.is_new
      )
      ORDER BY promo.sort_at DESC
    ),
    '[]'::jsonb
  )
  INTO v_offers
  FROM (
    SELECT
      mp.id,
      m.business_name AS title,
      coalesce(nullif(trim(mp.category), ''), nullif(trim(m.business_type), ''), 'Limited time offer') AS subtitle,
      CASE
        WHEN mp.discount_type = 'percent'::public.merchant_promotion_discount_type
          THEN regexp_replace(mp.value::text, '\.0+$', '') || '% OFF'
        ELSE 'IQD ' || regexp_replace(mp.value::text, '\.0+$', '')
      END AS badge_text,
      CASE
        WHEN lower(coalesce(m.business_type, '')) LIKE '%pharm%' THEN 'pharmacy'
        ELSE 'burger'
      END AS image_type,
      mp.created_at >= now() - interval '7 days' AS is_new,
      coalesce(mp.starts_at, mp.created_at) AS sort_at
    FROM public.merchant_promotions mp
    JOIN public.merchants m
      ON m.id = mp.merchant_id
    WHERE m.status = 'approved'::public.merchant_status
      AND mp.is_active
      AND coalesce(mp.starts_at, now()) <= now()
      AND coalesce(mp.ends_at, now() + interval '365 days') >= now()
    ORDER BY coalesce(mp.starts_at, mp.created_at) DESC
    LIMIT 6
  ) AS promo;

  RETURN jsonb_build_object(
    'pickup_label', 'Pickup: ' || coalesce(v_pickup_base, 'Current location'),
    'destination_hint', 'Where to?',
    'wallet_balance_iqd', v_wallet_balance,
    'saved_places', v_saved_places,
    'quick_destinations', v_quick_destinations,
    'offers', v_offers
  );
END;
$$;

COMMENT ON FUNCTION public.rider_home_bootstrap_v1()
IS 'Returns the authenticated rider home shell bootstrap payload with wallet, saved places, quick destinations, and approved merchant promotions.';

REVOKE ALL ON FUNCTION public.rider_home_bootstrap_v1() FROM PUBLIC;
GRANT ALL ON FUNCTION public.rider_home_bootstrap_v1() TO authenticated;
GRANT ALL ON FUNCTION public.rider_home_bootstrap_v1() TO service_role;

CREATE OR REPLACE FUNCTION public.rider_activity_list_my_v1(
  p_limit integer DEFAULT 20,
  p_offset integer DEFAULT 0
)
RETURNS TABLE(
  id uuid,
  occurred_at timestamp with time zone,
  pickup_label text,
  dropoff_label text,
  driver_label text,
  car_label text,
  fare_iqd integer,
  rating_avg numeric,
  status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $$
DECLARE
  v_uid uuid;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  RETURN QUERY
  WITH completed_entries AS (
    SELECT
      r.id,
      coalesce(r.completed_at, r.updated_at, r.created_at) AS occurred_at,
      coalesce(nullif(trim(rr.pickup_address), ''), 'Pickup') AS pickup_label,
      coalesce(nullif(trim(rr.dropoff_address), ''), 'Dropoff') AS dropoff_label,
      coalesce(nullif(trim(pp.display_name), ''), nullif(trim(p.display_name), ''), 'Driver') AS driver_label,
      nullif(trim(concat_ws(' ', dv.make, dv.model, dv.color, dv.plate_number)), '') AS car_label,
      coalesce(r.fare_amount_iqd, rr.quote_amount_iqd, 0) AS fare_iqd,
      d.rating_avg,
      'completed'::text AS status
    FROM public.rides r
    JOIN public.ride_requests rr
      ON rr.id = r.request_id
    LEFT JOIN public.drivers d
      ON d.id = r.driver_id
    LEFT JOIN public.public_profiles pp
      ON pp.id = r.driver_id
    LEFT JOIN public.profiles p
      ON p.id = r.driver_id
    LEFT JOIN LATERAL (
      SELECT make, model, color, plate_number
      FROM public.driver_vehicles dv
      WHERE dv.driver_id = r.driver_id
        AND dv.is_active
      ORDER BY dv.updated_at DESC, dv.created_at DESC
      LIMIT 1
    ) AS dv ON true
    WHERE rr.rider_id = v_uid
  ),
  cancelled_entries AS (
    SELECT
      rr.id,
      coalesce(rr.cancelled_at, rr.updated_at, rr.created_at) AS occurred_at,
      coalesce(nullif(trim(rr.pickup_address), ''), 'Pickup') AS pickup_label,
      coalesce(nullif(trim(rr.dropoff_address), ''), 'Cancelled trip') AS dropoff_label,
      ''::text AS driver_label,
      ''::text AS car_label,
      coalesce(rr.quote_amount_iqd, 0) AS fare_iqd,
      NULL::numeric AS rating_avg,
      'cancelled'::text AS status
    FROM public.ride_requests rr
    WHERE rr.rider_id = v_uid
      AND rr.status = 'cancelled'::public.ride_request_status
      AND NOT EXISTS (
        SELECT 1
        FROM public.rides r
        WHERE r.request_id = rr.id
      )
  ),
  combined_entries AS (
    SELECT * FROM completed_entries
    UNION ALL
    SELECT * FROM cancelled_entries
  )
  SELECT
    combined_entries.id,
    combined_entries.occurred_at,
    combined_entries.pickup_label,
    combined_entries.dropoff_label,
    combined_entries.driver_label,
    combined_entries.car_label,
    combined_entries.fare_iqd,
    combined_entries.rating_avg,
    combined_entries.status
  FROM combined_entries
  ORDER BY combined_entries.occurred_at DESC, combined_entries.id DESC
  LIMIT greatest(coalesce(p_limit, 20), 0)
  OFFSET greatest(coalesce(p_offset, 0), 0);
END;
$$;

COMMENT ON FUNCTION public.rider_activity_list_my_v1(integer, integer)
IS 'Returns the authenticated rider activity history, including completed rides and cancelled requests.';

REVOKE ALL ON FUNCTION public.rider_activity_list_my_v1(integer, integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rider_activity_list_my_v1(integer, integer) TO authenticated;
GRANT ALL ON FUNCTION public.rider_activity_list_my_v1(integer, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.driver_dashboard_bootstrap_v1()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $$
DECLARE
  v_uid uuid;
  v_driver public.drivers;
  v_profile public.profiles;
  v_today_earnings bigint := 0;
  v_weekly_earnings bigint := 0;
  v_monthly_earnings bigint := 0;
  v_daily_trips integer := 0;
  v_weekly_trips integer := 0;
  v_monthly_trips integer := 0;
  v_total_requests integer := 0;
  v_accepted_requests integer := 0;
  v_cancelled_rides integer := 0;
  v_wallet_balance bigint := 0;
  v_pending_payout_iqd bigint := 0;
  v_hotspot jsonb := '{}'::jsonb;
  v_wallet_payouts jsonb := '[]'::jsonb;
  v_recent_trips jsonb := '[]'::jsonb;
  v_request_queue jsonb := '[]'::jsonb;
  v_trip_history jsonb := '[]'::jsonb;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT * INTO v_driver
  FROM public.drivers d
  WHERE d.id = v_uid;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_a_driver';
  END IF;

  SELECT * INTO v_profile
  FROM public.profiles p
  WHERE p.id = v_uid;

  SELECT
    coalesce(sum(r.fare_amount_iqd), 0) FILTER (WHERE r.completed_at >= date_trunc('day', now())),
    coalesce(sum(r.fare_amount_iqd), 0) FILTER (WHERE r.completed_at >= now() - interval '7 days'),
    coalesce(sum(r.fare_amount_iqd), 0) FILTER (WHERE r.completed_at >= date_trunc('month', now())),
    count(*) FILTER (WHERE r.completed_at >= date_trunc('day', now())),
    count(*) FILTER (WHERE r.completed_at >= now() - interval '7 days'),
    count(*) FILTER (WHERE r.completed_at >= date_trunc('month', now())),
    count(*) FILTER (WHERE rr.assigned_driver_id = v_uid),
    count(*) FILTER (WHERE rr.assigned_driver_id = v_uid AND rr.accepted_at IS NOT NULL),
    count(*) FILTER (WHERE r.status = 'canceled'::public.ride_status)
  INTO
    v_today_earnings,
    v_weekly_earnings,
    v_monthly_earnings,
    v_daily_trips,
    v_weekly_trips,
    v_monthly_trips,
    v_total_requests,
    v_accepted_requests,
    v_cancelled_rides
  FROM public.ride_requests rr
  LEFT JOIN public.rides r
    ON r.request_id = rr.id
   AND r.driver_id = v_uid
  WHERE rr.assigned_driver_id = v_uid
     OR r.driver_id = v_uid;

  SELECT coalesce(sa.balance_iqd, 0)
  INTO v_wallet_balance
  FROM public.settlement_accounts sa
  WHERE sa.party_type = 'driver'::public.settlement_party_type
    AND sa.party_id = v_uid
  LIMIT 1;

  SELECT coalesce(sum(spr.amount_iqd), 0)
  INTO v_pending_payout_iqd
  FROM public.settlement_payout_requests spr
  WHERE spr.party_type = 'driver'::public.settlement_party_type
    AND spr.party_id = v_uid
    AND spr.status IN ('requested'::public.settlement_request_status, 'approved'::public.settlement_request_status);

  SELECT coalesce(
    jsonb_build_object(
      'title', hotspot.zone_name,
      'hint', concat('Demand level ', hotspot.demand_level, ' with ', coalesce(hotspot.nearby_driver_count, 0), ' nearby drivers'),
      'distance_km', round(hotspot.distance_km::numeric, 1),
      'eta_minutes', greatest(1, ceil(hotspot.distance_km / 0.55)::integer),
      'boost_per_trip_iqd', greatest((hotspot.demand_level - 1) * 1000, 0),
      'boost_percent', greatest((hotspot.demand_level - 1) * 10, 0)
    ),
    jsonb_build_object(
      'title', 'No hotspot available',
      'hint', 'Demand heatmaps will appear when dispatch data is available.',
      'distance_km', 0,
      'eta_minutes', 0,
      'boost_per_trip_iqd', 0,
      'boost_percent', 0
    )
  )
  INTO v_hotspot
  FROM (
    SELECT
      dh.zone_name,
      dh.demand_level,
      dh.nearby_driver_count,
      CASE
        WHEN dl.driver_id IS NULL THEN 0::double precision
        ELSE sqrt(
          power((dh.center_lat - dl.lat) * 111.0, 2) +
          power((dh.center_lng - dl.lng) * 92.0, 2)
        )
      END AS distance_km
    FROM public.demand_hotspots dh
    LEFT JOIN public.driver_locations dl
      ON dl.driver_id = v_uid
    WHERE dh.valid_until >= now()
    ORDER BY dh.demand_level DESC, distance_km ASC, dh.created_at DESC
    LIMIT 1
  ) AS hotspot;

  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', payout.id,
        'amount_iqd', payout.amount_iqd,
        'status', payout.status,
        'created_at', payout.requested_at,
        'reference', coalesce(payout.reference, 'PAYOUT-' || left(payout.id::text, 8))
      )
      ORDER BY payout.requested_at DESC
    ),
    '[]'::jsonb
  )
  INTO v_wallet_payouts
  FROM (
    SELECT spr.id, spr.amount_iqd, spr.status, spr.requested_at, spr.reference
    FROM public.settlement_payout_requests spr
    WHERE spr.party_type = 'driver'::public.settlement_party_type
      AND spr.party_id = v_uid
    ORDER BY spr.requested_at DESC
    LIMIT 20
  ) AS payout;

  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', trip.id,
        'route_label', trip.route_label,
        'amount_iqd', trip.amount_iqd,
        'occurred_at', trip.occurred_at,
        'distance_km', trip.distance_km,
        'status', trip.status
      )
      ORDER BY trip.occurred_at DESC
    ),
    '[]'::jsonb
  )
  INTO v_recent_trips
  FROM (
    SELECT
      r.id,
      concat_ws(' -> ',
        coalesce(nullif(trim(rr.pickup_address), ''), 'Pickup'),
        coalesce(nullif(trim(rr.dropoff_address), ''), 'Dropoff')
      ) AS route_label,
      coalesce(r.fare_amount_iqd, rr.quote_amount_iqd, 0) AS amount_iqd,
      coalesce(r.completed_at, r.updated_at, r.created_at) AS occurred_at,
      coalesce((fq.breakdown ->> 'distance_km')::double precision, 0) AS distance_km,
      r.status::text AS status
    FROM public.rides r
    JOIN public.ride_requests rr
      ON rr.id = r.request_id
    LEFT JOIN public.fare_quotes fq
      ON fq.id = rr.fare_quote_id
    WHERE r.driver_id = v_uid
    ORDER BY coalesce(r.completed_at, r.updated_at, r.created_at) DESC
    LIMIT 5
  ) AS trip;

  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', queue.id,
        'pickup_label', queue.pickup_label,
        'dropoff_label', queue.dropoff_label,
        'fare_iqd', queue.fare_iqd,
        'distance_km', queue.distance_km,
        'eta_minutes', queue.eta_minutes,
        'requested_at', queue.requested_at
      )
      ORDER BY queue.requested_at DESC
    ),
    '[]'::jsonb
  )
  INTO v_request_queue
  FROM (
    SELECT
      rr.id,
      coalesce(nullif(trim(rr.pickup_address), ''), 'Pickup') AS pickup_label,
      coalesce(nullif(trim(rr.dropoff_address), ''), 'Dropoff') AS dropoff_label,
      coalesce(rr.quote_amount_iqd, fq.total_iqd, 0) AS fare_iqd,
      coalesce((fq.breakdown ->> 'distance_km')::double precision, 0) AS distance_km,
      greatest(coalesce((fq.breakdown ->> 'duration_min')::integer, 1), 1) AS eta_minutes,
      rr.created_at AS requested_at
    FROM public.ride_requests rr
    LEFT JOIN public.fare_quotes fq
      ON fq.id = rr.fare_quote_id
    WHERE rr.assigned_driver_id = v_uid
      AND rr.status = 'matched'::public.ride_request_status
    ORDER BY rr.created_at DESC
    LIMIT 10
  ) AS queue;

  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', history.id,
        'pickup_label', history.pickup_label,
        'dropoff_label', history.dropoff_label,
        'fare_iqd', history.fare_iqd,
        'distance_km', history.distance_km,
        'occurred_at', history.occurred_at,
        'status', history.status
      )
      ORDER BY history.occurred_at DESC
    ),
    '[]'::jsonb
  )
  INTO v_trip_history
  FROM (
    SELECT
      r.id,
      coalesce(nullif(trim(rr.pickup_address), ''), 'Pickup') AS pickup_label,
      coalesce(nullif(trim(rr.dropoff_address), ''), 'Dropoff') AS dropoff_label,
      coalesce(r.fare_amount_iqd, rr.quote_amount_iqd, 0) AS fare_iqd,
      coalesce((fq.breakdown ->> 'distance_km')::double precision, 0) AS distance_km,
      coalesce(r.completed_at, r.updated_at, r.created_at) AS occurred_at,
      r.status::text AS status
    FROM public.rides r
    JOIN public.ride_requests rr
      ON rr.id = r.request_id
    LEFT JOIN public.fare_quotes fq
      ON fq.id = rr.fare_quote_id
    WHERE r.driver_id = v_uid
    ORDER BY coalesce(r.completed_at, r.updated_at, r.created_at) DESC
    LIMIT 30
  ) AS history;

  RETURN jsonb_build_object(
    'driver_name', coalesce(nullif(trim(v_profile.display_name), ''), 'Driver'),
    'driver_tier_label', CASE
      WHEN coalesce(v_driver.rating_avg, 0) >= 4.9 AND coalesce(v_driver.trips_count, 0) >= 100 THEN 'Elite'
      WHEN coalesce(v_driver.rating_avg, 0) >= 4.7 THEN 'Pro'
      ELSE 'Active'
    END,
    'rating', coalesce(v_driver.rating_avg, 5.0),
    'hotspot', v_hotspot,
    'earnings_snapshot', jsonb_build_object(
      'today_earnings_iqd', v_today_earnings,
      'today_delta_percent', 0,
      'daily_goal_iqd', greatest(v_today_earnings, 100000),
      'weekly_earnings_iqd', v_weekly_earnings,
      'weekly_goal_iqd', greatest(v_weekly_earnings, 700000),
      'acceptance_rate_percent', CASE
        WHEN v_total_requests <= 0 THEN 100
        ELSE round((v_accepted_requests::numeric / v_total_requests::numeric) * 100)::integer
      END,
      'cancellation_rate_percent', CASE
        WHEN v_accepted_requests <= 0 THEN 0
        ELSE round((v_cancelled_rides::numeric / v_accepted_requests::numeric) * 100)::integer
      END,
      'online_hours_today', 0,
      'total_daily_iqd', v_today_earnings,
      'total_weekly_iqd', v_weekly_earnings,
      'total_monthly_iqd', v_monthly_earnings,
      'daily_trips', v_daily_trips,
      'weekly_trips', v_weekly_trips,
      'monthly_trips', v_monthly_trips
    ),
    'wallet_snapshot', jsonb_build_object(
      'available_balance_iqd', greatest(v_wallet_balance, 0),
      'pending_settlement_iqd', v_pending_payout_iqd,
      'last_payout_at', (
        SELECT max(spr.requested_at)
        FROM public.settlement_payout_requests spr
        WHERE spr.party_type = 'driver'::public.settlement_party_type
          AND spr.party_id = v_uid
      )
    ),
    'wallet_payouts', v_wallet_payouts,
    'recent_trips', v_recent_trips,
    'request_queue', v_request_queue,
    'trip_history', v_trip_history
  );
END;
$$;

COMMENT ON FUNCTION public.driver_dashboard_bootstrap_v1()
IS 'Returns the authenticated driver dashboard bootstrap payload with earnings, hotspot, wallet, assigned queue, and trip history.';

REVOKE ALL ON FUNCTION public.driver_dashboard_bootstrap_v1() FROM PUBLIC;
GRANT ALL ON FUNCTION public.driver_dashboard_bootstrap_v1() TO authenticated;
GRANT ALL ON FUNCTION public.driver_dashboard_bootstrap_v1() TO service_role;

CREATE OR REPLACE FUNCTION public.merchant_orders_list_my_v1(
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS TABLE(
  order_id uuid,
  customer_name text,
  order_label text,
  total_iqd bigint,
  created_at timestamp with time zone,
  status public.merchant_order_status,
  items jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $$
DECLARE
  v_uid uuid;
  v_merchant_id uuid;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT m.id
  INTO v_merchant_id
  FROM public.merchants m
  WHERE m.owner_profile_id = v_uid
  ORDER BY m.created_at DESC
  LIMIT 1;

  IF v_merchant_id IS NULL THEN
    RAISE EXCEPTION 'not_a_merchant';
  END IF;

  RETURN QUERY
  SELECT
    o.id AS order_id,
    coalesce(nullif(trim(pp.display_name), ''), nullif(trim(p.display_name), ''), 'Customer') AS customer_name,
    'Order #' || upper(right(replace(o.id::text, '-', ''), 6)) AS order_label,
    o.total_iqd,
    o.created_at,
    o.status,
    coalesce(order_items.items, '[]'::jsonb) AS items
  FROM public.merchant_orders o
  LEFT JOIN public.public_profiles pp
    ON pp.id = o.customer_id
  LEFT JOIN public.profiles p
    ON p.id = o.customer_id
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(
      jsonb_build_object(
        'name', oi.name_snapshot,
        'quantity', oi.qty
      )
      ORDER BY oi.created_at ASC, oi.id ASC
    ) AS items
    FROM public.merchant_order_items oi
    WHERE oi.order_id = o.id
  ) AS order_items ON true
  WHERE o.merchant_id = v_merchant_id
  ORDER BY o.created_at DESC, o.id DESC
  LIMIT greatest(coalesce(p_limit, 50), 0)
  OFFSET greatest(coalesce(p_offset, 0), 0);
END;
$$;

COMMENT ON FUNCTION public.merchant_orders_list_my_v1(integer, integer)
IS 'Returns the authenticated merchant owner order list with aggregated item snapshots.';

REVOKE ALL ON FUNCTION public.merchant_orders_list_my_v1(integer, integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.merchant_orders_list_my_v1(integer, integer) TO authenticated;
GRANT ALL ON FUNCTION public.merchant_orders_list_my_v1(integer, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.merchant_orders_update_status_v1(
  p_order_id uuid,
  p_status public.merchant_order_status
)
RETURNS TABLE(
  order_id uuid,
  status public.merchant_order_status,
  status_changed_at timestamp with time zone
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $$
DECLARE
  v_uid uuid;
  v_order public.merchant_orders;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'missing_order_id';
  END IF;

  SELECT o.*
  INTO v_order
  FROM public.merchant_orders o
  JOIN public.merchants m
    ON m.id = o.merchant_id
  WHERE o.id = p_order_id
    AND m.owner_profile_id = v_uid;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found';
  END IF;

  UPDATE public.merchant_orders o
  SET status = p_status,
      status_changed_at = now()
  WHERE o.id = p_order_id
  RETURNING o.id, o.status, o.status_changed_at
  INTO order_id, status, status_changed_at;

  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.merchant_orders_update_status_v1(uuid, public.merchant_order_status)
IS 'Updates an authenticated merchant owner order status using the existing merchant order guard and trigger audit chain.';

REVOKE ALL ON FUNCTION public.merchant_orders_update_status_v1(uuid, public.merchant_order_status) FROM PUBLIC;
GRANT ALL ON FUNCTION public.merchant_orders_update_status_v1(uuid, public.merchant_order_status) TO authenticated;
GRANT ALL ON FUNCTION public.merchant_orders_update_status_v1(uuid, public.merchant_order_status) TO service_role;

CREATE OR REPLACE FUNCTION public.merchant_menu_list_my_v1()
RETURNS TABLE(
  item_id uuid,
  name text,
  category text,
  price_iqd bigint,
  is_active boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $$
DECLARE
  v_uid uuid;
  v_merchant_id uuid;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT m.id
  INTO v_merchant_id
  FROM public.merchants m
  WHERE m.owner_profile_id = v_uid
  ORDER BY m.created_at DESC
  LIMIT 1;

  IF v_merchant_id IS NULL THEN
    RAISE EXCEPTION 'not_a_merchant';
  END IF;

  RETURN QUERY
  SELECT
    p.id AS item_id,
    p.name,
    p.category,
    p.price_iqd,
    p.is_active
  FROM public.merchant_products p
  WHERE p.merchant_id = v_merchant_id
  ORDER BY p.updated_at DESC, p.created_at DESC, p.id DESC;
END;
$$;

COMMENT ON FUNCTION public.merchant_menu_list_my_v1()
IS 'Returns the authenticated merchant owner menu items.';

REVOKE ALL ON FUNCTION public.merchant_menu_list_my_v1() FROM PUBLIC;
GRANT ALL ON FUNCTION public.merchant_menu_list_my_v1() TO authenticated;
GRANT ALL ON FUNCTION public.merchant_menu_list_my_v1() TO service_role;

CREATE OR REPLACE FUNCTION public.merchant_menu_upsert_my_v1(
  p_item_id uuid DEFAULT NULL::uuid,
  p_name text DEFAULT NULL::text,
  p_category text DEFAULT NULL::text,
  p_price_iqd bigint DEFAULT NULL::bigint,
  p_is_active boolean DEFAULT true,
  p_description text DEFAULT NULL::text
)
RETURNS TABLE(
  item_id uuid,
  name text,
  category text,
  price_iqd bigint,
  is_active boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $$
DECLARE
  v_uid uuid;
  v_merchant_id uuid;
  v_product public.merchant_products;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT m.id
  INTO v_merchant_id
  FROM public.merchants m
  WHERE m.owner_profile_id = v_uid
  ORDER BY m.created_at DESC
  LIMIT 1;

  IF v_merchant_id IS NULL THEN
    RAISE EXCEPTION 'not_a_merchant';
  END IF;

  IF p_name IS NULL OR nullif(trim(p_name), '') IS NULL THEN
    RAISE EXCEPTION 'missing_name';
  END IF;
  IF p_price_iqd IS NULL OR p_price_iqd < 0 THEN
    RAISE EXCEPTION 'invalid_price';
  END IF;

  IF p_item_id IS NOT NULL THEN
    SELECT *
    INTO v_product
    FROM public.merchant_products mp
    WHERE mp.id = p_item_id
      AND mp.merchant_id = v_merchant_id;
  END IF;

  IF FOUND THEN
    UPDATE public.merchant_products mp
    SET name = trim(p_name),
        category = nullif(trim(coalesce(p_category, '')), ''),
        price_iqd = p_price_iqd,
        is_active = coalesce(p_is_active, true),
        description = nullif(trim(coalesce(p_description, '')), ''),
        updated_at = now()
    WHERE mp.id = p_item_id
    RETURNING mp.*
    INTO v_product;
  ELSE
    INSERT INTO public.merchant_products (
      merchant_id,
      name,
      category,
      price_iqd,
      is_active,
      description
    ) VALUES (
      v_merchant_id,
      trim(p_name),
      nullif(trim(coalesce(p_category, '')), ''),
      p_price_iqd,
      coalesce(p_is_active, true),
      nullif(trim(coalesce(p_description, '')), '')
    )
    RETURNING *
    INTO v_product;
  END IF;

  item_id := v_product.id;
  name := v_product.name;
  category := v_product.category;
  price_iqd := v_product.price_iqd;
  is_active := v_product.is_active;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.merchant_menu_upsert_my_v1(uuid, text, text, bigint, boolean, text)
IS 'Inserts or updates an authenticated merchant owner menu item without granting direct client table writes.';

REVOKE ALL ON FUNCTION public.merchant_menu_upsert_my_v1(uuid, text, text, bigint, boolean, text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.merchant_menu_upsert_my_v1(uuid, text, text, bigint, boolean, text) TO authenticated;
GRANT ALL ON FUNCTION public.merchant_menu_upsert_my_v1(uuid, text, text, bigint, boolean, text) TO service_role;
