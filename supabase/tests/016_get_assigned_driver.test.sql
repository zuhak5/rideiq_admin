BEGIN;
SELECT plan(4);

\set rider '00000000-0000-0000-0000-000000000101'
\set driver '00000000-0000-0000-0000-000000000102'
\set other '00000000-0000-0000-0000-000000000103'
\set request_id '00000000-0000-0000-0000-000000000104'
\set ride_id '00000000-0000-0000-0000-000000000105'

INSERT INTO auth.users (id)
VALUES
  (:'rider'::uuid),
  (:'driver'::uuid),
  (:'other'::uuid)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (
  id,
  display_name,
  phone,
  phone_e164,
  active_role
)
VALUES
  (:'rider'::uuid, 'Rider Test', '+9647000000101', '+9647000000101', 'rider'),
  (:'driver'::uuid, 'Driver Test', '+9647000000102', '+9647000000102', 'driver'),
  (:'other'::uuid, 'Other Test', '+9647000000103', '+9647000000103', 'rider')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.public_profiles (
  id,
  display_name,
  rating_avg,
  rating_count
)
VALUES
  (:'driver'::uuid, 'Driver Test', 4.80, 120)
ON CONFLICT (id) DO UPDATE
SET
  display_name = EXCLUDED.display_name,
  rating_avg = EXCLUDED.rating_avg,
  rating_count = EXCLUDED.rating_count;

INSERT INTO public.drivers (
  id,
  status,
  vehicle_type,
  rating_avg,
  rating_count
)
VALUES
  (:'driver'::uuid, 'available', 'car_taxi', 4.80, 120)
ON CONFLICT (id) DO UPDATE
SET
  status = EXCLUDED.status,
  vehicle_type = EXCLUDED.vehicle_type,
  rating_avg = EXCLUDED.rating_avg,
  rating_count = EXCLUDED.rating_count;

INSERT INTO public.driver_vehicles (
  driver_id,
  make,
  model,
  color,
  plate_number,
  vehicle_type,
  capacity,
  is_active
)
VALUES
  (:'driver'::uuid, 'Toyota', 'Corolla', 'White', '12345', 'car_taxi', 4, true);

INSERT INTO public.ride_requests (
  id,
  rider_id,
  pickup_lat,
  pickup_lng,
  dropoff_lat,
  dropoff_lng,
  pickup_address,
  dropoff_address,
  product_code,
  quote_amount_iqd,
  payment_method
)
VALUES
  (
    :'request_id'::uuid,
    :'rider'::uuid,
    33.3152,
    44.3661,
    33.3050,
    44.3610,
    'Pickup Test',
    'Dropoff Test',
    'standard',
    4500,
    'cash'
  );

INSERT INTO public.rides (
  id,
  request_id,
  rider_id,
  driver_id,
  status,
  product_code,
  payment_method,
  fare_amount_iqd,
  cash_expected_amount_iqd
)
VALUES
  (
    :'ride_id'::uuid,
    :'request_id'::uuid,
    :'rider'::uuid,
    :'driver'::uuid,
    'assigned',
    'standard',
    'cash',
    4500,
    4500
  );

SET LOCAL ROLE authenticated;

SELECT ok(
  has_function_privilege(
    'authenticated',
    'public.get_assigned_driver(uuid)',
    'EXECUTE'
  ),
  'authenticated can execute get_assigned_driver()'
);

SELECT set_config('request.jwt.claim.sub', :'rider', true);
SELECT results_eq(
  $$ SELECT driver_id, display_name, vehicle_make, vehicle_model, vehicle_color, plate_number
     FROM public.get_assigned_driver((:'ride_id')::uuid) $$,
  $$ VALUES (:'driver'::uuid, 'Driver Test', 'Toyota', 'Corolla', 'White', '12345') $$,
  'rider can read assigned driver summary'
);

SELECT set_config('request.jwt.claim.sub', :'driver', true);
SELECT results_eq(
  $$ SELECT driver_id, display_name, vehicle_make, vehicle_model, vehicle_color, plate_number
     FROM public.get_assigned_driver((:'ride_id')::uuid) $$,
  $$ VALUES (:'driver'::uuid, 'Driver Test', 'Toyota', 'Corolla', 'White', '12345') $$,
  'driver can read assigned driver summary'
);

SELECT set_config('request.jwt.claim.sub', :'other', true);
SELECT throws_ok(
  $$ SELECT * FROM public.get_assigned_driver((:'ride_id')::uuid) $$,
  'forbidden',
  'unrelated user is forbidden from reading assigned driver summary'
);

SELECT * FROM finish();
ROLLBACK;
