import React from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabaseClient';
import { invokeEdge } from '../lib/edgeInvoke';
import { errorText } from '../lib/errors';

type RideCheckEvent = {
  id: string;
  ride_id: string;
  kind: string;
  status: string;
  created_at?: string;
  metadata?: Record<string, unknown> | null;
};

type Props = {
  open: boolean;
  event: RideCheckEvent | null;
  rideId: string | null;
  onClose: () => void;
  onResolved?: () => void;
};

async function getUid(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const uid = data.session?.user.id;
  if (!uid) throw new Error('Not authenticated');
  return uid;
}

async function getGeolocation(): Promise<{ lat: number; lng: number } | null> {
  if (!('geolocation' in navigator)) return null;
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 15000 },
    );
  });
}

function kindTitle(t: (k: string) => string, kind: string) {
  if (kind === 'gps_stale') return t('safety.ridecheck.kinds.gpsStale');
  if (kind === 'long_stop') return t('safety.ridecheck.kinds.longStop');
  if (kind === 'route_deviation') return t('safety.ridecheck.kinds.routeDeviation');
  return t('safety.ridecheck.kinds.generic');
}

export default function RideCheckModal({ open, event, rideId, onClose, onResolved }: Props) {
  const { t } = useTranslation();
  const [busy, setBusy] = React.useState(false);
  const [toast, setToast] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) {
      setToast(null);
      setBusy(false);
    }
  }, [open]);

  if (!open || !event || !rideId) return null;

  const title = kindTitle(t, event.kind);

  const respond = async (response: 'ok' | 'false_alarm' | 'need_help') => {
    setBusy(true);
    setToast(null);
    try {
      await getUid();

      const { data } = await invokeEdge<any>('ridecheck-respond', { event_id: event.id, response });

      // If user asks for help, trigger the SOS workflow too.
      if (response === 'need_help') {
        const geo = await getGeolocation();
        try {
          await invokeEdge<any>('safety-sos', { ride_id: rideId, lat: geo?.lat, lng: geo?.lng });
        } catch (sosErr) {
          // Don't fail the ridecheck response; just surface a message.
          setToast(`${t('safety.ridecheck.sosFailed')}: ${errorText(sosErr)}`);
        }
      }

      if (data?.status === 'resolved' || data?.status === 'escalated') {
        onResolved?.();
      }

      setToast(t('safety.ridecheck.thanks'));
      onClose();
    } catch (e: unknown) {
      setToast(`${t('common.error')}: ${errorText(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-xl border border-gray-200">
        <div className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-base font-semibold">{t('safety.ridecheck.title')}</div>
              <div className="mt-1 text-sm text-gray-600">{title}</div>
            </div>
            <button className="btn" onClick={onClose} disabled={busy}>{t('common.close')}</button>
          </div>

          <div className="mt-4 rounded-xl border bg-white p-3">
            <div className="text-sm text-gray-700">{t('safety.ridecheck.prompt')}</div>
            <div className="mt-1 text-xs text-gray-500">{t('safety.ridecheck.promptHint')}</div>
          </div>

          {toast ? <div className="mt-3 rounded-xl border p-3 text-sm bg-white">{toast}</div> : null}

          <div className="mt-4 grid grid-cols-1 gap-2">
            <button className="btn btn-primary" disabled={busy} onClick={() => respond('ok')}>
              {t('safety.ridecheck.actions.ok')}
            </button>
            <button className="btn" disabled={busy} onClick={() => respond('false_alarm')}>
              {t('safety.ridecheck.actions.falseAlarm')}
            </button>
            <button className="btn btn-danger" disabled={busy} onClick={() => respond('need_help')}>
              {t('safety.ridecheck.actions.needHelp')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
