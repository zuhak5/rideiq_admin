BEGIN;

SELECT plan(5);

\set rider_a '00000000-0000-0000-0000-000000000021'
\set rider_b '00000000-0000-0000-0000-000000000022'
\set request_id '00000000-0000-0000-0000-000000000023'
\set area_id '00000000-0000-0000-0000-000000000024'
\set quote_a '00000000-0000-0000-0000-000000000025'
\set quote_b '00000000-0000-0000-0000-000000000026'

INSERT INTO auth.users (id)
VALUES
  (:'rider_a'::uuid),
  (:'rider_b'::uuid)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, display_name, phone)
VALUES
  (:'rider_a'::uuid, 'Rider A', '+9647000000021'),
  (:'rider_b'::uuid, 'Rider B', '+9647000000022')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.ride_products (code, name, is_active)
VALUES ('pgtap_standard', 'PGTAP Standard', true)
ON CONFLICT (code) DO UPDATE SET is_active = EXCLUDED.is_active;

INSERT INTO public.service_areas (
  id,
  name,
  governorate,
  is_active,
  priority,
  geom
) VALUES (
  :'area_id'::uuid,
  'PGTAP Area',
  'Baghdad',
  true,
  0,
  extensions.ST_Multi(extensions.ST_MakeEnvelope(44.35, 33.25, 44.55, 33.45, 4326))
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.fare_quotes (
  id,
  rider_id,
  service_area_id,
  product_code,
  pickup_lat,
  pickup_lng,
  dropoff_lat,
  dropoff_lng,
  breakdown,
  total_iqd,
  currency
) VALUES
  (
    :'quote_a'::uuid,
    :'rider_a'::uuid,
    :'area_id'::uuid,
    'pgtap_standard',
    33.3152,
    44.3661,
    33.3301,
    44.4024,
    '{"distance_km": 5.8, "duration_min": 14}'::jsonb,
    7000,
    'IQD'
  ),
  (
    :'quote_b'::uuid,
    :'rider_b'::uuid,
    :'area_id'::uuid,
    'pgtap_standard',
    33.3152,
    44.3661,
    33.3301,
    44.4024,
    '{"distance_km": 5.8, "duration_min": 14}'::jsonb,
    7000,
    'IQD'
  )
ON CONFLICT (id) DO NOTHING;

SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$SELECT public.ride_request_create_user_v1(
    33.3152, 44.3661, 33.3301, 44.4024,
    'Pickup', 'Dropoff',
    'pgtap_standard',
    '{}'::jsonb,
    'wallet',
    '00000000-0000-0000-0000-000000000025'::uuid,
    '00000000-0000-0000-0000-000000000023'::uuid
  )$$,
  'P0001',
  'unauthorized'
);

SELECT set_config('request.jwt.claim.sub', :'rider_a', true);

SELECT throws_ok(
  $$SELECT public.ride_request_create_user_v1(
    33.3152, 44.3661, 33.3301, 44.4024,
    'Pickup', 'Dropoff',
    'pgtap_standard',
    '{}'::jsonb,
    'card',
    '00000000-0000-0000-0000-000000000025'::uuid,
    NULL
  )$$,
  'P0001',
  'invalid_payment_method'
);

SELECT throws_ok(
  $$SELECT public.ride_request_create_user_v1(
    33.3152, 44.3661, 33.3301, 44.4024,
    'Pickup', 'Dropoff',
    'pgtap_standard',
    '{}'::jsonb,
    'wallet',
    '00000000-0000-0000-0000-000000000026'::uuid,
    NULL
  )$$,
  'P0001',
  'forbidden'
);

SELECT is(
  (
    public.ride_request_create_user_v1(
      33.3152, 44.3661, 33.3301, 44.4024,
      'Pickup', 'Dropoff',
      'pgtap_standard',
      '{"promo_code":"HELLO"}'::jsonb,
      'wallet',
      :'quote_a'::uuid,
      :'request_id'::uuid
    ) ->> 'already_exists'
  ),
  'false',
  'first call creates a ride request'
);

SELECT is(
  (
    public.ride_request_create_user_v1(
      33.3152, 44.3661, 33.3301, 44.4024,
      'Pickup', 'Dropoff',
      'pgtap_standard',
      '{"promo_code":"HELLO"}'::jsonb,
      'wallet',
      :'quote_a'::uuid,
      :'request_id'::uuid
    ) ->> 'already_exists'
  ),
  'true',
  'second call with same request_id is idempotent'
);

SELECT * FROM finish();

ROLLBACK;
