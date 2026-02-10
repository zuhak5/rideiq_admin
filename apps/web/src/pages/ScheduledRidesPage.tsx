import React from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { invokeEdge } from '../lib/edgeInvoke';
import { supabase } from '../lib/supabaseClient';
import { getFareQuote } from '../lib/fareQuote';
import { errorText } from '../lib/errors';
import { debounce } from '../lib/debounce';
import QuoteBreakdownCard, { type QuoteBreakdown } from '../components/QuoteBreakdownCard';
import { useTranslation } from 'react-i18next';

async function getUid(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  if (!data.user) throw new Error('Not signed in');
  return data.user.id;
}

type ScheduledRide = {
  id: string;
  pickup_lat: number;
  pickup_lng: number;
  dropoff_lat: number;
  dropoff_lng: number;
  pickup_address: string | null;
  dropoff_address: string | null;
  product_code: string;
  scheduled_at: string;
  status: 'pending' | 'cancelled' | 'executed' | 'failed';
  ride_request_id: string | null;
  failure_reason: string | null;
};

function asNum(v: string): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export default function ScheduledRidesPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [toast, setToast] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const [pickupLat, setPickupLat] = React.useState('33.3152');
  const [pickupLng, setPickupLng] = React.useState('44.3661');
  const [dropoffLat, setDropoffLat] = React.useState('33.3128');
  const [dropoffLng, setDropoffLng] = React.useState('44.3615');
  const [pickupAddress, setPickupAddress] = React.useState<string>('');
  const [dropoffAddress, setDropoffAddress] = React.useState<string>('');

  const [productCode, setProductCode] = React.useState<'standard' | 'premium' | 'family' | 'women_only'>('standard');
  const [preferFemaleDriver, setPreferFemaleDriver] = React.useState(false);
  const effectivePreferFemale = preferFemaleDriver || productCode === 'women_only';
  const preferences = React.useMemo(
    () => (effectivePreferFemale ? { preferred_driver_gender: 'female' } : {}),
    [effectivePreferFemale],
  );


  const [serviceArea, setServiceArea] = React.useState<{ id: string; name: string } | null>(null);
  const [serviceAreaStatus, setServiceAreaStatus] = React.useState<string>('');

  const quote = useQuery({
    queryKey: ['scheduled_quote_breakdown', pickupLat, pickupLng, dropoffLat, dropoffLng, productCode, serviceArea?.id],
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

  const [scheduledAt, setScheduledAt] = React.useState<string>(() => {
    const d = new Date(Date.now() + 10 * 60 * 1000);
    // datetime-local expects local time without Z; keep it simple.
    const pad = (x: number) => String(x).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
      d.getMinutes(),
    )}`;
  });

  const q = useQuery({
    queryKey: ['scheduled_rides'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('scheduled_ride_list_user_v1', { p_limit: 200 });
      if (error) throw error;
      const res = data as any;
      if (res && res.ok === false) {
        throw new Error(String(res.error ?? 'Failed to fetch scheduled rides'));
      }
      return (res?.scheduled_rides ?? []) as ScheduledRide[];
    },
  });

  const invalidateScheduledRides = React.useMemo(
    () =>
      debounce(() => {
        void qc.invalidateQueries({ queryKey: ['scheduled_rides'] });
      }, 300),
    [qc],
  );

  // Live updates (requires scheduled_rides in the supabase_realtime publication).
  React.useEffect(() => {
    let sub: RealtimeChannel | null = null;
    let cancelled = false;

    (async () => {
      try {
        const uid = await getUid();
        if (cancelled) return;

        sub = supabase
          .channel('scheduled-rides')
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'scheduled_rides', filter: `rider_id=eq.${uid}` },
            () => invalidateScheduledRides(),
          )
          .subscribe();
      } catch {
        // ignore
      }
    })();

    return () => {
      cancelled = true;
      if (sub) supabase.removeChannel(sub);
    };
  }, [invalidateScheduledRides]);

  async function createScheduledRide() {
    setToast(null);
    const pl = asNum(pickupLat);
    const pg = asNum(pickupLng);
    const dl = asNum(dropoffLat);
    const dg = asNum(dropoffLng);
    if (pl == null || pg == null || dl == null || dg == null) {
      setToast('Please enter valid numeric coordinates.');
      return;
    }

    if (!serviceArea?.id) {
      setToast('Pickup is outside supported service areas.');
      return;
    }

    const when = new Date(scheduledAt);
    if (Number.isNaN(when.getTime())) {
      setToast('Please choose a valid scheduled time.');
      return;
    }

    setBusy(true);
    try {
      await invokeEdge('scheduled-ride-create', {
        pickup_lat: pl,
        pickup_lng: pg,
        dropoff_lat: dl,
        dropoff_lng: dg,
        pickup_address: pickupAddress || null,
        dropoff_address: dropoffAddress || null,
        product_code: productCode || 'standard',
        preferences,
        scheduled_at: when.toISOString(),
      });
      setToast('Scheduled ride created.');
      qc.invalidateQueries({ queryKey: ['scheduled_rides'] });
    } catch (e) {
      setToast(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function cancelScheduledRide(id: string) {
    setToast(null);
    setBusy(true);
    try {
      await invokeEdge('scheduled-ride-cancel', { id });
      setToast('Cancelled.');
      qc.invalidateQueries({ queryKey: ['scheduled_rides'] });
    } catch (e) {
      setToast(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <h1 className="text-xl font-semibold">Scheduled Rides</h1>

      {toast ? <div className="rounded-md border p-3 text-sm bg-white">{toast}</div> : null}

      <div className="rounded-xl border bg-white p-4 space-y-3">
        <div className="font-medium">Create a scheduled ride</div>

        <div className="grid md:grid-cols-2 gap-3">
          <label className="text-sm">
            Pickup address (optional)
            <input
              className="mt-1 w-full rounded-md border px-3 py-2"
              value={pickupAddress}
              onChange={(e) => setPickupAddress(e.target.value)}
              placeholder="e.g., Karrada, Baghdad"
            />
          </label>

          <label className="text-sm">
            Dropoff address (optional)
            <input
              className="mt-1 w-full rounded-md border px-3 py-2"
              value={dropoffAddress}
              onChange={(e) => setDropoffAddress(e.target.value)}
              placeholder="e.g., Mansour, Baghdad"
            />
          </label>

          <label className="text-sm">
            Pickup lat
            <input
              className="mt-1 w-full rounded-md border px-3 py-2"
              value={pickupLat}
              onChange={(e) => setPickupLat(e.target.value)}
            />
          </label>

          <label className="text-sm">
            Pickup lng
            <input
              className="mt-1 w-full rounded-md border px-3 py-2"
              value={pickupLng}
              onChange={(e) => setPickupLng(e.target.value)}
            />
          </label>

          <label className="text-sm">
            Dropoff lat
            <input
              className="mt-1 w-full rounded-md border px-3 py-2"
              value={dropoffLat}
              onChange={(e) => setDropoffLat(e.target.value)}
            />
          </label>

          <label className="text-sm">
            Dropoff lng
            <input
              className="mt-1 w-full rounded-md border px-3 py-2"
              value={dropoffLng}
              onChange={(e) => setDropoffLng(e.target.value)}
            />
          </label>

          <label className="text-sm">
            {t('rideType.label')}
            <select
              className="mt-1 w-full rounded-md border px-3 py-2 bg-white"
              value={productCode}
              onChange={(e) => {
                const v = e.target.value as 'standard' | 'premium' | 'family' | 'women_only';
                setProductCode(v);
                if (v === 'women_only') setPreferFemaleDriver(true);
              }}
            >
              <option value="standard">{t('rideType.standard')}</option>
              <option value="premium">{t('rideType.premium')}</option>
              <option value="family">{t('rideType.family')}</option>
              <option value="women_only">{t('rideType.womenOnly')}</option>
            </select>
          </label>

          <label className="text-sm flex items-center gap-2">
            <input
              type="checkbox"
              checked={effectivePreferFemale}
              disabled={productCode === 'women_only'}
              onChange={(e) => setPreferFemaleDriver(e.target.checked)}
            />
            {t('prefs.preferFemale')}
          </label>

          <label className="text-sm">
            Scheduled time
            <input
              type="datetime-local"
              className="mt-1 w-full rounded-md border px-3 py-2"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
            />
          </label>
        </div>

        {quote.isLoading ? (
          <div className="text-sm text-gray-500">{t('buttons.loadingQuote')}</div>
        ) : quote.data ? (
          <QuoteBreakdownCard quote={quote.data} />
        ) : serviceArea?.id ? (
          <div className="text-sm text-gray-500">Quote unavailable (check coordinates).</div>
        ) : null}

        <div className={`text-sm ${serviceArea ? 'text-emerald-700' : 'text-rose-700'}`}>{serviceAreaStatus}</div>

        <button
          className="rounded-md border px-3 py-2 bg-black text-white disabled:opacity-50"
          onClick={createScheduledRide}
          disabled={busy}
        >
          {t('buttons.createScheduled')}
        </button>
        <div className="text-xs text-gray-500">
          The system will automatically create a normal ride request when the scheduled time is reached.
        </div>
      </div>

      <div className="rounded-xl border bg-white p-4">
        <div className="font-medium mb-3">Your scheduled rides</div>

        {q.isLoading ? <div className="text-sm text-gray-600">Loading…</div> : null}
        {q.error ? <div className="text-sm text-red-700">{errorText(q.error)}</div> : null}

        <div className="space-y-2">
          {(q.data ?? []).map((r) => (
            <div key={r.id} className="rounded-lg border p-3 flex items-start justify-between gap-3">
              <div className="text-sm">
                <div className="font-medium">
                  {new Date(r.scheduled_at).toLocaleString()} — <span className="capitalize">{r.status}</span>
                </div>
                <div className="text-gray-600">
                  {r.pickup_address || `${r.pickup_lat.toFixed(4)}, ${r.pickup_lng.toFixed(4)}`} →{' '}
                  {r.dropoff_address || `${r.dropoff_lat.toFixed(4)}, ${r.dropoff_lng.toFixed(4)}`}
                </div>
                {r.status === 'failed' && r.failure_reason ? (
                  <div className="text-red-700 mt-1">Failed: {r.failure_reason}</div>
                ) : null}
                {r.ride_request_id ? <div className="text-gray-600 mt-1">Ride request: {r.ride_request_id}</div> : null}
              </div>

              {r.status === 'pending' ? (
                <button
                  className="rounded-md border px-3 py-2 text-sm"
                  disabled={busy}
                  onClick={() => cancelScheduledRide(r.id)}
                >
                  Cancel
                </button>
              ) : null}
            </div>
          ))}

          {(q.data?.length ?? 0) === 0 && !q.isLoading ? (
            <div className="text-sm text-gray-600">No scheduled rides yet.</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
