BEGIN;

SELECT plan(16);

\set rider_id '00000000-0000-0000-0000-000000000101'
\set driver_id '00000000-0000-0000-0000-000000000102'
\set merchant_owner_id '00000000-0000-0000-0000-000000000103'
\set merchant_customer_id '00000000-0000-0000-0000-000000000104'
\set merchant_id '00000000-0000-0000-0000-000000000105'
\set rider_address_id '00000000-0000-0000-0000-000000000106'
\set driver_vehicle_id '00000000-0000-0000-0000-000000000107'
\set driver_order_id '00000000-0000-0000-0000-000000000108'
\set merchant_order_id '00000000-0000-0000-0000-000000000109'
\set merchant_item_id '00000000-0000-0000-0000-000000000110'
\set merchant_promo_id '00000000-0000-0000-0000-000000000111'
\set payout_id '00000000-0000-0000-0000-000000000112'
\set ride_request_completed_id '00000000-0000-0000-0000-000000000113'
\set ride_completed_id '00000000-0000-0000-0000-000000000114'
\set ride_request_cancelled_id '00000000-0000-0000-0000-000000000115'
\set fare_quote_id '00000000-0000-0000-0000-000000000116'
\set hotspot_id '00000000-0000-0000-0000-000000000117'

INSERT INTO auth.users (
  id,
  phone,
  encrypted_password,
  phone_confirmed_at,
  created_at,
  updated_at
)
VALUES
  (:'rider_id'::uuid, '+9647700000101', 'enc-rider', now(), now(), now()),
  (:'driver_id'::uuid, '+9647700000102', 'enc-driver', now(), now(), now()),
  (:'merchant_owner_id'::uuid, '+9647700000103', 'enc-merchant-owner', now(), now(), now()),
  (:'merchant_customer_id'::uuid, '+9647700000104', 'enc-merchant-customer', now(), now(), now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, display_name, phone_e164, active_role)
VALUES
  (:'rider_id'::uuid, 'Rider One', '+9647700000101', 'rider'),
  (:'driver_id'::uuid, 'Driver One', '+9647700000102', 'driver'),
  (:'merchant_owner_id'::uuid, 'Merchant Owner', '+9647700000103', 'merchant'),
  (:'merchant_customer_id'::uuid, 'Customer One', '+9647700000104', 'rider')
ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name;

INSERT INTO public.public_profiles (id, display_name)
VALUES
  (:'driver_id'::uuid, 'Driver One'),
  (:'merchant_customer_id'::uuid, 'Customer One')
ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name;

INSERT INTO public.drivers (id, status, vehicle_type, rating_avg, trips_count)
VALUES (:'driver_id'::uuid, 'available', 'car_taxi', 4.90, 220)
ON CONFLICT (id) DO UPDATE SET rating_avg = EXCLUDED.rating_avg;

