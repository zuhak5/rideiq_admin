import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { MapView, type LatLng, type MapMarker } from '../components/maps/MapView';
import { FunctionsHttpError, type RealtimeChannel } from '@supabase/supabase-js';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabaseClient';
import { errorText } from '../lib/errors';
import { formatIQD } from '../lib/money';
import { invokeEdge, makeEdgeTraceHeaders } from '../lib/edgeInvoke';
import SafetyToolkitModal from '../components/SafetyToolkitModal';
import RideCheckModal from '../components/RideCheckModal';
import { voiceCallCreateForRide } from '../lib/voiceCalls';
import ShiftPlanner from '../components/ShiftPlanner';
import EarningsCoach from '../components/EarningsCoach';

type DriverRow = {
  id: string;
  status: 'offline' | 'available' | 'assigned' | 'reserved' | 'on_trip' | 'suspended';
  vehicle_type: string | null;
  rating_avg: number;
  trips_count: number;
  require_pickup_pin: boolean;
};

type ProfileRow = {
  id: string;
  gender: string | null;
  display_name: string | null;
  phone: string | null;
};

type ProfileKycRow = {
  user_id: string;
  status: string;
  note: string | null;
  updated_at: string | null;
};

type DriverVehicleRow = {
  id: string;
  driver_id: string;
  make: string | null;
  model: string | null;
  color: string | null;
  plate_number: string | null;
};

type RideRequestRow = {
  id: string;
  status: string;
  pickup_address: string | null;
  dropoff_address: string | null;
  created_at: string;
  matched_at: string | null;
  match_deadline: string | null;
  pickup_lat?: number | null;
  pickup_lng?: number | null;
  dropoff_lat?: number | null;
  dropoff_lng?: number | null;
};

type RideRow = {
  id: string;
  request_id: string;
  status: string;
  version: number;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  fare_amount_iqd: number | null;
  currency: string | null;
  payment_method?: 'wallet' | 'cash' | null;
  cash_expected_amount_iqd?: number | null;

  pickup_pin_required: boolean;
  pickup_pin_verified_at: string | null;
  pickup_pin_fail_count?: number | null;
  pickup_pin_locked_until?: string | null;
};

type RideCheckEventRow = {
  id: string;
  ride_id: string;
  kind: string;
  status: string;
  created_at: string;
  metadata: Record<string, unknown> | null;
};

type EdgeErrorPayload = {
  error?: string;
  code?: string;
  hint?: string;
  [k: string]: unknown;
};

async function getUid(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  if (!data.user?.id) throw new Error('Not signed in');
  return data.user.id;
}

async function fetchDriver(): Promise<DriverRow | null> {
  const { data, error } = await supabase
    .from('drivers')
    .select('id,status,vehicle_type,rating_avg,trips_count,require_pickup_pin')
    .maybeSingle();
  if (error) throw error;
  return (data as DriverRow) ?? null;
}

async function fetchVehicle(): Promise<DriverVehicleRow | null> {
  const { data, error } = await supabase
    .from('driver_vehicles')
    .select('id,driver_id,make,model,color,plate_number')
    .maybeSingle();
  if (error) throw error;
  return (data as DriverVehicleRow) ?? null;
}

async function fetchProfile(): Promise<ProfileRow | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id,gender,display_name,phone')
    .maybeSingle();
  if (error) throw error;
  return (data as ProfileRow) ?? null;
}

async function fetchProfileKyc(): Promise<ProfileKycRow | null> {
  const { data, error } = await supabase
    .from('profile_kyc')
    .select('user_id,status,note,updated_at')
    .maybeSingle();
  if (error) throw error;
  return (data as ProfileKycRow) ?? null;
}

async function fetchAssignedRequests(): Promise<RideRequestRow[]> {
  const uid = await getUid();
  const { data, error } = await supabase
    .from('ride_requests')
    .select('id,status,pickup_address,dropoff_address,pickup_lat,pickup_lng,dropoff_lat,dropoff_lng,created_at,matched_at,match_deadline')
    .eq('assigned_driver_id', uid)
    .eq('status', 'matched')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data as RideRequestRow[]) ?? [];
}

async function fetchRides(): Promise<RideRow[]> {
  const uid = await getUid();
  const { data, error } = await supabase
    .from('rides')
    .select(
      'id,request_id,status,version,created_at,started_at,completed_at,fare_amount_iqd,currency,payment_method,cash_expected_amount_iqd,pickup_pin_required,pickup_pin_verified_at,pickup_pin_fail_count,pickup_pin_locked_until',
    )
    .eq('driver_id', uid)
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) throw error;
  return (data as RideRow[]) ?? [];
}

async function fetchRidecheckOpen(rideId: string): Promise<RideCheckEventRow | null> {
  const { data, error } = await supabase
    .from('ridecheck_events')
    .select('id,ride_id,kind,status,created_at,metadata')
    .eq('ride_id', rideId)
    .eq('status', 'open')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as RideCheckEventRow) ?? null;
}

async function tryReadEdgeErrorPayload(err: unknown): Promise<EdgeErrorPayload | null> {
  if (err instanceof FunctionsHttpError) {
    try {
      const payload = (await err.context.json()) as EdgeErrorPayload;
      return payload && typeof payload === 'object' ? payload : null;
    } catch {
      return null;
    }
  }
  return null;
}

