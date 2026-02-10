import React from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { errorText } from '../lib/errors';
import { supabase } from '../lib/supabaseClient';
import { MapView, type LatLng, type MapMarker } from '../components/maps/MapView';

type ShareResponse = {
  ok?: boolean;
  token_mode?: 'hash' | 'token' | 'legacy_token';
  ride?: {
    id: string;
    status: string;
    created_at: string;
    started_at?: string | null;
    completed_at?: string | null;
    fare_amount_iqd?: number | null;
    currency?: string | null;
  };
  request?: {
    id: string;
    status: string;
    pickup: { lat: number; lng: number; address?: string | null };
    dropoff: { lat: number; lng: number; address?: string | null };
    product_code?: string | null;
    service_area_id?: string | null;
    matched_at?: string | null;
    accepted_at?: string | null;
  } | null;
  driver?: { id: string } | null;
  vehicle?: {
    make: string | null;
    model: string | null;
    color: string | null;
    vehicle_type: string | null;
    capacity?: number | null;
    plate_suffix: string | null;
  } | null;
  location?: {
    lat: number;
    lng: number;
    updated_at: string;
  } | null;
  error?: string;
};

const POLL_MS = 10000; // update marker every ~10s without "refreshing" the page

function mapsLink(lat: number, lng: number) {
  return `https://www.google.com/maps?q=${encodeURIComponent(`${lat},${lng}`)}`;
}

