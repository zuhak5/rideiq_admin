import React from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';
import { getFareQuote } from '../lib/fareQuote';
import { errorText } from '../lib/errors';
import { formatIQD } from '../lib/money';
import QuoteBreakdownCard, { type QuoteBreakdown } from '../components/QuoteBreakdownCard';
import { useTranslation } from 'react-i18next';
import { invokeEdge } from '../lib/edgeInvoke';
import SafetyToolkitModal from '../components/SafetyToolkitModal';
import RideCheckModal from '../components/RideCheckModal';
import { MapView, type LatLng, type MapMarker, type MapCircle, type MapPolyline } from '../components/maps/MapView';
import type { MapsProvider } from '../lib/mapsConfig';
import { geoReverse, geoRoute } from '../lib/geo';
import { GeoSearchInput } from '../components/geo/GeoSearchInput';
import { voiceCallCreateForRide } from '../lib/voiceCalls';
import LiveActivitySimulator from '../components/LiveActivitySimulator';

type RideRequestRow = {
  id: string;
  status: string;
  assigned_driver_id: string | null;
  pickup_address: string | null;
  dropoff_address: string | null;
  pickup_lat: number;
  pickup_lng: number;
  dropoff_lat: number;
  dropoff_lng: number;
  created_at: string;
  matched_at: string | null;
  match_deadline: string | null;
  accepted_at: string | null;
  cancelled_at: string | null;
  quote_amount_iqd: number | null;
  currency: string | null;
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
  paid_at: string | null;
  pickup_pin_required?: boolean | null;
  pickup_pin_verified_at?: string | null;
  driver_id: string | null;
};

type RideCheckEventRow = {
  id: string;
  ride_id: string;
  kind: string;
  status: string;
  created_at: string;
  metadata: Record<string, unknown> | null;
};

async function getUid(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  if (!data.user?.id) throw new Error('Not signed in');
  return data.user.id;
}

async function fetchRequests(): Promise<RideRequestRow[]> {
  const { data, error } = await supabase
    .from('ride_requests')
    .select(
      'id,status,assigned_driver_id,pickup_address,dropoff_address,pickup_lat,pickup_lng,dropoff_lat,dropoff_lng,created_at,matched_at,match_deadline,accepted_at,cancelled_at,quote_amount_iqd,currency',
    )
    .order('created_at', { ascending: false })
    .limit(10);
  if (error) throw error;
  return data as RideRequestRow[];
}