INSERT INTO public.driver_vehicles (
  id,
  driver_id,
  make,
  model,
  color,
  plate_number,
  vehicle_type,
  is_active
)
VALUES (
  :'driver_vehicle_id'::uuid,
  :'driver_id'::uuid,
  'Toyota',
  'Camry',
  'Black',
  'BGD-1234',
  'car_taxi',
  true
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.wallet_accounts (user_id, balance_iqd, held_iqd)
VALUES (:'rider_id'::uuid, 18500, 0)
ON CONFLICT (user_id) DO UPDATE SET balance_iqd = EXCLUDED.balance_iqd;

INSERT INTO public.customer_addresses (
  id,
  user_id,
  label,
  city,
  area,
  address_line1,
  is_default
)
VALUES (
  :'rider_address_id'::uuid,
  :'rider_id'::uuid,
  'Home',
  'Baghdad',
  'Mansour',
  'Street 14',
  true
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.merchants (
  id,
  owner_profile_id,
  business_name,
  business_type,
  status
)
VALUES (
  :'merchant_id'::uuid,
  :'merchant_owner_id'::uuid,
  'Fast Burger',
  'restaurant',
  'approved'
)
ON CONFLICT (id) DO UPDATE SET business_name = EXCLUDED.business_name;

INSERT INTO public.merchant_products (
  id,
  merchant_id,
  name,
  category,
  price_iqd,
  is_active
)
VALUES (
  :'merchant_item_id'::uuid,
  :'merchant_id'::uuid,
  'Burger Combo',
  'Meals',
  9000,
  true
)
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

INSERT INTO public.merchant_promotions (
  id,
  merchant_id,
  category,
  discount_type,
  value,
  starts_at,
  ends_at,
  is_active
)
VALUES (
  :'merchant_promo_id'::uuid,
  :'merchant_id'::uuid,
  'Meals',
  'percent',
  25,
  now() - interval '1 day',
  now() + interval '7 days',
  true
)
ON CONFLICT (id) DO UPDATE SET value = EXCLUDED.value;

INSERT INTO public.settlement_accounts (
  party_type,
  party_id,
  balance_iqd
)
VALUES
  ('driver', :'driver_id'::uuid, 245000),
  ('merchant', :'merchant_id'::uuid, 390000)
ON CONFLICT DO NOTHING;

INSERT INTO public.settlement_payout_requests (
  id,
  party_type,
  party_id,
  amount_iqd,
  method,
  reference,
  status,
  requested_by,
  requested_at
)
VALUES (
  :'payout_id'::uuid,
  'driver',
  :'driver_id'::uuid,
  50000,
  'bank_transfer',
  'PAYOUT-50000',
  'requested',
  :'driver_id'::uuid,
  now() - interval '2 hours'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.fare_quotes (
  id,
  rider_id,
  product_code,
  pickup_lat,
  pickup_lng,
  dropoff_lat,
  dropoff_lng,
  breakdown,
  total_iqd,
  currency
)
VALUES (
  :'fare_quote_id'::uuid,
  :'rider_id'::uuid,
  'standard',
  33.3152,
  44.3661,
  33.3301,
  44.4024,
  '{"distance_km":5.8,"duration_min":14}'::jsonb,
  7600,
  'IQD'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.ride_requests (
  id,
  rider_id,
  pickup_lat,
  pickup_lng,
  dropoff_lat,
  dropoff_lng,
  pickup_address,
  dropoff_address,
  status,
  assigned_driver_id,
  quote_amount_iqd,
  fare_quote_id,
  created_at,
  accepted_at
)
VALUES
  (
    :'ride_request_completed_id'::uuid,
    :'rider_id'::uuid,
    33.3152,
    44.3661,
    33.3301,
    44.4024,
    'Pickup A',
    'Dropoff A',
    'accepted',
    :'driver_id'::uuid,
    7600,
    :'fare_quote_id'::uuid,
    now() - interval '1 day',
    now() - interval '23 hours'
  ),
  (
    :'ride_request_cancelled_id'::uuid,
    :'rider_id'::uuid,
    33.3152,
    44.3661,
    33.3221,
    44.3899,
    'Pickup B',
    'Dropoff B',
    'cancelled',
    :'driver_id'::uuid,
    4200,
    null,
    now() - interval '2 days',
    null
  ),
  (
    :'driver_order_id'::uuid,
    :'merchant_customer_id'::uuid,
    33.3152,
    44.3661,
    33.3181,
    44.3705,
    'Merchant Pickup',
    'Merchant Dropoff',
    'matched',
    :'driver_id'::uuid,
    6500,
    :'fare_quote_id'::uuid,
    now() - interval '30 minutes',
    null
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.rides (
  id,
  request_id,
  rider_id,
  driver_id,
  status,
  completed_at,
  fare_amount_iqd,
  created_at
)
VALUES (
  :'ride_completed_id'::uuid,
  :'ride_request_completed_id'::uuid,
  :'rider_id'::uuid,
  :'driver_id'::uuid,
  'completed',
  now() - interval '23 hours',
  7600,
  now() - interval '1 day'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.demand_hotspots (
  id,
  valid_until,
  zone_id,
  zone_name,
  center_lat,
  center_lng,
  demand_level,
  nearby_driver_count,
  trips_last_hour
)
VALUES (
  :'hotspot_id'::uuid,
  now() + interval '2 hours',
  'mansour',
  'Mansour Core',
  33.3156,
  44.3670,
  5,
  3,
  18
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.driver_locations (
  driver_id,
  lat,
  lng,
  vehicle_type
)
VALUES (
  :'driver_id'::uuid,
  33.3151,
  44.3665,
  'car_taxi'
)
ON CONFLICT (driver_id) DO UPDATE SET lat = EXCLUDED.lat, lng = EXCLUDED.lng;

INSERT INTO public.merchant_orders (
  id,
  merchant_id,
  customer_id,
  status,
  subtotal_iqd,
  total_iqd,
  address_snapshot,
  created_at
)
VALUES (
  :'merchant_order_id'::uuid,
  :'merchant_id'::uuid,
  :'merchant_customer_id'::uuid,
  'placed',
  18000,
  18000,
  '{"city":"Baghdad","area":"Mansour"}'::jsonb,
  now() - interval '10 minutes'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.merchant_order_items (
  order_id,
  product_id,
  name_snapshot,
  unit_price_iqd,
  qty,
  line_total_iqd
)
VALUES (
  :'merchant_order_id'::uuid,
  :'merchant_item_id'::uuid,
  'Burger Combo',
  9000,
  2,
  18000
)
ON CONFLICT DO NOTHING;

SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$SELECT public.rider_home_bootstrap_v1()$$,
  'P0001',
  'not_authenticated'
);

SELECT set_config('request.jwt.claim.sub', :'rider_id', true);

SELECT is(
  public.rider_home_bootstrap_v1() ->> 'pickup_label',
  'Pickup: Home',
  'rider bootstrap returns the default saved place label'
);

SELECT is(
  (public.rider_home_bootstrap_v1() ->> 'wallet_balance_iqd')::integer,
  18500,
  'rider bootstrap returns wallet balance'
);

SELECT ok(
  public.rider_home_bootstrap_v1() -> 'quick_destinations' ? 'Dropoff A',
  'rider bootstrap keeps recent ride destinations in quick destinations'
);

SELECT ok(
  jsonb_array_length(public.rider_home_bootstrap_v1() -> 'offers') >= 1,
  'rider bootstrap returns live offers'
);

SELECT is(
  (SELECT count(*)::integer FROM public.rider_activity_list_my_v1(10, 0)),
  2,
  'rider activity returns completed and cancelled entries'
);

SELECT is(
  (
    SELECT status
    FROM public.rider_activity_list_my_v1(10, 0)
    ORDER BY occurred_at DESC, id DESC
    LIMIT 1
  ),
  'completed',
  'rider activity sorts newest completed ride first'
);

SELECT set_config('request.jwt.claim.sub', :'driver_id', true);

SELECT is(
  public.driver_dashboard_bootstrap_v1() ->> 'driver_name',
  'Driver One',
  'driver dashboard bootstrap returns the driver identity'
);

SELECT ok(
  jsonb_array_length(public.driver_dashboard_bootstrap_v1() -> 'request_queue') >= 1,
  'driver dashboard bootstrap returns the active request queue'
);

SELECT is(
  (public.driver_dashboard_bootstrap_v1() #>> '{wallet_snapshot,available_balance_iqd}')::integer,
  245000,
  'driver dashboard bootstrap returns settlement balance'
);

SELECT set_config('request.jwt.claim.sub', :'merchant_owner_id', true);

SELECT is(
  (SELECT count(*)::integer FROM public.merchant_orders_list_my_v1(10, 0)),
  1,
  'merchant order list returns owned orders only'
);

SELECT is(
  (SELECT status::text FROM public.merchant_orders_update_status_v1(:'merchant_order_id'::uuid, 'accepted')),
  'accepted',
  'merchant order status update persists through the RPC'
);

SELECT is(
  (SELECT status::text FROM public.merchant_orders WHERE id = :'merchant_order_id'::uuid),
  'accepted',
  'merchant order row was updated'
);

SELECT is(
  (SELECT count(*)::integer FROM public.merchant_menu_list_my_v1()),
  1,
  'merchant menu list returns owned items'
);

SELECT is(
  (
    SELECT name
    FROM public.merchant_menu_upsert_my_v1(
      :'merchant_item_id'::uuid,
      'Burger Combo XL',
      'Meals',
      11000,
      true,
      'Bigger combo'
    )
  ),
  'Burger Combo XL',
  'merchant menu upsert updates an existing item'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM public.merchant_products
    WHERE id = :'merchant_item_id'::uuid
      AND name = 'Burger Combo XL'
      AND price_iqd = 11000
  ),
  'merchant product table reflects the RPC upsert'
);

SELECT * FROM finish();

ROLLBACK;