type GeoState = {
  tracking: boolean;
  lastFixAt: number | null;
  lat: number | null;
  lng: number | null;
  accuracyM: number | null;
  error: string | null;
};

const allowedTransitions: Record<string, Set<string>> = {
  assigned: new Set(['arrived', 'canceled']),
  arrived: new Set(['in_progress', 'canceled']),
  in_progress: new Set(['completed', 'canceled']),
};

export default function DriverPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const nav = useNavigate();

  const [toast, setToast] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [callBusyRideId, setCallBusyRideId] = React.useState<string | null>(null);

  // Safety toolkit modal
  const [safetyRide, setSafetyRide] = React.useState<{ id: string; status: string } | null>(null);

  // RideCheck prompt
  const [ridecheckOpen, setRidecheckOpen] = React.useState(false);

  // Pickup PIN modal
  const [pinOpen, setPinOpen] = React.useState(false);
  // Cash collection modal (cash rides)
  const [cashOpen, setCashOpen] = React.useState(false);
  const [cashRide, setCashRide] = React.useState<RideRow | null>(null);
  const [cashCollected, setCashCollected] = React.useState('');
  const [cashChange, setCashChange] = React.useState('0');
  const [cashBusy, setCashBusy] = React.useState(false);
  const [cashToast, setCashToast] = React.useState<string | null>(null);
  const [pinRide, setPinRide] = React.useState<RideRow | null>(null);
  const [pinValue, setPinValue] = React.useState('');
  const [pinBusy, setPinBusy] = React.useState(false);
  const [pinToast, setPinToast] = React.useState<string | null>(null);
  const [pendingTransition, setPendingTransition] = React.useState<{ rideId: string; to: string } | null>(null);

  const [nowMs, setNowMs] = React.useState(() => Date.now());
  const [geo, setGeo] = React.useState<GeoState>({
    tracking: false,
    lastFixAt: null,
    lat: null,
    lng: null,
    accuracyM: null,
    error: null,
  });
  const [baseVehicle, setBaseVehicle] = React.useState<'car' | 'motorcycle' | 'cargo'>('car');
  const [carCategory, setCarCategory] = React.useState<'private' | 'taxi'>('private');
  const vehicleType = React.useMemo(() => {
    if (baseVehicle === 'car') return carCategory === 'taxi' ? 'car_taxi' : 'car_private';
    if (baseVehicle === 'motorcycle') return 'motorcycle';
    return 'cargo';
  }, [baseVehicle, carCategory]);

  const startRiderCall = React.useCallback(
    async (rideId: string) => {
      setCallBusyRideId(rideId);
      setToast(null);
      try {
        const created = await voiceCallCreateForRide({ rideId, provider: 'auto' });
        nav(`/voice-call/${created.call.id}`);
      } catch (e: unknown) {
        setToast(`Call error: ${errorText(e)}`);
      } finally {
        setCallBusyRideId(null);
      }
    },
    [nav],
  );

  const driver = useQuery({ queryKey: ['driver'], queryFn: fetchDriver });
  const profile = useQuery({ queryKey: ['profile'], queryFn: fetchProfile, enabled: !!driver.data });
  const kyc = useQuery({ queryKey: ['profile_kyc'], queryFn: fetchProfileKyc, enabled: !!driver.data });
  const vehicle = useQuery({ queryKey: ['driver_vehicle'], queryFn: fetchVehicle, enabled: !!driver.data });
  const assigned = useQuery({ queryKey: ['assigned_requests'], queryFn: fetchAssignedRequests, enabled: !!driver.data });

  const driverPos = React.useMemo<LatLng | null>(() => {
    if (typeof geo.lat !== 'number' || typeof geo.lng !== 'number') return null;
    if (!Number.isFinite(geo.lat) || !Number.isFinite(geo.lng)) return null;
    return { lat: geo.lat, lng: geo.lng };
  }, [geo.lat, geo.lng]);

  const activeRequest = React.useMemo<RideRequestRow | null>(() => {
    const arr = assigned.data ?? [];
    return arr.length ? arr[0] : null;
  }, [assigned.data]);

  const pickupPos = React.useMemo<LatLng | null>(() => {
    const lat = Number(activeRequest?.pickup_lat);
    const lng = Number(activeRequest?.pickup_lng);
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  }, [activeRequest?.pickup_lat, activeRequest?.pickup_lng]);

  const dropoffPos = React.useMemo<LatLng | null>(() => {
    const lat = Number(activeRequest?.dropoff_lat);
    const lng = Number(activeRequest?.dropoff_lng);
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  }, [activeRequest?.dropoff_lat, activeRequest?.dropoff_lng]);

  const driverMapCenter = driverPos ?? pickupPos ?? dropoffPos ?? { lat: 33.3152, lng: 44.3661 };

  const driverMapMarkers = React.useMemo<MapMarker[]>(() => {
    const ms: MapMarker[] = [];
    if (driverPos) ms.push({ id: 'driver', position: driverPos, label: 'You', title: 'Your location' });
    if (pickupPos) ms.push({ id: 'pickup', position: pickupPos, label: 'P', title: 'Pickup' });
    if (dropoffPos) ms.push({ id: 'dropoff', position: dropoffPos, label: 'D', title: 'Dropoff' });
    return ms;
  }, [driverPos, pickupPos, dropoffPos]);
  const rides = useQuery({ queryKey: ['rides_driver'], queryFn: fetchRides, enabled: !!driver.data });

  const activeRide = React.useMemo(() => {
    const rs = rides.data ?? [];
    return rs.find((r) => r.status === 'in_progress') ?? null;
  }, [rides.data]);

  const ridecheckQ = useQuery({
    queryKey: ['ridecheck_open_driver', activeRide?.id],
    enabled: !!activeRide?.id,
    queryFn: () => fetchRidecheckOpen(activeRide!.id),
  });

  const ridecheckEvent = ridecheckQ.data ?? null;

  // Clock tick for "expires in"
  React.useEffect(() => {
    const h = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(h);
  }, []);

  // Realtime updates for assigned requests + rides
  React.useEffect(() => {
    let reqSub: RealtimeChannel | null = null;
    let rideSub: RealtimeChannel | null = null;
    let cancelled = false;

    (async () => {
      try {
        const uid = await getUid();
        if (cancelled) return;

        reqSub = supabase
          .channel('driver-assigned-requests')
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'ride_requests', filter: `assigned_driver_id=eq.${uid}` },
            () => qc.invalidateQueries({ queryKey: ['assigned_requests'] }),
          )
          .subscribe();

        rideSub = supabase
          .channel('driver-rides')
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'rides', filter: `driver_id=eq.${uid}` },
            () => qc.invalidateQueries({ queryKey: ['rides_driver'] }),
          )
          .subscribe();
      } catch {
        // ignore
      }
    })();

    return () => {
      cancelled = true;
      if (reqSub) supabase.removeChannel(reqSub);
      if (rideSub) supabase.removeChannel(rideSub);
    };
  }, [qc]);

  // Realtime RideCheck prompt for active ride
  React.useEffect(() => {
    if (!activeRide?.id) return;
    const ch = supabase
      .channel(`ridecheck-driver-${activeRide.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'ridecheck_events', filter: `ride_id=eq.${activeRide.id}` },
        () => qc.invalidateQueries({ queryKey: ['ridecheck_open_driver', activeRide.id] }),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(ch);
    };
  }, [activeRide?.id, qc]);

  // Auto-open RideCheck modal when an open event appears
  React.useEffect(() => {
    if (ridecheckEvent && ridecheckEvent.status === 'open') {
      setRidecheckOpen(true);
    }
  }, [ridecheckEvent]);

  // Location tracking (throttled)
  React.useEffect(() => {
    if (!geo.tracking) return;
    if (!navigator.geolocation) {
      setGeo((s) => ({ ...s, tracking: false, error: 'Geolocation not supported by this browser.' }));
      return;
    }

    let watchId: number | null = null;
    let lastSentAt = 0;
    let stopped = false;

    const start = async () => {
      try {
        await getUid();
        if (stopped) return;

        watchId = navigator.geolocation.watchPosition(
          async (pos) => {
            const now = Date.now();
            const lat = pos.coords.latitude;
            const lng = pos.coords.longitude;
            const acc = pos.coords.accuracy ?? null;

            setGeo((s) => ({
              ...s,
              lat,
              lng,
              accuracyM: acc,
              lastFixAt: now,
              error: null,
            }));

            // Throttle writes (every 5s) to avoid hammering the DB.
            if (now - lastSentAt < 5000) return;
            lastSentAt = now;

            try {
              // Fix: Use secure Edge Function to rate-limit location updates
              await invokeEdge('driver-location-update', {
                lat,
                lng,
                accuracy_m: acc ?? undefined,
                heading: pos.coords.heading ?? undefined,
                speed_mps: pos.coords.speed ?? undefined,
                vehicle_type: vehicleType,
              });
            } catch {
              // Ignore rate limit errors to avoid spamming the UI
              // console.warn('Loc update failed', e);
            }

          },
          (err) => setGeo((s) => ({ ...s, error: err.message })),
          { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 },
        );
      } catch (e: unknown) {
        setGeo((s) => ({ ...s, error: errorText(e), tracking: false }));
      }
    };

    start();

    return () => {
      stopped = true;
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    };
  }, [geo.tracking, vehicleType]);

  const status = driver.data?.status ?? null;
  const kycStatus = kyc.data?.status ?? 'unverified';
  const kycVerified = kycStatus === 'verified';
  const isOnline = status === 'available' || status === 'assigned' || status === 'reserved' || status === 'on_trip';
  const canToggleOnline = status === 'available' || (status === 'offline' && kycVerified);
  const toggleLabel =
    status === 'offline'
      ? 'Go online'
      : status === 'available'
        ? 'Go offline'
        : status === 'assigned'
          ? 'Assigned'
          : status === 'reserved'
            ? 'Reserved (matched)'
            : status === 'on_trip'
              ? 'On trip'
              : status === 'suspended'
                ? 'Suspended'
                : 'Status';

  const openPinModal = (ride: RideRow, pending?: { rideId: string; to: string } | null) => {
    setPinRide(ride);
    setPinValue('');
    setPinToast(null);
    setPendingTransition(pending ?? null);
    setPinOpen(true);
  };

  const verifyPin = async () => {
    if (!pinRide) return;
    setPinBusy(true);
    setPinToast(null);
    try {
      const body = { ride_id: pinRide.id, pin: pinValue.trim() };
      const { data, error } = await supabase.functions.invoke('ride-verify-pin', {
        body,
        headers: makeEdgeTraceHeaders(body),
      });
      if (error) throw error;

      setPinToast(t('safety.pickupPin.driverVerified'));
      setPinOpen(false);

      await qc.invalidateQueries({ queryKey: ['rides_driver'] });

      // If the user was trying to transition to in_progress, retry now.
      if (pendingTransition?.rideId === pinRide.id) {
        const next = pendingTransition.to;
        setPendingTransition(null);
        await transitionRide(pinRide, next);
      }

      return data;
    } catch (e: unknown) {
      const payload = await tryReadEdgeErrorPayload(e);
      const code = payload?.code ?? '';
      if (code === 'PIN_LOCKED') {
        const lockedUntil = typeof payload?.locked_until === 'string' ? payload.locked_until : null;
        const until = lockedUntil ? new Date(lockedUntil).toLocaleTimeString() : '';
        setPinToast(`${t('safety.pickupPin.locked')} ${until ? `(${until})` : ''}`);
      } else if (code === 'INVALID_PIN') {
        const remaining = typeof payload?.remaining_attempts === 'number' ? payload.remaining_attempts : null;
        setPinToast(
          typeof remaining === 'number'
            ? `${t('safety.pickupPin.invalid')} • ${t('safety.pickupPin.remaining', { count: remaining })}`
            : t('safety.pickupPin.invalid'),
        );
      } else if (code === 'MISSING_SECRET') {
        setPinToast(t('safety.pickupPin.missingSecret'));
      } else {
        setPinToast(`${t('common.error')}: ${payload?.error ?? errorText(e)}`);
      }
    } finally {
      setPinBusy(false);
    }
  };

  const transitionRide = async (ride: RideRow, to: string) => {
    // CASH_MODAL: cash rides require driver to enter cash collection before completing.
    const pay = (ride as any)?.payment_method ?? 'wallet';
    if (to === 'completed' && pay === 'cash') {
      const expected = (ride as any)?.cash_expected_amount_iqd ?? ride.fare_amount_iqd ?? 0;
      setCashRide(ride);
      setCashCollected(expected ? String(expected) : '');
      setCashChange('0');
      setCashToast(null);
      setCashOpen(true);
      return;
    }

    setBusy(true);
    setToast(null);
    try {
      const body = { ride_id: ride.id, to_status: to };
      const { data, error } = await supabase.functions.invoke('ride-transition', {
        body,
        headers: makeEdgeTraceHeaders(body),
      });
      if (error) throw error;

      setToast(t('common.saved'));
      qc.invalidateQueries({ queryKey: ['rides_driver'] });
      qc.invalidateQueries({ queryKey: ['driver'] });
      return data;
    } catch (e: unknown) {
      const payload = await tryReadEdgeErrorPayload(e);
      if (payload?.code === 'PICKUP_PIN_REQUIRED') {
        openPinModal(ride, { rideId: ride.id, to });
        setToast(t('safety.pickupPin.requiredBeforeStart'));
        return;
      }
      if (payload?.code === 'VERSION_MISMATCH') {
        setToast(payload?.hint ?? t('common.error'));
        qc.invalidateQueries({ queryKey: ['rides_driver'] });
        return;
      }
      setToast(`${t('common.error')}: ${payload?.error ?? errorText(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const submitCashAndComplete = async () => {
    if (!cashRide) return;
    setCashBusy(true);
    setCashToast(null);
    try {
      const collected = Number(cashCollected);
      const change = Number(cashChange || 0);
      if (!Number.isFinite(collected) || collected < 0) {
        setCashToast('Enter a valid collected amount');
        return;
      }
      if (!Number.isFinite(change) || change < 0) {
        setCashToast('Enter a valid change amount');
        return;
      }
      if (collected < change) {
        setCashToast('Collected must be >= change');
        return;
      }

      const body = {
        ride_id: cashRide.id,
        to_status: 'completed',
        cash_collected_amount_iqd: Math.trunc(collected),
        cash_change_given_iqd: Math.trunc(change),
      };
      const { data, error } = await supabase.functions.invoke('ride-transition', {
        body,
        headers: makeEdgeTraceHeaders(body),
      });
      if (error) throw error;

      setCashOpen(false);
      setCashRide(null);
      setToast(t('common.saved'));
      qc.invalidateQueries({ queryKey: ['rides_driver'] });
      qc.invalidateQueries({ queryKey: ['driver'] });
      return data;
    } catch (e: unknown) {
      const payload = await tryReadEdgeErrorPayload(e);
      const code = payload?.code ?? '';
      if (code === 'CASH_UNDERPAID') {
        const expected = typeof payload?.expected_iqd === 'number' ? payload.expected_iqd : null;
        const net = typeof payload?.net_iqd === 'number' ? payload.net_iqd : null;
        setCashToast(expected && net ? `Underpaid: net ${formatIQD(net)} (expected ${formatIQD(expected)})` : (payload?.error ?? t('common.error')));
        return;
      }
      if (code === 'CASH_REQUIRED') {
        setCashToast('Cash details required');
        return;
      }
      setCashToast(payload?.error ?? errorText(e));
    } finally {
      setCashBusy(false);
    }
  };

  const [make, setMake] = React.useState('');
  const [model, setModel] = React.useState('');
  const [color, setColor] = React.useState('');
  const [plate, setPlate] = React.useState('');

  return (
    <div className="space-y-6">
      <div className="card p-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="text-base font-semibold">Driver console</div>
            <div className="text-sm text-gray-500 mt-1">
              Onboard once, go online, track location, accept requests. Pickup PIN + RideCheck safety are integrated.
            </div>
          </div>
          {driver.data ? (
            <div className="flex gap-2 flex-wrap">
              <Link className="btn" to="/driver/settlement">
                Settlement
              </Link>
              <Link className="btn" to="/driver/deliveries">
                Deliveries
              </Link>
            </div>
          ) : null}
        </div>

        {driver.data && (
          <div className="grid md:grid-cols-2 gap-4 mt-4">
            <EarningsCoach />
            <ShiftPlanner />
          </div>
        )}

        {driver.isLoading && <div className="mt-4 text-sm text-gray-500">{t('common.loading')}</div>}
        {driver.error && <div className="mt-4 text-sm text-red-600">{errorText(driver.error)}</div>}

        {!driver.isLoading && driver.data === null && (
          <div className="mt-4">
            <div className="text-sm font-semibold">Become a driver</div>
            <div className="text-sm text-gray-500 mt-1">
              Add your vehicle details (MVP; expand with verification later).
            </div>

            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <div className="label">Vehicle</div>
                <div className="flex flex-wrap gap-2">
                  <button
                    className={baseVehicle === 'car' ? 'btn btn-primary' : 'btn'}
                    onClick={() => setBaseVehicle('car')}
                    type="button"
                  >
                    Car
                  </button>
                  <button
                    className={baseVehicle === 'motorcycle' ? 'btn btn-primary' : 'btn'}
                    onClick={() => setBaseVehicle('motorcycle')}
                    type="button"
                  >
                    Motorcycle
                  </button>
                  <button
                    className={baseVehicle === 'cargo' ? 'btn btn-primary' : 'btn'}
                    onClick={() => setBaseVehicle('cargo')}
                    type="button"
                  >
                    Cargo
                  </button>
                </div>
                {baseVehicle === 'car' ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      className={carCategory === 'private' ? 'btn btn-primary' : 'btn'}
                      onClick={() => setCarCategory('private')}
                      type="button"
                    >
                      Private
                    </button>
                    <button
                      className={carCategory === 'taxi' ? 'btn btn-primary' : 'btn'}
                      onClick={() => setCarCategory('taxi')}
                      type="button"
                    >
                      Taxi
                    </button>
                  </div>
                ) : null}
                <div className="mt-2 text-xs opacity-70">Selected: {vehicleType}</div>
              </div>
              <Field label="Make" value={make} onChange={setMake} placeholder="Toyota" />
              <Field label="Model" value={model} onChange={setModel} placeholder="Camry" />
              <Field label="Color" value={color} onChange={setColor} placeholder="White" />
              <Field label="Plate" value={plate} onChange={setPlate} placeholder="123-ABC" />
            </div>

            <div className="mt-4 flex gap-2">
              <button
                className="btn btn-primary"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setToast(null);
                  try {
                    const uid = await getUid();

                    const { error: dErr } = await supabase.from('drivers').insert({
                      id: uid,
                      status: 'offline',
                      vehicle_type: vehicleType,
                    });
                    if (dErr) throw dErr;

                    const { error: vErr } = await supabase.from('driver_vehicles').insert({
                      driver_id: uid,
                      vehicle_type: vehicleType,
                      make: make || null,
                      model: model || null,
                      color: color || null,
                      plate_number: plate || null,
                    });
                    if (vErr) throw vErr;

                    setToast('Driver profile created.');
                    qc.invalidateQueries({ queryKey: ['driver'] });
                    qc.invalidateQueries({ queryKey: ['driver_vehicle'] });
                  } catch (e: unknown) {
                    setToast(`${t('common.error')}: ${errorText(e)}`);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Create driver profile
              </button>
            </div>

            {toast && <div className="mt-3 text-sm text-gray-700">{toast}</div>}
          </div>
        )}

        {driver.data && (
          <div className="mt-4 space-y-4">

            <div className="rounded-md border bg-white p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold">Live map</div>
                  <div className="text-xs text-gray-500">Shows your GPS location and (when assigned) pickup/dropoff markers.</div>
                </div>
                <div className="text-xs text-gray-500">
                  {activeRequest ? `Active request: ${activeRequest.id}` : 'No active request'}
                </div>
              </div>

              <div className="mt-3">
                <MapView
                  className="h-[360px] w-full overflow-hidden rounded-md"
                  center={driverMapCenter}
                  zoom={driverPos ? 14 : 12}
                  markers={driverMapMarkers}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="rounded-md border bg-white p-3">
                <div className="text-xs text-gray-500">KYC status</div>
                <div className="mt-1 text-sm font-semibold">
                  {kycStatus === 'verified'
                    ? 'Verified'
                    : kycStatus === 'pending'
                      ? 'Pending review'
                      : kycStatus === 'rejected'
                        ? 'Rejected'
                        : 'Not verified'}
                </div>
                {kyc.data?.note ? <div className="mt-1 text-xs text-gray-600">{kyc.data.note}</div> : null}
                {!kycVerified ? (
                  <div className="mt-2 text-xs text-amber-700">
                    You must complete verification before going online.
                  </div>
                ) : null}
              </div>

              <div className="rounded-md border bg-white p-3">
                <div className="text-xs text-gray-500">Gender</div>
                <select
                  className="mt-2 w-full rounded-md border px-3 py-2 bg-white"
                  value={(profile.data?.gender ?? 'unknown') || 'unknown'}
                  onChange={async (e) => {
                    try {
                      const gender = e.target.value;
                      const { error } = await supabase.from('profiles').update({ gender }).eq('id', driver.data!.id);
                      if (error) throw error;
                      qc.invalidateQueries({ queryKey: ['profile'] });
                      setToast('Updated.');
                    } catch (err: unknown) {
                      setToast(`${t('common.error')}: ${errorText(err)}`);
                    }
                  }}
                >
                  <option value="unknown">Unknown</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                </select>
                <div className="mt-2 text-xs text-gray-600">Used for Women Only matching.</div>
              </div>

              <div className="rounded-md border bg-white p-3">
                <div className="text-xs text-gray-500">{t('safety.pickupPin.driverRequire')}</div>
                <div className="mt-2 flex items-center justify-between">
                  <div className="text-sm font-semibold">
                    {driver.data.require_pickup_pin ? t('common.on') : t('common.off')}
                  </div>
                  <input
                    type="checkbox"
                    checked={!!driver.data.require_pickup_pin}
                    disabled={busy}
                    onChange={async (e) => {
                      setBusy(true);
                      setToast(null);
                      try {
                        const driverId = driver.data?.id;
                        if (!driverId) return;
                        const { error } = await supabase
                          .from('drivers')
                          .update({ require_pickup_pin: e.target.checked })
                          .eq('id', driverId);
                        if (error) throw error;
                        qc.invalidateQueries({ queryKey: ['driver'] });
                        setToast(t('common.saved'));
                      } catch (err: unknown) {
                        setToast(`${t('common.error')}: ${errorText(err)}`);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  />
                </div>
                <div className="mt-2 text-xs text-gray-600">{t('safety.pickupPin.driverRequireHint')}</div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Pill label={`status: ${driver.data.status}`} />
              <Pill label={`rating: ${Number(driver.data.rating_avg).toFixed(2)}`} />
              <Pill label={`trips: ${driver.data.trips_count}`} />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                className={status === 'offline' ? 'btn btn-primary' : 'btn'}
                disabled={busy || !canToggleOnline}
                title={!canToggleOnline ? 'You cannot change availability while assigned / reserved / on trip.' : undefined}
                onClick={async () => {
                  setBusy(true);
                  setToast(null);
                  try {
                    const driverId = driver.data?.id;
                    if (!driverId) return;
                    const next = status === 'offline' ? 'available' : 'offline';
                    if (next === 'available' && !kycVerified) {
                      setToast('KYC verification required before going online.');
                      return;
                    }
                    const { error } = await supabase.from('drivers').update({ status: next }).eq('id', driverId);
                    if (error) throw error;
                    setToast(next === 'available' ? 'You are online.' : 'You are offline.');
                    qc.invalidateQueries({ queryKey: ['driver'] });
                  } catch (e: unknown) {
                    setToast(`${t('common.error')}: ${errorText(e)}`);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {toggleLabel}
              </button>

              <button
                className="btn"
                disabled={!isOnline}
                onClick={() => setGeo((s) => ({ ...s, tracking: !s.tracking, error: null }))}
                title={!isOnline ? 'Go online first' : undefined}
              >
                {geo.tracking ? 'Stop location' : 'Start location'}
              </button>

              <div className="text-sm text-gray-500">
                {geo.lastFixAt ? (
                  <span>
                    last fix: {new Date(geo.lastFixAt).toLocaleTimeString()}{' '}
                    {geo.accuracyM ? `(±${Math.round(geo.accuracyM)}m)` : ''}
                  </span>
                ) : (
                  <span>no location yet</span>
                )}
              </div>
            </div>

            {vehicle.data ? (
              <div className="text-sm text-gray-600">
                Vehicle: {driver.data.vehicle_type ?? 'car'}
                {vehicle.data.make ? `, ${vehicle.data.make}` : ''}
                {vehicle.data.model ? ` ${vehicle.data.model}` : ''}
                {vehicle.data.color ? `, ${vehicle.data.color}` : ''}
                {vehicle.data.plate_number ? ` (${vehicle.data.plate_number})` : ''}
              </div>
            ) : null}

            {geo.error ? <div className="text-sm text-red-600">{geo.error}</div> : null}
            {toast ? <div className="text-sm text-gray-700">{toast}</div> : null}
          </div>
        )}
      </div>

      <div className="card p-5">
        <div className="text-base font-semibold">Assigned ride requests</div>
        <div className="text-sm text-gray-500 mt-1">Requests matched to you (press Accept to start the trip).</div>

        {assigned.isLoading && driver.data && <div className="mt-4 text-sm text-gray-500">{t('common.loading')}</div>}
        {assigned.error && <div className="mt-4 text-sm text-red-600">{errorText(assigned.error)}</div>}

        <div className="mt-4 space-y-3">
          {(assigned.data ?? []).map((rr) => {
            const deadlineMs = rr.match_deadline ? new Date(rr.match_deadline).getTime() : null;
            const secondsLeft = deadlineMs ? Math.max(0, Math.floor((deadlineMs - nowMs) / 1000)) : null;
            const expiresLabel =
              secondsLeft === null ? null : secondsLeft > 0 ? `expires in ${secondsLeft}s` : 'expired';

            return (
              <div key={rr.id} className="border border-gray-200 rounded-2xl p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm font-semibold">
                    {rr.pickup_address ?? 'Pickup'} → {rr.dropoff_address ?? 'Dropoff'}
                  </div>
                  <div className="flex items-center gap-2">
                    <Pill label={rr.status} />
                    {rr.matched_at ? <Pill label={`matched: ${new Date(rr.matched_at).toLocaleTimeString()}`} /> : null}
                    {expiresLabel ? <Pill label={expiresLabel} /> : null}
                  </div>
                </div>

                <div className="mt-3 flex gap-2">
                  <button
                    className="btn btn-primary"
                    disabled={busy || rr.status !== 'matched' || (secondsLeft !== null && secondsLeft <= 0)}
                    onClick={async () => {
                      setBusy(true);
                      setToast(null);
                      try {
                        const { data } = await invokeEdge<unknown>('driver-accept', { request_id: rr.id });
                        setToast(`Accepted: ${JSON.stringify(data)}`);
                        qc.invalidateQueries({ queryKey: ['assigned_requests'] });
                        qc.invalidateQueries({ queryKey: ['rides_driver'] });
                        qc.invalidateQueries({ queryKey: ['driver'] });
                      } catch (e: unknown) {
                        setToast(`${t('common.error')}: ${errorText(e)}`);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Accept
                  </button>
                </div>
              </div>
            );
          })}

          {(assigned.data ?? []).length === 0 && driver.data && !assigned.isLoading ? (
            <div className="text-sm text-gray-500">No assigned requests.</div>
          ) : null}
          {!driver.data ? <div className="text-sm text-gray-500">Create a driver profile first.</div> : null}
        </div>
      </div>

      <div className="card p-5">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-base font-semibold">Your rides</div>
            <div className="text-sm text-gray-500 mt-1">Update state (arrived → in_progress → completed).</div>
          </div>
          <button className="btn" onClick={() => qc.invalidateQueries({ queryKey: ['rides_driver'] })}>
            Refresh
          </button>
        </div>

        {rides.isLoading && driver.data ? <div className="mt-4 text-sm text-gray-500">{t('common.loading')}</div> : null}
        {rides.error ? <div className="mt-4 text-sm text-red-600">{errorText(rides.error)}</div> : null}

        <div className="mt-4 space-y-3">
          {(rides.data ?? []).map((r) => {
            const pinRequired = Boolean(r.pickup_pin_required);
            const pinVerified = Boolean(r.pickup_pin_verified_at);

            return (
              <div key={r.id} className="border border-gray-200 rounded-2xl p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm font-semibold">Ride {r.id.slice(0, 8)}…</div>
                  <div className="flex items-center gap-2">
                    <button className="btn" onClick={() => setSafetyRide({ id: r.id, status: r.status })}>
                      {t('safety.open')}
                    </button>
                    <button
                      className="btn btn-primary"
                      disabled={callBusyRideId === r.id}
                      onClick={() => void startRiderCall(r.id)}
                    >
                      Call rider
                    </button>
                    <Pill label={`status: ${r.status}`} />
                    <Pill label={`v${r.version}`} />
                    <Pill label={`pay: ${(r as any).payment_method ?? 'wallet'}`} />
                    {(r as any).payment_method === 'cash' ? (
                      <Pill
                        label={`cash: ${formatIQD(((r as any).cash_expected_amount_iqd ?? r.fare_amount_iqd ?? 0) as number)}`}
                      />
                    ) : null}
                  </div>
                </div>

                {ridecheckEvent && activeRide?.id === r.id ? (
                  <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <div className="text-sm font-semibold">{t('safety.ridecheck.title')}</div>
                        <div className="text-xs text-amber-900 mt-1">{t('safety.ridecheck.prompt')}</div>
                      </div>
                      <button className="btn" onClick={() => setRidecheckOpen(true)}>
                        {t('safety.ridecheck.open')}
                      </button>
                    </div>
                  </div>
                ) : null}

                {pinRequired && !pinVerified ? (
                  <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <div className="text-sm font-semibold">{t('safety.pickupPin.driverTitle')}</div>
                        <div className="text-xs text-amber-900 mt-1">{t('safety.pickupPin.driverHint')}</div>
                      </div>
                      <button className="btn btn-primary" onClick={() => openPinModal(r, null)} disabled={busy}>
                        {t('safety.pickupPin.verify')}
                      </button>
                    </div>
                  </div>
                ) : pinRequired && pinVerified ? (
                  <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
                    <div className="text-sm font-semibold">{t('safety.pickupPin.verifiedTitle')}</div>
                    <div className="text-xs text-emerald-900 mt-1">{t('safety.pickupPin.verifiedHint')}</div>
                  </div>
                ) : null}

                <div className="mt-3 flex flex-wrap gap-2">
                  {['arrived', 'in_progress', 'completed', 'canceled'].map((to) => {
                    const ok = allowedTransitions[r.status]?.has(to) ?? false;
                    return (
                      <button
                        key={to}
                        className="btn"
                        disabled={busy || !ok}
                        title={!ok ? `Not allowed from ${r.status}` : undefined}
                        onClick={() => transitionRide(r, to)}
                      >
                        {to}
                      </button>
                    );
                  })}
                </div>

                <div className="mt-2 text-xs text-gray-500">
                  {r.started_at ? `started: ${new Date(r.started_at).toLocaleTimeString()} ` : ''}
                  {r.completed_at ? `completed: ${new Date(r.completed_at).toLocaleTimeString()}` : ''}
                  {typeof r.fare_amount_iqd === 'number' ? ` • fare: ${formatIQD(r.fare_amount_iqd)}` : ''}
                </div>
              </div>
            );
          })}

          {(rides.data ?? []).length === 0 && driver.data && !rides.isLoading ? (
            <div className="text-sm text-gray-500">No rides yet.</div>
          ) : null}
          {!driver.data ? <div className="text-sm text-gray-500">Create a driver profile first.</div> : null}
        </div>
      </div>

      {safetyRide ? (
        <SafetyToolkitModal
          open={!!safetyRide}
          onClose={() => setSafetyRide(null)}
          rideId={safetyRide.id}
          rideStatus={safetyRide.status}
        />
      ) : null}

      <RideCheckModal
        open={ridecheckOpen}
        onClose={() => setRidecheckOpen(false)}
        rideId={activeRide?.id ?? null}
        event={ridecheckEvent}
        onResolved={() => qc.invalidateQueries({ queryKey: ['ridecheck_open_driver', activeRide?.id] })}
      />

      {pinOpen && pinRide ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white shadow-xl border border-gray-200">
            <div className="p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-base font-semibold">{t('safety.pickupPin.driverTitle')}</div>
                  <div className="mt-1 text-sm text-gray-600">{t('safety.pickupPin.driverHint')}</div>
                </div>
                <button
                  className="btn"
                  onClick={() => {
                    setPinOpen(false);
                    setPendingTransition(null);
                  }}
                  disabled={pinBusy}
                >
                  {t('common.close')}
                </button>
              </div>

              <div className="mt-4">
                <div className="label">{t('safety.pickupPin.enter')}</div>
                <input
                  className="input mt-2 text-center tracking-widest text-xl"
                  inputMode="numeric"
                  maxLength={4}
                  value={pinValue}
                  onChange={(e) => setPinValue(e.target.value.replace(/\D/g, '').slice(0, 4))}
                  placeholder="••••"
                />
              </div>

              {pinToast ? <div className="mt-3 rounded-xl border p-3 text-sm bg-white">{pinToast}</div> : null}

              <div className="mt-4 flex gap-2">
                <button className="btn btn-primary" disabled={pinBusy || pinValue.trim().length < 4} onClick={verifyPin}>
                  {pinBusy ? t('common.loading') : t('safety.pickupPin.verify')}
                </button>
                <button
                  className="btn"
                  disabled={pinBusy}
                  onClick={() => {
                    setPinOpen(false);
                    setPendingTransition(null);
                  }}
                >
                  {t('common.cancel')}
                </button>
              </div>

              <div className="mt-3 text-xs text-gray-500">
                {t('safety.pickupPin.driverModalHint')}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {cashOpen && cashRide ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white shadow-xl border border-gray-200">
            <div className="p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-base font-semibold">Cash collection</div>
                  <div className="mt-1 text-sm text-gray-600">Enter the cash received and change given to complete this ride.</div>
                </div>
                <button
                  className="btn"
                  onClick={() => {
                    setCashOpen(false);
                    setCashRide(null);
                  }}
                  disabled={cashBusy}
                >
                  {t('common.close')}
                </button>
              </div>

              <div className="mt-4 space-y-3">
                <div>
                  <div className="label">Collected (IQD)</div>
                  <input
                    className="input mt-2"
                    inputMode="numeric"
                    value={cashCollected}
                    onChange={(e) => setCashCollected(e.target.value.replace(/[^0-9]/g, '').slice(0, 10))}
                    placeholder="e.g. 10000"
                  />
                </div>
                <div>
                  <div className="label">Change given (IQD)</div>
                  <input
                    className="input mt-2"
                    inputMode="numeric"
                    value={cashChange}
                    onChange={(e) => setCashChange(e.target.value.replace(/[^0-9]/g, '').slice(0, 10))}
                    placeholder="0"
                  />
                </div>

                <div className="text-xs text-gray-500">
                  Expected fare: {formatIQD(((cashRide as any).cash_expected_amount_iqd ?? cashRide.fare_amount_iqd ?? 0) as number)}
                </div>
              </div>

              {cashToast ? <div className="mt-3 rounded-xl border p-3 text-sm bg-white">{cashToast}</div> : null}

              <div className="mt-4 flex gap-2">
                <button className="btn btn-primary" disabled={cashBusy || !cashCollected.trim()} onClick={submitCashAndComplete}>
                  {cashBusy ? t('common.loading') : 'Complete ride'}
                </button>
                <button
                  className="btn"
                  disabled={cashBusy}
                  onClick={() => {
                    setCashOpen(false);
                    setCashRide(null);
                  }}
                >
                  {t('common.cancel')}
                </button>
              </div>

              <div className="mt-3 text-xs text-gray-500">
                Net collected = collected - change. The net must be at least the expected fare.
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <div className="label">{label}</div>
      <input className="input" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  );
}

function Pill({ label }: { label: string }) {
  return <div className="text-xs rounded-full bg-gray-100 border border-gray-200 px-2 py-1">{label}</div>;
}