function isValidLatLng(x: unknown): x is LatLng {
  const v = x as any;
  const lat = Number(v?.lat);
  const lng = Number(v?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return false;
  // Treat (0,0) as "unset" in our app flows
  if (lat === 0 && lng === 0) return false;
  return true;
}

async function fetchShare(token: string): Promise<ShareResponse> {
  const tk = (token ?? '').trim();
  if (!tk) throw new Error('missing_token');

  const { data, error } = await supabase.rpc('trip_share_view_public_v1', { p_token: tk });
  if (error) throw error;

  const res = data as any;
  if (res?.ok === false) {
    const msg = typeof res?.error === 'string' && res.error ? res.error : 'not_found';
    throw new Error(msg);
  }
  return (res ?? {}) as ShareResponse;
}

function sameLocation(a?: ShareResponse['location'] | null, b?: ShareResponse['location'] | null) {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return a.updated_at === b.updated_at && a.lat === b.lat && a.lng === b.lng;
}

export default function ShareTripPage() {
  const { t } = useTranslation();
  const { token } = useParams();
  const [data, setData] = React.useState<ShareResponse | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const [initialLoading, setInitialLoading] = React.useState(true);
  const [updating, setUpdating] = React.useState(false);
  const [mapCenter, setMapCenter] = React.useState<LatLng | null>(null);

  const tk = (token ?? '').trim();

  // Initial load (one-time)
  React.useEffect(() => {
    let mounted = true;

    const runInitial = async () => {
      if (!tk) {
        setErr('missing_token');
        setInitialLoading(false);
        return;
      }

      setInitialLoading(true);
      try {
        const r = await fetchShare(tk);
        if (!mounted) return;
        setData(r);
        setErr(null);
      } catch (e: unknown) {
        if (!mounted) return;
        setErr(errorText(e));
      } finally {
        if (mounted) setInitialLoading(false);
      }
    };

    void runInitial();

    return () => {
      mounted = false;
    };
  }, [tk]);

  // Lightweight polling: update only location (+ minimal status fields), do NOT flip the page into "loading"
  React.useEffect(() => {
    if (!tk) return;

    let mounted = true;

    const tick = async () => {
      if (!mounted) return;
      if (document.visibilityState !== 'visible') return;

      setUpdating(true);
      try {
        const r = await fetchShare(tk);
        if (!mounted) return;

        setData((prev) => {
          if (!prev) return r;

          const next: ShareResponse = {
            ...prev,
            ride: prev.ride
              ? {
                  ...prev.ride,
                  status: r.ride?.status ?? prev.ride.status,
                  started_at: r.ride?.started_at ?? prev.ride.started_at,
                  completed_at: r.ride?.completed_at ?? prev.ride.completed_at,
                }
              : r.ride,
            request: prev.request
              ? {
                  ...prev.request,
                  status: r.request?.status ?? prev.request.status,
                }
              : r.request ?? prev.request,
            driver: r.driver ?? prev.driver,
            vehicle: r.vehicle ?? prev.vehicle,
            location: sameLocation(prev.location, r.location) ? prev.location : r.location,
          };

          return next;
        });

        setErr(null);
      } catch {
        // Keep last good data.
      } finally {
        if (mounted) setUpdating(false);
      }
    };

    const id = window.setInterval(() => void tick(), POLL_MS);
    return () => {
      mounted = false;
      window.clearInterval(id);
    };
  }, [tk]);

  const pickup = data?.request?.pickup;
  const dropoff = data?.request?.dropoff;
  const driverLoc = data?.location;

  const pickupPos = React.useMemo(() => (isValidLatLng(pickup) ? (pickup as LatLng) : null), [pickup]);
  const dropoffPos = React.useMemo(
    () => (isValidLatLng(dropoff) ? (dropoff as LatLng) : null),
    [dropoff],
  );
  const driverPos = React.useMemo(
    () => (isValidLatLng(driverLoc) ? ({ lat: driverLoc!.lat, lng: driverLoc!.lng } as LatLng) : null),
    [driverLoc],
  );

  const centerCandidate: LatLng | null = driverPos ?? pickupPos ?? dropoffPos ?? null;

  // Set the map center once (no constant re-centering/panning).
  React.useEffect(() => {
    if (!mapCenter && centerCandidate) setMapCenter(centerCandidate);
  }, [mapCenter, centerCandidate]);

  const markers: MapMarker[] = React.useMemo(() => {
    const out: MapMarker[] = [];
    if (pickupPos) out.push({ id: 'pickup', position: pickupPos, label: 'P', title: 'Pickup' });
    if (dropoffPos) out.push({ id: 'dropoff', position: dropoffPos, label: 'D', title: 'Dropoff' });
    // IMPORTANT: driver marker uses blue car icon via MapView; no label so it doesn't overlap the icon.
    if (driverPos) out.push({ id: 'driver', position: driverPos, title: 'Driver' });
    return out;
  }, [pickupPos, dropoffPos, driverPos]);

  const openMapsTarget = driverPos ?? pickupPos ?? null;

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-2xl mx-auto space-y-3">
        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm flex items-start justify-between gap-3">
          <div>
            <div className="text-base font-semibold">{t('share.title', 'Trip Share')}</div>
            <div className="text-xs text-gray-500 mt-1">{t('share.subtitle', 'Live location updates without requiring an account')}</div>
          </div>
          {openMapsTarget ? (
            <a className="btn" href={mapsLink(openMapsTarget.lat, openMapsTarget.lng)} target="_blank" rel="noreferrer">
              {t('share.openMaps', 'Open in Maps')}
            </a>
          ) : null}
        </div>

        {initialLoading ? (
          <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm text-sm text-gray-600">
            {t('share.loading', 'Loading…')}
          </div>
        ) : err ? (
          <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm text-sm text-red-600">
            {t('share.error', 'Error')}: {err}
          </div>
        ) : data?.ride ? (
          <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold">
                  {t('share.ride', 'Ride')} {data.ride.id.slice(0, 8)}…
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  {t('share.status', 'Status')}: {data.ride.status}
                </div>
                <div className="text-xs text-gray-500">
                  {t('share.created', 'Created')}: {new Date(data.ride.created_at).toLocaleString()}
                </div>
              </div>

              <div className="text-xs text-gray-500">
                {updating ? t('share.updating', 'Updating location…') : t('share.live', 'Live')}
              </div>
            </div>

            {mapCenter ? (
              <div className="rounded-xl border border-gray-200 overflow-hidden">
                <MapView center={mapCenter} zoom={14} markers={markers} className="h-72 w-full" />
              </div>
            ) : (
              <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm text-gray-600">
                {t('share.noMapData', 'No location to display yet.')}
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="rounded-xl border border-gray-200 p-3">
                <div className="text-xs text-gray-500">{t('share.pickup', 'Pickup')}</div>
                <div className="text-sm font-medium mt-1">
                  {pickupPos ? `${pickupPos.lat.toFixed(5)}, ${pickupPos.lng.toFixed(5)}` : '—'}
                </div>
                {pickup?.address ? <div className="text-xs text-gray-500 mt-1">{pickup.address}</div> : null}
              </div>
              <div className="rounded-xl border border-gray-200 p-3">
                <div className="text-xs text-gray-500">{t('share.dropoff', 'Dropoff')}</div>
                <div className="text-sm font-medium mt-1">
                  {dropoffPos ? `${dropoffPos.lat.toFixed(5)}, ${dropoffPos.lng.toFixed(5)}` : '—'}
                </div>
                {dropoff?.address ? <div className="text-xs text-gray-500 mt-1">{dropoff.address}</div> : null}
              </div>
            </div>
          </div>
        ) : (
          <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm text-sm text-gray-600">
            {t('share.notFound', 'Not found')}
          </div>
        )}
      </div>
    </div>
  );
}
