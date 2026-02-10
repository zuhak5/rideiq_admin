import React from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';
import { errorText } from '../lib/errors';
import { invokeEdge } from '../lib/edgeInvoke';
import { buildShareUrl, buildTripShareMessage, copyToClipboard } from '../lib/tripShare';

type Props = {
  open: boolean;
  onClose: () => void;
  rideId: string;
  rideStatus: string;
};

type TrustedContact = {
  id: string;
  name: string;
  phone: string;
  relationship: string | null;
};

type SosResponse = {
  share?: { token?: string };
  trusted_contacts?: TrustedContact[];
};

export default function SafetyToolkitModal({ open, onClose, rideId, rideStatus }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [busy, setBusy] = React.useState(false);
  const [toast, setToast] = React.useState<string | null>(null);
  const [shareUrl, setShareUrl] = React.useState<string | null>(null);
  const [ttlMinutes, setTtlMinutes] = React.useState<number>(120);

  const [trustedContacts, setTrustedContacts] = React.useState<TrustedContact[]>([]);

  const [reportCategory, setReportCategory] = React.useState<string>('safety');
  const [reportSeverity, setReportSeverity] = React.useState<'low' | 'medium' | 'high' | 'critical'>('high');
  const [reportText, setReportText] = React.useState('');

  React.useEffect(() => {
    if (open) setToast(null);
  }, [open]);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!open) return;
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const uid = sessionData.session?.user?.id;
        if (!uid) return;
        const { data } = await supabase
          .from('trusted_contacts')
          .select('id,name,phone,relationship')
          .eq('user_id', uid)
          .eq('is_active', true)
          .order('created_at', { ascending: true })
          .limit(5);
        const contacts = (data ?? []) as TrustedContact[];
        if (!cancelled) setTrustedContacts(contacts);
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  if (!open) return null;

  const canUseSafetyTools = rideStatus !== 'completed' && rideStatus !== 'canceled' && rideStatus !== 'cancelled';
  const shareMessage = shareUrl ? buildTripShareMessage(shareUrl) : '';

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-xl rounded-2xl bg-white border border-gray-200 shadow-xl">
        <div className="p-4 border-b border-gray-200 flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold">{t('safety.title')}</div>
            <div className="text-xs text-gray-500 mt-1">{t('safety.subtitle')}</div>
          </div>
          <button className="btn" onClick={onClose} disabled={busy}>
            {t('safety.close')}
          </button>
        </div>

        <div className="p-4 space-y-4">
          {!canUseSafetyTools ? (
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">
              {t('safety.notAvailable')}
            </div>
          ) : null}

          {/* Share trip */}
          <section className="rounded-2xl border border-gray-200 p-4">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <div className="text-sm font-semibold">{t('safety.share.title')}</div>
                <div className="text-xs text-gray-500 mt-1">{t('safety.share.desc')}</div>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs text-gray-500">
                  <span className="mr-2">{t('safety.share.ttl')}</span>
                  <select
                    className="input"
                    value={ttlMinutes}
                    onChange={(e) => setTtlMinutes(Number(e.target.value))}
                    disabled={busy}
                  >
                    <option value={60}>1h</option>
                    <option value={120}>2h</option>
                    <option value={360}>6h</option>
                    <option value={1440}>24h</option>
                  </select>
                </label>
                <button
                  className="btn"
                  disabled={busy || !canUseSafetyTools}
                  onClick={async () => {
                    setBusy(true);
                    setToast(null);
                    try {
                      const { data, error } = await supabase.rpc('trip_share_create_user_v1', {
                        p_ride_id: rideId,
                        p_ttl_minutes: ttlMinutes,
                      });
                      if (error) throw error;
                      const res = data as any;
                      if (res?.ok === false) throw new Error(String(res.error ?? 'Failed to create share token'));
                      const token = res?.token;
                      if (!token) throw new Error('Missing share token');
                      const url = buildShareUrl(token);
                      setShareUrl(url);

                      // Prefer native share if available.
                      if (navigator.share) {
                        try {
                          await navigator.share({ title: 'RideIQ trip', text: 'Track my RideIQ trip', url });
                          setToast(t('safety.share.shared'));
                          return;
                        } catch {
                          // user cancelled
                        }
                      }

                      await copyToClipboard(url);
                      setToast(t('safety.share.copied'));
                    } catch (e: unknown) {
                      setToast(`${t('safety.error')}: ${errorText(e)}`);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {t('safety.share.create')}
                </button>
              </div>
            </div>

            {shareUrl ? (
              <div className="mt-3">
                <div className="text-xs text-gray-500 mb-1">{t('safety.share.link')}</div>
                <div className="flex gap-2 items-center flex-wrap">
                  <input className="input flex-1" value={shareUrl} readOnly />
                  <button
                    className="btn"
                    disabled={busy}
                    onClick={async () => {
                      try {
                        await copyToClipboard(shareUrl);
                        setToast(t('safety.share.copied'));
                      } catch (e: unknown) {
                        setToast(`${t('safety.error')}: ${errorText(e)}`);
                      }
                    }}
                  >
                    {t('safety.share.copy')}
                  </button>
                  <a className="btn" href={shareUrl} target="_blank" rel="noreferrer">
                    {t('safety.share.open')}
                  </a>
                </div>
              </div>
            ) : null}

            {shareUrl ? (
              <div className="mt-3 border-t border-gray-100 pt-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="text-xs font-semibold">{t('safety.contacts.title')}</div>
                  <button
                    className="btn"
                    onClick={() => {
                      onClose();
                      navigate('/safety/contacts');
                    }}
                  >
                    {t('safety.contacts.manage')}
                  </button>
                </div>
                <div className="mt-2 flex gap-2 flex-wrap">
                  <button
                    className="btn"
                    type="button"
                    onClick={() => {
                      void (async () => {
                        const ok = await copyToClipboard(shareMessage);
                        setToast(ok ? t('safety.share.copied') : 'Copy failed');
                        setTimeout(() => setToast(null), 2000);
                      })();
                    }}
                  >
                    {t('buttons.copy')}
                  </button>
                </div>

                {trustedContacts.length ? (
                  <div className="mt-3 space-y-2">
                    {trustedContacts.map((c) => (
                      <div key={c.id} className="flex items-center justify-between gap-3 rounded-2xl border border-gray-200 p-3">
                        <div>
                          <div className="text-sm font-medium">{c.name}</div>
                          <div className="text-xs text-gray-500">{c.phone}{c.relationship ? ` • ${c.relationship}` : ''}</div>
                        </div>
                        <a
                          className="btn"
                          href={`sms:${c.phone}?body=${encodeURIComponent(shareMessage)}`}
                        >
                          {t('safety.contacts.channelSMS')}
                        </a>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="mt-2 text-xs text-gray-500">{t('safety.contacts.none')}</div>
                )}
              </div>
            ) : null}
          </section>

          {/* SOS */}
          <section className="rounded-2xl border border-gray-200 p-4">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <div className="text-sm font-semibold">{t('safety.sos.title')}</div>
                <div className="text-xs text-gray-500 mt-1">{t('safety.sos.desc')}</div>
              </div>
              <button
                className="btn"
                style={{ background: '#ef4444', color: 'white' }}
                disabled={busy || !canUseSafetyTools}
                onClick={async () => {
                  const confirmed = window.confirm(t('safety.sos.confirm'));
                  if (!confirmed) return;
                  setBusy(true);
                  setToast(null);

                  try {
                    const payload: Record<string, unknown> = { ride_id: rideId };

                    // Best effort to attach current location.
                    if (navigator.geolocation) {
                      const loc = await new Promise<GeolocationPosition | null>((resolve) => {
                        navigator.geolocation.getCurrentPosition(
                          (pos) => resolve(pos),
                          () => resolve(null),
                          { enableHighAccuracy: true, timeout: 8000 },
                        );
                      });
                      if (loc) {
                        payload.lat = loc.coords.latitude;
                        payload.lng = loc.coords.longitude;
                      }
                    }

                    const { data } = await invokeEdge<SosResponse>('safety-sos', payload);
                    const token = data?.share?.token;
                    if (token) setShareUrl(buildShareUrl(String(token)));
                    const contacts = data?.trusted_contacts;
                    if (Array.isArray(contacts)) setTrustedContacts(contacts);
                    setToast(t('safety.sos.done'));
                  } catch (e: unknown) {
                    setToast(`${t('safety.error')}: ${errorText(e)}`);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {t('safety.sos.activate')}
              </button>
            </div>
          </section>

          {/* Report */}
          <section className="rounded-2xl border border-gray-200 p-4">
            <div className="text-sm font-semibold">{t('safety.report.title')}</div>
            <div className="text-xs text-gray-500 mt-1">{t('safety.report.desc')}</div>

            <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
              <label className="text-xs text-gray-500">
                <div className="mb-1">{t('safety.report.category')}</div>
                <select className="input" value={reportCategory} onChange={(e) => setReportCategory(e.target.value)} disabled={busy}>
                  <option value="safety">safety</option>
                  <option value="vehicle">vehicle</option>
                  <option value="behavior">behavior</option>
                  <option value="pricing">pricing</option>
                  <option value="other">other</option>
                </select>
              </label>
              <label className="text-xs text-gray-500">
                <div className="mb-1">{t('safety.report.severity')}</div>
                <select
                  className="input"
                  value={reportSeverity}
                  onChange={(e) => setReportSeverity(e.target.value as 'low' | 'medium' | 'high' | 'critical')}
                  disabled={busy}
                >
                  <option value="low">low</option>
                  <option value="medium">medium</option>
                  <option value="high">high</option>
                  <option value="critical">critical</option>
                </select>
              </label>
            </div>

            <label className="text-xs text-gray-500 mt-3 block">
              <div className="mb-1">{t('safety.report.details')}</div>
              <textarea
                className="input"
                rows={3}
                value={reportText}
                onChange={(e) => setReportText(e.target.value)}
                placeholder={t('safety.report.placeholder')}
                disabled={busy}
              />
            </label>

            <div className="mt-3 flex items-center justify-between gap-2 flex-wrap">
              <div className="text-xs text-gray-500">{t('safety.report.note')}</div>
              <button
                className="btn btn-primary"
                disabled={busy || !canUseSafetyTools || reportText.trim().length < 6}
                onClick={async () => {
                  setBusy(true);
                  setToast(null);
                  try {
                    const { data: u } = await supabase.auth.getUser();
                    const uid = u.user?.id;
                    if (!uid) throw new Error('Not authenticated');

                    const { error } = await supabase.from('ride_incidents').insert({
                      ride_id: rideId,
                      reporter_id: uid,
                      category: reportCategory,
                      severity: reportSeverity,
                      description: reportText.trim(),
                      status: 'open',
                    });
                    if (error) throw error;

                    setReportText('');
                    setToast(t('safety.report.sent'));
                  } catch (e: unknown) {
                    setToast(`${t('safety.error')}: ${errorText(e)}`);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {t('safety.report.send')}
              </button>
            </div>
          </section>

          {toast ? <div className="rounded-xl bg-black text-white px-3 py-2 text-sm">{toast}</div> : null}
        </div>
      </div>
    </div>
  );
}