async function fetchRides(): Promise<RideRow[]> {
  const { data, error } = await supabase
    .from('rides')
    .select('id,request_id,status,version,created_at,started_at,completed_at,fare_amount_iqd,currency,paid_at,pickup_pin_required,pickup_pin_verified_at,driver_id')
    .neq('status', 'completed')
    .neq('status', 'canceled')
    .order('created_at', { ascending: false });
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

export default function RiderPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const nav = useNavigate();
  const [busy, setBusy] = React.useState(false);
  const [callBusy, setCallBusy] = React.useState(false);
  const [toast, setToast] = React.useState<string | null>(null);
  const [safetyOpen, setSafetyOpen] = React.useState(false);
  const [mode, setMode] = React.useState<'now' | 'scheduled'>('now');
  const [scheduledAtLocal, setScheduledAtLocal] = React.useState('');

  const [pinBusy, setPinBusy] = React.useState(false);
  const [pickupPin, setPickupPin] = React.useState<string | null>(null);
  const [pickupPinToast, setPickupPinToast] = React.useState<string | null>(null);

  const [ridecheckOpen, setRidecheckOpen] = React.useState(false);

  const [nowMs, setNowMs] = React.useState(() => Date.now());

  React.useEffect(() => {
    const t = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  const { data: requests, error, isLoading } = useQuery({
    queryKey: ['ride_requests'],
    queryFn: fetchRequests,
  });

  const rides = useQuery({
    queryKey: ['rides_rider'],
    queryFn: fetchRides,
  });

  const [pickupLat, setPickupLat] = React.useState('');
  const [pickupLng, setPickupLng] = React.useState('');
  const [dropoffLat, setDropoffLat] = React.useState('');
  const [dropoffLng, setDropoffLng] = React.useState('');
  const [productCode, setProductCode] = React.useState<'standard' | 'premium' | 'family' | 'women_only'>('standard');
  const [paymentMethod, setPaymentMethod] = React.useState<'wallet' | 'cash'>('cash');
  const [preferFemaleDriver, setPreferFemaleDriver] = React.useState(false);
  const effectivePreferFemale = preferFemaleDriver || productCode === 'women_only';
  const preferences = React.useMemo(
    () => (effectivePreferFemale ? { preferred_driver_gender: 'female' } : {}),
    [effectivePreferFemale],
  );

  const [pickupAddress, setPickupAddress] = React.useState('');
  const [dropoffAddress, setDropoffAddress] = React.useState('');
  const [previewRequestId, setPreviewRequestId] = React.useState<string | null>(null);

  const [mapPickMode, setMapPickMode] = React.useState<'pickup' | 'dropoff'>('pickup');
  const [previewRadiusM, setPreviewRadiusM] = React.useState<number>(5000);

  // Active renderer (google/mapbox) as decided by MapView's DB-driven fallback.
  const [rendererProvider, setRendererProvider] = React.useState<MapsProvider | null>(null);

  const pickupPos = React.useMemo<LatLng | null>(() => {
    const lat = Number(pickupLat);
    const lng = Number(pickupLng);
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  }, [pickupLat, pickupLng]);

  const dropoffPos = React.useMemo<LatLng | null>(() => {
    const lat = Number(dropoffLat);
    const lng = Number(dropoffLng);
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  }, [dropoffLat, dropoffLng]);

  const mapCenter = pickupPos ?? dropoffPos ?? { lat: 33.3152, lng: 44.3661 };

  const reverseReqId = React.useRef(0);

  const nearbyDrivers = useQuery({
    queryKey: ['drivers_nearby', previewRequestId, pickupLat, pickupLng, previewRadiusM],
    enabled: Boolean(pickupPos),
    queryFn: async () => {
      if (!pickupPos) return [];
      const args = previewRequestId
        ? { p_request_id: previewRequestId, p_radius_m: previewRadiusM, p_stale_after_s: 120 }
        : { p_pickup_lat: pickupPos.lat, p_pickup_lng: pickupPos.lng, p_radius_m: previewRadiusM, p_stale_after_s: 120 };

      const { data, error } = await supabase.rpc('drivers_nearby_user_v1', args as any);
      if (error) throw error;
      const res = data as any;
      if (!res || res.ok === false) return [];
      return (res.drivers ?? []) as Array<any>;
    },
    staleTime: 5_000,
  });

  const mapMarkers = React.useMemo<MapMarker[]>(() => {
    const ms: MapMarker[] = [];
    if (pickupPos) ms.push({ id: 'pickup', position: pickupPos, label: 'P', title: 'Pickup' });
    if (dropoffPos) ms.push({ id: 'dropoff', position: dropoffPos, label: 'D', title: 'Dropoff' });

    for (const d of nearbyDrivers.data ?? []) {
      if (typeof d?.lat === 'number' && typeof d?.lng === 'number') {
        ms.push({
          id: `driver:${d.id}`,
          position: { lat: d.lat, lng: d.lng },
          label: 'T',
          title: d.vehicle_type ? `Driver (${d.vehicle_type})` : 'Driver',
        });
      }
    }

    return ms;
  }, [pickupPos, dropoffPos, nearbyDrivers.data]);

  const mapCircles = React.useMemo<MapCircle[]>(() => {
    if (!pickupPos) return [];
    return [{ id: 'pickup-radius', center: pickupPos, radiusMeters: previewRadiusM }];
  }, [pickupPos, previewRadiusM]);

  const routePreview = useQuery({
    queryKey: ['route_preview', pickupLat, pickupLng, dropoffLat, dropoffLng, rendererProvider],
    enabled: Boolean(pickupPos && dropoffPos),
    queryFn: async () => {
      if (!pickupPos || !dropoffPos) return null;
      return geoRoute(pickupPos, dropoffPos, { renderer: rendererProvider });
    },
    staleTime: 30_000,
  });

  const mapPolylines = React.useMemo<MapPolyline[]>(() => {
    const geom = routePreview.data?.route?.geometry;
    if (!geom || geom.type !== 'LineString') return [];
    const path = (geom.coordinates ?? [])
      .filter((c) => Array.isArray(c) && c.length >= 2)
      .map((c) => ({ lng: c[0], lat: c[1] }))
      .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
    if (path.length < 2) return [];
    return [{ id: 'route_preview', path, kind: 'route' }];
  }, [routePreview.data]);

  const onMapClick = React.useCallback(
    (pos: LatLng) => {
      const current = ++reverseReqId.current;

      if (mapPickMode === 'pickup') {
        setPickupLat(String(pos.lat));
        setPickupLng(String(pos.lng));
      } else {
        setDropoffLat(String(pos.lat));
        setDropoffLng(String(pos.lng));
      }

      // Best-effort reverse geocode in Arabic for Iraq.
      void (async () => {
        try {
          const res = await geoReverse(pos, { renderer: rendererProvider, limit: 1, language: 'ar', region: 'IQ' });
          if (current !== reverseReqId.current) return;
          const label = res?.[0]?.label;
          if (typeof label === 'string' && label.trim()) {
            if (mapPickMode === 'pickup') setPickupAddress(label);
            else setDropoffAddress(label);
          }
        } catch {
          // Ignore reverse lookup failures.
        }
      })();
    },
    [mapPickMode, rendererProvider],
  );

  // Sync the map preview inputs with an existing ride request (so "Nearby drivers" matches what you are about to dispatch).
  const setPickupFromRequest = React.useCallback((rr: RideRequestRow) => {
    if (typeof rr?.pickup_lat === 'number' && typeof rr?.pickup_lng === 'number') {
      setPickupLat(String(rr.pickup_lat));
      setPickupLng(String(rr.pickup_lng));
    }
    if (typeof rr?.dropoff_lat === 'number' && typeof rr?.dropoff_lng === 'number') {
      setDropoffLat(String(rr.dropoff_lat));
      setDropoffLng(String(rr.dropoff_lng));
    }
    if (typeof rr?.pickup_address === 'string') setPickupAddress(rr.pickup_address);
    if (typeof rr?.dropoff_address === 'string') setDropoffAddress(rr.dropoff_address);
    setPreviewRequestId(typeof rr?.id === 'string' ? rr.id : null);
    setMapPickMode('pickup');
  }, []);


  const [serviceArea, setServiceArea] = React.useState<{ id: string; name: string } | null>(null);
  const [serviceAreaStatus, setServiceAreaStatus] = React.useState<string>('');


  // Resolve pickup point -> service area (multi-city readiness)
  React.useEffect(() => {
    let alive = true;
    const lat = Number(pickupLat);
    const lng = Number(pickupLng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      setServiceArea(null);
      setServiceAreaStatus('Enter valid pickup coordinates.');
      return;
    }

    (async () => {
      const { data, error } = await supabase.rpc('resolve_service_area', { p_lat: lat, p_lng: lng });
      if (!alive) return;
      if (error) {
        setServiceArea(null);
        setServiceAreaStatus('Unable to resolve service area.');
        return;
      }
      const row = Array.isArray(data) ? data[0] : null;
      if (row?.id && row?.name) {
        setServiceArea({ id: row.id as string, name: row.name as string });
        setServiceAreaStatus(`Service area: ${row.name}`);
      } else {
        setServiceArea(null);
        setServiceAreaStatus('Pickup is outside supported service areas.');
      }
    })();

    return () => {
      alive = false;
    };
  }, [pickupLat, pickupLng]);

  const quote = useQuery({
    queryKey: ['quote_breakdown', pickupLat, pickupLng, dropoffLat, dropoffLng, productCode, serviceArea?.id],
    enabled: Boolean(serviceArea?.id),
    queryFn: async (): Promise<QuoteBreakdown | null> => {
      const pl = Number(pickupLat);
      const pg = Number(pickupLng);
      const dl = Number(dropoffLat);
      const dg = Number(dropoffLng);
      if (![pl, pg, dl, dg].every((n) => Number.isFinite(n))) return null;

      const resp = await getFareQuote({
        pickup_lat: pl,
        pickup_lng: pg,
        dropoff_lat: dl,
        dropoff_lng: dg,
        product_code: productCode,
      });

      return resp.quote ?? null;
    },
  });


  React.useEffect(() => {
    let reqSub: RealtimeChannel | null = null;
    let rideSub: RealtimeChannel | null = null;
    let cancelled = false;

    (async () => {
      try {
        const uid = await getUid();
        if (cancelled) return;

        // Only subscribe to rows belonging to this rider.
        reqSub = supabase
          .channel('rider-ride-requests')
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'ride_requests', filter: `rider_id=eq.${uid}` },
            () => qc.invalidateQueries({ queryKey: ['ride_requests'] }),
          )
          .subscribe();

        rideSub = supabase
          .channel('rider-rides')
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'rides', filter: `rider_id=eq.${uid}` },
            () => qc.invalidateQueries({ queryKey: ['rides_rider'] }),
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

  const activeRide = (rides.data ?? [])[0] ?? null;

  const startDriverCall = React.useCallback(async () => {
    if (!activeRide?.id) return;
    setCallBusy(true);
    setToast(null);
    try {
      const created = await voiceCallCreateForRide({ rideId: activeRide.id, provider: 'auto' });
      nav(`/voice-call/${created.call.id}`);
    } catch (e: unknown) {
      setToast(`Call error: ${errorText(e)}`);
    } finally {
      setCallBusy(false);
    }
  }, [activeRide?.id, nav]);

  const ridecheckQ = useQuery({
    queryKey: ['ridecheck_open', activeRide?.id],
    enabled: !!activeRide?.id,
    queryFn: () => fetchRidecheckOpen(activeRide!.id),
  });

  React.useEffect(() => {
    if (!activeRide?.id) return;
    const ch = supabase
      .channel(`ridecheck-rider-${activeRide.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'ridecheck_events', filter: `ride_id=eq.${activeRide.id}` },
        () => qc.invalidateQueries({ queryKey: ['ridecheck_open', activeRide.id] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [qc, activeRide?.id]);

  const ridecheckEvent = ridecheckQ.data ?? null;

  React.useEffect(() => {
    if (ridecheckEvent && ridecheckEvent.status === 'open') {
      setRidecheckOpen(true);
    }
  }, [ridecheckEvent]);

  const revealPickupPin = async () => {
    if (!activeRide?.id) return;
    setPinBusy(true);
    setPickupPinToast(null);
    try {
      const res = await invokeEdge<{ required: boolean; verified?: boolean; pin?: string }>('ride-pickup-pin', {
        ride_id: activeRide.id,
      });
      if (!res.data?.required) {
        setPickupPinToast(t('safety.pickupPin.notRequired'));
        setPickupPin(null);
      } else if (res.data?.verified) {
        setPickupPinToast(t('safety.pickupPin.alreadyVerified'));
        setPickupPin(null);
      } else {
        setPickupPin(res.data.pin ?? null);
      }
    } catch (e: unknown) {
      setPickupPinToast(errorText(e));
    } finally {
      setPinBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      {activeRide && (
        <div className="mb-6">
          <div className="text-sm text-gray-500 mb-2">Simulated Lock Screen:</div>
          <LiveActivitySimulator
            rideStatus={activeRide.status}
            driverName={activeRide.driver_id ? 'Ali' : null} // In real app, fetch driver name
            vehicle="Toyota Camry" // In real app, fetch vehicle
            etaMinutes={activeRide.status === 'in_progress' ? 12 : 5}
          />
        </div>
      )}

      <div className="card p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-base font-semibold">Request a ride</div>
            <div className="text-sm text-gray-500 mt-1">Create a request, then trigger matching.</div>
          </div>

          <button
            className="btn"
            disabled={busy}
            onClick={() => {
              if (!navigator.geolocation) {
                setToast('Geolocation not available in this browser.');
                return;
              }
              setBusy(true);
              setToast(null);
              navigator.geolocation.getCurrentPosition(
                (pos) => {
                  setPickupLat(String(pos.coords.latitude));
                  setPickupLng(String(pos.coords.longitude));
                  setToast('Pickup set to your current location.');
                  setBusy(false);
                },
                (err) => {
                  setToast(`Geolocation error: ${err.message}`);
                  setBusy(false);
                },
                { enableHighAccuracy: true, timeout: 10000 },
              );
            }}
          >
            Use my pickup
          </button>
        </div>

        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          <GeoSearchInput
            label="موقع الالتقاط"
            value={pickupAddress}
            renderer={rendererProvider}
            placeholder="ابحث عن موقع الالتقاط"
            onChange={setPickupAddress}
            onSelect={(r) => {
              setPickupAddress(r.label);
              setPickupLat(String(r.location.lat));
              setPickupLng(String(r.location.lng));
            }}
          />

          <GeoSearchInput
            label="موقع الوصول"
            value={dropoffAddress}
            renderer={rendererProvider}
            placeholder="ابحث عن موقع الوصول"
            onChange={setDropoffAddress}
            onSelect={(r) => {
              setDropoffAddress(r.label);
              setDropoffLat(String(r.location.lat));
              setDropoffLng(String(r.location.lng));
            }}
          />

          <Field label="Pickup lat" value={pickupLat} onChange={setPickupLat} type="number" step="0.000001" />
          <Field label="Pickup lng" value={pickupLng} onChange={setPickupLng} type="number" step="0.000001" />

          <Field label="Dropoff lat" value={dropoffLat} onChange={setDropoffLat} type="number" step="0.000001" />
          <Field label="Dropoff lng" value={dropoffLng} onChange={setDropoffLng} type="number" step="0.000001" />
        </div>

        <div className="mt-5 rounded-2xl border border-gray-200 bg-white p-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-sm font-semibold">Map</div>
              <div className="text-xs text-gray-500">
                Click the map to set the <span className="font-medium">{mapPickMode}</span> location.
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <label className="text-xs text-gray-600">Set</label>
              <select
                className="input w-36"
                value={mapPickMode}
                onChange={(e) => setMapPickMode(e.target.value as 'pickup' | 'dropoff')}
              >
                <option value="pickup">Pickup</option>
                <option value="dropoff">Dropoff</option>
              </select>

              <label className="text-xs text-gray-600">Radius (m)</label>
              <input
                className="input w-32"
                type="number"
                min={100}
                step={50}
                value={previewRadiusM}
                onChange={(e) => setPreviewRadiusM(Math.max(100, Number(e.target.value) || 0))}
              />

              <button className="btn" type="button" disabled={!pickupPos || nearbyDrivers.isFetching} onClick={() => nearbyDrivers.refetch()}>
                Refresh drivers
              </button>
            </div>
          </div>

          <div className="mt-3">
            <MapView
              className="h-[360px] w-full overflow-hidden rounded-2xl"
              center={mapCenter}
              zoom={pickupPos ? 14 : 12}
              markers={mapMarkers}
              circles={mapCircles}
              polylines={mapPolylines}
              onMapClick={onMapClick}
              onProviderChange={setRendererProvider}
            />
          </div>

          <div className="mt-2 text-xs text-gray-600">
            Route preview:{' '}
            {!pickupPos || !dropoffPos
              ? '— set pickup and dropoff.'
              : routePreview.isFetching
                ? 'loading...'
                : routePreview.data
                  ? `${routePreview.data.provider} • ${Math.round((routePreview.data.route.distance_meters ?? 0) / 10) / 100} km • ${Math.round((routePreview.data.route.duration_seconds ?? 0) / 60)} min${routePreview.data.cache_hit ? ' (cache)' : ''}`
                  : 'unavailable'}
          </div>

          <div className="mt-2 text-xs text-gray-600">
            Nearby drivers: <span className="font-medium">{pickupPos ? (nearbyDrivers.data?.length ?? 0) : '—'}</span>
            {nearbyDrivers.isFetching ? ' (refreshing...)' : ''}
            {!pickupPos ? ' — set a pickup point on the map to preview.' : ''}
          </div>
        </div>

        {serviceAreaStatus ? (
          <div className={`mt-3 text-sm ${serviceArea ? 'text-emerald-700' : 'text-rose-700'}`}>{serviceAreaStatus}</div>
        ) : null}

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <div className="flex rounded-2xl border border-gray-200 overflow-hidden">
            <button
              className={mode === 'now' ? 'px-4 py-2 text-sm bg-gray-900 text-white' : 'px-4 py-2 text-sm bg-white'}
              onClick={() => setMode('now')}
              type="button"
            >
              Now
            </button>
            <button
              className={mode === 'scheduled' ? 'px-4 py-2 text-sm bg-gray-900 text-white' : 'px-4 py-2 text-sm bg-white'}
              onClick={() => setMode('scheduled')}
              type="button"
            >
              Schedule for later
            </button>
          </div>

          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="label">{t('rideType.label')}</label>
              <select
                className="input"
                value={productCode}
                onChange={(e) => {
                  const v = e.target.value as 'standard' | 'premium' | 'family' | 'women_only';
                  setProductCode(v);
                  if (v === 'women_only') setPreferFemaleDriver(true);
                }}
              >
                <option value="standard">{t('rideType.standard')}</option>
                <option value="family">{t('rideType.family')}</option>
                <option value="women_only">{t('rideType.womenOnly')}</option>
              </select>
            </div>
            <div className="flex items-center gap-3">
              <input
                id="preferFemale"
                type="checkbox"
                className="h-4 w-4"
                checked={effectivePreferFemale}
                disabled={productCode === 'women_only'}
                onChange={(e) => setPreferFemaleDriver(e.target.checked)}
              />
              <label htmlFor="preferFemale" className="text-sm text-gray-700">
                {t('prefs.preferFemale')}
              </label>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3 w-full">
            <div>
              <label className="label">Payment method</label>
              <select
                className="input"
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value as 'wallet' | 'cash')}
              >
                <option value="cash">Cash</option>
                <option value="wallet">Wallet</option>
              </select>
            </div>
            <div className="text-sm text-gray-500 flex items-center">
              Cash: pay the driver directly. Wallet: requires sufficient in-app balance.
            </div>
          </div>

          {quote.isLoading ? (
            <div className="w-full mt-3 text-sm text-gray-500">{t('buttons.loadingQuote')}</div>
          ) : quote.data ? (
            <div className="w-full mt-3">
              <QuoteBreakdownCard quote={quote.data} />
            </div>
          ) : serviceArea?.id ? (
            <div className="w-full mt-3 text-sm text-gray-500">Quote unavailable (check coordinates).</div>
          ) : null}

          {mode === 'scheduled' ? (
            <div className="flex items-center gap-2">
              <label className="text-sm text-gray-600">Date & time</label>
              <input
                className="input"
                type="datetime-local"
                value={scheduledAtLocal}
                onChange={(e) => setScheduledAtLocal(e.target.value)}
              />
              <div className="text-xs text-gray-500">Min 5 minutes • Max 14 days</div>
            </div>
          ) : null}
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            className="btn btn-primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setToast(null);
              try {
                const { data: u } = await supabase.auth.getUser();
                const uid = u.user?.id;
                if (!uid) throw new Error('Not authenticated');
                if (mode === 'scheduled') {
                  if (!scheduledAtLocal) throw new Error('Please select a date & time');
                  const whenIso = new Date(scheduledAtLocal).toISOString();
                  await invokeEdge('scheduled-ride-create', {
                    pickup_address: pickupAddress,
                    dropoff_address: dropoffAddress,
                    pickup_lat: Number(pickupLat),
                    pickup_lng: Number(pickupLng),
                    dropoff_lat: Number(dropoffLat),
                    dropoff_lng: Number(dropoffLng),
                    product_code: productCode,
                    preferences,
                    payment_method: paymentMethod,
                    scheduled_at: whenIso,
                  });
                  setToast('Scheduled ride created.');
                  qc.invalidateQueries({ queryKey: ['scheduled_rides'] });
                } else {
                  if (!serviceArea?.id) {
                    setToast('Pickup is outside supported service areas.');
                    return;
                  }

                  // Always create the request with an auditable fare_quote_id produced by the fare engine.
                  const quoteResp = await getFareQuote({
                    pickup_lat: Number(pickupLat),
                    pickup_lng: Number(pickupLng),
                    dropoff_lat: Number(dropoffLat),
                    dropoff_lng: Number(dropoffLng),
                    product_code: productCode,
                  });
                  if (!quoteResp?.quote_id) {
                    throw new Error('Unable to compute fare quote');
                  }
                  const totalIqd = Number((quoteResp.quote as any)?.total_iqd ?? 0);
                  if (!Number.isFinite(totalIqd) || totalIqd <= 0) {
                    throw new Error('Invalid fare quote');
                  }

                  const { error } = await supabase.from('ride_requests').insert({
                    rider_id: uid,
                    pickup_address: pickupAddress,
                    dropoff_address: dropoffAddress,
                    pickup_lat: Number(pickupLat),
                    pickup_lng: Number(pickupLng),
                    service_area_id: (quoteResp.quote as any)?.service_area_id ?? serviceArea.id,
                    dropoff_lat: Number(dropoffLat),
                    dropoff_lng: Number(dropoffLng),
                    product_code: productCode,
                    preferences,
                    currency: 'IQD',
                    fare_quote_id: quoteResp.quote_id,
                    quote_amount_iqd: Math.trunc(totalIqd),
                    payment_method: paymentMethod,
                  });
                  if (error) throw error;
                  setToast('Ride request created.');
                  qc.invalidateQueries({ queryKey: ['ride_requests'] });
                }
              } catch (e: unknown) {
                setToast(`Error: ${errorText(e)}`);
              } finally {
                setBusy(false);
              }
            }}
          >
            {t('buttons.create')}
          </button>        </div>

        {toast && <div className="mt-3 text-sm text-gray-700">{toast}</div>}
      </div>

      <div className="card p-5">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-base font-semibold">Your requests</div>
            <div className="text-sm text-gray-500 mt-1">Matching + cancellation are per request.</div>
          </div>
          <button className="btn" onClick={() => qc.invalidateQueries({ queryKey: ['ride_requests'] })}>
            Refresh
          </button>
        </div>

        {isLoading && <div className="mt-4 text-sm text-gray-500">Loading…</div>}
        {error && <div className="mt-4 text-sm text-red-600">{errorText(error)}</div>}

        <div className="mt-4 space-y-3">
          {(requests ?? []).map((rr) => {
            const deadlineMs = rr.match_deadline ? new Date(rr.match_deadline).getTime() : null;
            const secondsLeft = deadlineMs ? Math.max(0, Math.floor((deadlineMs - nowMs) / 1000)) : null;
            const expiresLabel =
              secondsLeft === null ? null : secondsLeft > 0 ? `expires in ${secondsLeft}s` : 'expired';
            const matchActive = rr.status === 'matched' && secondsLeft !== null && secondsLeft > 0;
            const canMatch =
              rr.status === 'requested' ||
              rr.status === 'no_driver' ||
              rr.status === 'expired' ||
              (rr.status === 'matched' && !matchActive);
            const canCancel = ['requested', 'matched', 'no_driver', 'expired'].includes(rr.status);

            return (
              <div key={rr.id} className="border border-gray-200 rounded-2xl p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm font-semibold">
                    {rr.pickup_address ?? 'Pickup'} → {rr.dropoff_address ?? 'Dropoff'}
                  </div>
                  <div className="text-xs text-gray-500">{new Date(rr.created_at).toLocaleString()}</div>
                </div>

                <div className="mt-2 flex flex-wrap gap-2 items-center">
                  <Pill label={`status: ${rr.status}`} />
                  {typeof rr.quote_amount_iqd === 'number' && (
                    <Pill label={`quote: ${formatIQD(rr.quote_amount_iqd)}`} />
                  )}
                  {rr.assigned_driver_id && <Pill label={`driver: ${rr.assigned_driver_id.slice(0, 8)}…`} />}
                  {rr.matched_at && <Pill label={`matched: ${new Date(rr.matched_at).toLocaleTimeString()}`} />}
                  {expiresLabel && rr.status !== 'requested' && <Pill label={expiresLabel} />}
                  {rr.accepted_at && <Pill label={`accepted: ${new Date(rr.accepted_at).toLocaleTimeString()}`} />}
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    className="btn"
                    disabled={busy}
                    onClick={() => setPickupFromRequest(rr)}
                    title="Preview nearby drivers for this request's pickup on the map"
                  >
                    Preview pickup
                  </button>
                  <button
                    className="btn btn-primary"
                    disabled={busy || !canMatch}
                    title={matchActive ? 'A driver is already matched. Wait for acceptance or expiry.' : undefined}
                    onClick={async () => {
                      setPickupFromRequest(rr);
                      setBusy(true);
                      setToast(null);
                      try {
                        const { data } = await invokeEdge<unknown>('match-ride', { request_id: rr.id, radius_m: previewRadiusM, limit_n: 20 });
                        setToast(`Match result: ${JSON.stringify(data)}`);
                        qc.invalidateQueries({ queryKey: ['ride_requests'] });
                      } catch (e: unknown) {
                        setToast(`Error: ${errorText(e)}`);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    {matchActive ? 'Matched' : 'Find driver'}
                  </button>

                  <button
                    className="btn"
                    disabled={busy || !canCancel}
                    onClick={async () => {
                      setBusy(true);
                      setToast(null);
                      try {
                        // Fix: Atomic cancellation via RPC
                        const { data, error } = await supabase.rpc('cancel_ride_request', { p_request_id: rr.id });

                        if (error) throw error;

                        // Cast response since rpc types might be loose
                        const res = data as { ok: boolean; error?: string; message?: string } | null;

                        if (!res || !res.ok) {
                          if (res?.error === 'cannot_cancel') {
                            setToast(res.message ?? 'Cannot cancel: Ride may be established.');
                          } else {
                            setToast(t('common.error') + (res?.error ? `: ${res.error}` : ''));
                          }
                        } else {
                          setToast('Cancelled.');
                          qc.invalidateQueries({ queryKey: ['ride_requests'] });
                        }
                      } catch (e: unknown) {
                        setToast(`Error: ${errorText(e)}`);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            );
          })}

          {(requests ?? []).length === 0 && !isLoading && <div className="text-sm text-gray-500">No requests yet.</div>}
        </div>
      </div>

      <div className="card p-5">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-base font-semibold">Your rides</div>
            <div className="text-sm text-gray-500 mt-1">Updates live when a driver accepts or progresses the trip.</div>
          </div>
          <button className="btn" onClick={() => qc.invalidateQueries({ queryKey: ['rides_rider'] })}>
            Refresh
          </button>
        </div>

        {rides.isLoading && <div className="mt-4 text-sm text-gray-500">Loading…</div>}
        {rides.error && <div className="mt-4 text-sm text-red-600">{errorText(rides.error)}</div>}

        {activeRide ? (
          <div className="mt-4 border border-gray-200 rounded-2xl p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm font-semibold">Ride {activeRide.id.slice(0, 8)}…</div>
              <div className="flex items-center gap-2">
                <button className="btn btn-primary" disabled={callBusy} onClick={() => void startDriverCall()}>
                  Call driver
                </button>
                <button className="btn" onClick={() => setSafetyOpen(true)}>
                  {t('safety.open')}
                </button>
                <Pill label={`status: ${activeRide.status}`} />
                <Pill label={`v${activeRide.version}`} />
              </div>
            </div>
            <div className="mt-2 text-xs text-gray-500">Created {new Date(activeRide.created_at).toLocaleString()}</div>
            <div className="mt-2 text-xs text-gray-500">
              {activeRide.started_at ? `started: ${new Date(activeRide.started_at).toLocaleTimeString()} ` : ''}
              {activeRide.completed_at ? `completed: ${new Date(activeRide.completed_at).toLocaleTimeString()}` : ''}
              {activeRide.fare_amount_iqd != null
                ? ` • fare: ${formatIQD(activeRide.fare_amount_iqd)}`
                : ''}
              {activeRide.paid_at ? ` • paid: ${new Date(activeRide.paid_at).toLocaleTimeString()}` : ''}
            </div>

            {ridecheckEvent ? (
              <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4">
                <div className="flex items-start justify-between gap-3">
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

            {activeRide.pickup_pin_required && !activeRide.pickup_pin_verified_at ? (
              <div className="mt-4 rounded-2xl border border-gray-200 bg-gray-50 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold">{t('safety.pickupPin.title')}</div>
                    <div className="text-xs text-gray-600 mt-1">{t('safety.pickupPin.hint')}</div>
                  </div>
                  <button className="btn" disabled={pinBusy} onClick={revealPickupPin}>
                    {pickupPin ? t('safety.pickupPin.refresh') : t('safety.pickupPin.reveal')}
                  </button>
                </div>

                {pickupPin ? <div className="mt-3 text-3xl font-bold tracking-widest">{pickupPin}</div> : null}
                {pickupPinToast ? <div className="mt-2 text-xs text-gray-700">{pickupPinToast}</div> : null}
              </div>
            ) : activeRide.pickup_pin_required && activeRide.pickup_pin_verified_at ? (
              <div className="mt-4 rounded-2xl border border-gray-200 bg-green-50 p-4">
                <div className="text-sm font-semibold">{t('safety.pickupPin.verifiedTitle')}</div>
                <div className="text-xs text-gray-700 mt-1">{t('safety.pickupPin.verifiedHint')}</div>
              </div>
            ) : null}


            {activeRide.status === 'completed' ? (
              <div className="mt-4 rounded-2xl border border-gray-200 bg-gray-50 p-4">
                <div className="text-sm font-semibold">Payment</div>
                <div className="text-xs text-gray-600 mt-1">
                  Completed rides are settled automatically from your wallet balance.
                  You can view the ledger in <span className="font-semibold">Wallet → Transactions</span>.
                </div>
                {!activeRide.paid_at ? (
                  <div className="text-xs text-amber-800 mt-2">
                    Settlement is pending. If this persists, refresh and check your wallet balance.
                  </div>
                ) : (
                  <div className="text-xs text-gray-600 mt-2">Paid at {new Date(activeRide.paid_at).toLocaleString()}</div>
                )}
              </div>
            ) : null}

            <div className="mt-3 text-sm text-gray-700">
              Rider UI is read-only for status progression in this MVP (driver progresses the trip).
            </div>
          </div>
        ) : (
          <div className="mt-4 text-sm text-gray-500">No rides yet.</div>
        )}
      </div>

      {activeRide ? (
        <SafetyToolkitModal
          open={safetyOpen}
          onClose={() => setSafetyOpen(false)}
          rideId={activeRide.id}
          rideStatus={activeRide.status}
        />
      ) : null}

      {activeRide ? (
        <RideCheckModal
          open={ridecheckOpen}
          onClose={() => setRidecheckOpen(false)}
          rideId={activeRide.id}
          event={ridecheckEvent}
        />
      ) : null}
    </div>
  );
}


function Field({
  label,
  value,
  onChange,
  type = 'text',
  step,
  placeholder,
  inputRef,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: 'text' | 'number';
  step?: string;
  placeholder?: string;
  inputRef?: React.Ref<HTMLInputElement>;
}) {
  return (
    <div>
      <div className="label">{label}</div>
      <input
        ref={inputRef}
        className="input"
        type={type}
        step={step}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

function Pill({ label }: { label: string }) {
  return <div className="text-xs rounded-full bg-gray-100 border border-gray-200 px-2 py-1">{label}</div>;
}
