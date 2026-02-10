import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';
import { errorText } from '../lib/errors';

type ContactRow = {
  id: string;
  user_id: string;
  name: string;
  phone: string;
  relationship: string | null;
  is_active: boolean;
  created_at: string;
};

type SafetySettingsRow = {
  user_id: string;
  auto_share_on_trip_start: boolean;
  auto_notify_on_sos: boolean;
  default_share_ttl_minutes: number;
  pin_verification_mode: 'off' | 'every_ride' | 'night_only';
};

async function getUid(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const uid = data.session?.user.id;
  if (!uid) throw new Error('Not authenticated');
  return uid;
}

async function fetchContacts(): Promise<ContactRow[]> {
  const uid = await getUid();
  const { data, error } = await supabase
    .from('trusted_contacts')
    .select('id,user_id,name,phone,relationship,is_active,created_at')
    .eq('user_id', uid)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data as ContactRow[]) ?? [];
}

async function fetchSettings(): Promise<SafetySettingsRow> {
  const uid = await getUid();
  const { data, error } = await supabase
    .from('user_safety_settings')
    .select('user_id,auto_share_on_trip_start,auto_notify_on_sos,default_share_ttl_minutes,pin_verification_mode')
    .eq('user_id', uid)
    .maybeSingle();
  if (error) throw error;

  const rawPinMode = data?.pin_verification_mode;
  const pinMode: SafetySettingsRow['pin_verification_mode'] =
    rawPinMode === 'off' || rawPinMode === 'every_ride' || rawPinMode === 'night_only'
      ? rawPinMode
      : 'off';

  // Default values if the row does not exist yet.
  return {
    user_id: uid,
    auto_share_on_trip_start: !!data?.auto_share_on_trip_start,
    auto_notify_on_sos: data?.auto_notify_on_sos ?? true,
    default_share_ttl_minutes: typeof data?.default_share_ttl_minutes === 'number' ? data.default_share_ttl_minutes : 120,
    pin_verification_mode: pinMode,
  };
}

function clampInt(v: string, min: number, max: number, fallback: number) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

export default function SafetyContactsPage() {
  const qc = useQueryClient();
  const { t } = useTranslation();

  const contactsQ = useQuery({ queryKey: ['safety_contacts'], queryFn: fetchContacts });
  const settingsQ = useQuery({ queryKey: ['safety_settings'], queryFn: fetchSettings });

  const [toast, setToast] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const [name, setName] = React.useState('');
  const [phone, setPhone] = React.useState('');
  const [relationship, setRelationship] = React.useState('');
  const [active, setActive] = React.useState(true);

  const [autoShare, setAutoShare] = React.useState(false);
  const [autoNotify, setAutoNotify] = React.useState(true);
  const [ttl, setTtl] = React.useState('120');
  const [pinMode, setPinMode] = React.useState<'off' | 'every_ride' | 'night_only'>('off');

  React.useEffect(() => {
    if (!settingsQ.data) return;
    setAutoShare(settingsQ.data.auto_share_on_trip_start);
    setAutoNotify(settingsQ.data.auto_notify_on_sos);
    setTtl(String(settingsQ.data.default_share_ttl_minutes ?? 120));
    setPinMode(settingsQ.data.pin_verification_mode ?? 'off');
  }, [settingsQ.data]);

  const contacts = contactsQ.data ?? [];
  const activeCount = contacts.filter((c) => c.is_active).length;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="text-sm font-semibold">{t('safety.contacts.title')}</div>
            <div className="text-xs text-gray-500 mt-1">{t('safety.contacts.desc')}</div>
          </div>
          <Link to="/rider" className="btn">{t('common.back')}</Link>
        </div>

        {toast ? <div className="mt-3 rounded-xl border p-3 text-sm bg-white">{toast}</div> : null}

        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="text-sm">
            <div className="flex items-center justify-between">
              <span>{t('safety.settings.autoShare')}</span>
              <input type="checkbox" checked={autoShare} onChange={(e) => setAutoShare(e.target.checked)} />
            </div>
            <div className="text-xs text-gray-500 mt-1">{t('safety.settings.autoShareHint')}</div>
          </label>

          <label className="text-sm">
            <div className="flex items-center justify-between">
              <span>{t('safety.settings.autoNotify')}</span>
              <input type="checkbox" checked={autoNotify} onChange={(e) => setAutoNotify(e.target.checked)} />
            </div>
            <div className="text-xs text-gray-500 mt-1">{t('safety.settings.autoNotifyHint')}</div>
          </label>

          <label className="text-sm">
            {t('safety.settings.ttl')}
            <input className="input mt-2" value={ttl} onChange={(e) => setTtl(e.target.value)} />
            <div className="text-xs text-gray-500 mt-1">{t('safety.settings.ttlHint')}</div>
          </label>

          <label className="text-sm">
            <div className="label">{t('safety.settings.pinMode')}</div>
            <select
              className="input mt-2"
              value={pinMode}
              onChange={(e) => setPinMode(e.target.value as SafetySettingsRow['pin_verification_mode'])}
            >
              <option value="off">{t('safety.settings.pinModeOff')}</option>
              <option value="every_ride">{t('safety.settings.pinModeEveryRide')}</option>
              <option value="night_only">{t('safety.settings.pinModeNightOnly')}</option>
            </select>
            <div className="text-xs text-gray-500 mt-1">{t('safety.settings.pinModeHint')}</div>
          </label>

          <div className="flex items-end">
            <button
              className="btn btn-primary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setToast(null);
                try {
                  const uid = await getUid();
                  const ttlNum = clampInt(ttl, 5, 1440, 120);
                  const { error } = await supabase.from('user_safety_settings').upsert(
                    {
                      user_id: uid,
                      auto_share_on_trip_start: autoShare,
                      auto_notify_on_sos: autoNotify,
                      default_share_ttl_minutes: ttlNum,
                      pin_verification_mode: pinMode,
                    },
                    { onConflict: 'user_id' },
                  );
                  if (error) throw error;
                  setToast(t('common.saved'));
                  await qc.invalidateQueries({ queryKey: ['safety_settings'] });
                } catch (e: unknown) {
                  setToast(`${t('common.error')}: ${errorText(e)}`);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {t('common.save')}
            </button>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="text-sm font-semibold">{t('safety.contacts.listTitle')}</div>
            <div className="text-xs text-gray-500 mt-1">
              {t('safety.contacts.activeCount', { count: activeCount })}
            </div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 md:grid-cols-4 gap-3">
          <Field label={t('safety.contacts.name')} value={name} onChange={setName} />
          <Field label={t('safety.contacts.phone')} value={phone} onChange={setPhone} />
          <Field label={t('safety.contacts.relationship')} value={relationship} onChange={setRelationship} />
          <label className="text-sm">
            {t('safety.contacts.active')}
            <div className="mt-2">
              <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            </div>
          </label>
        </div>

        <div className="mt-3">
          <button
            className="btn"
            disabled={busy || !name.trim() || !phone.trim()}
            onClick={async () => {
              setBusy(true);
              setToast(null);
              try {
                const uid = await getUid();
                const { error } = await supabase.from('trusted_contacts').insert({
                  user_id: uid,
                  name: name.trim(),
                  phone: phone.trim(),
                  relationship: relationship.trim() ? relationship.trim() : null,
                  is_active: active,
                });
                if (error) throw error;
                setName('');
                setPhone('');
                setRelationship('');
                setActive(true);
                await qc.invalidateQueries({ queryKey: ['safety_contacts'] });
                setToast(t('common.added'));
              } catch (e: unknown) {
                const msg = errorText(e);
                if (msg.includes('max_active_trusted_contacts')) {
                  setToast(t('safety.contacts.maxActive'));
                } else {
                  setToast(`${t('common.error')}: ${msg}`);
                }
              } finally {
                setBusy(false);
              }
            }}
          >
            {t('common.add')}
          </button>
        </div>

        <div className="mt-4 space-y-2">
          {contactsQ.isLoading ? <div className="text-sm text-gray-500">{t('common.loading')}</div> : null}
          {contactsQ.error ? <div className="text-sm text-red-600">{t('common.error')}: {errorText(contactsQ.error)}</div> : null}

          <div className="rounded-2xl border border-gray-200 bg-white p-4 flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold">{t('safety.contacts.testTitle')}</div>
            <div className="text-xs text-gray-500 mt-1">{t('safety.contacts.testHint')}</div>
          </div>
        </div>

{contacts.map((c) => (
            <div key={c.id} className="rounded-2xl border border-gray-200 bg-white p-4 flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold">{c.name}</div>
                <div className="text-xs text-gray-500">{c.phone}{c.relationship ? ` • ${c.relationship}` : ''}</div>
              </div>

              <div className="flex items-center gap-2">
                <label className="text-xs text-gray-600 flex items-center gap-2">
                  {t('safety.contacts.active')}
                  <input
                    type="checkbox"
                    checked={c.is_active}
                    disabled={busy}
                    onChange={async (e) => {
                      setBusy(true);
                      setToast(null);
                      try {
                        const { error } = await supabase.from('trusted_contacts').update({ is_active: e.target.checked }).eq('id', c.id);
                        if (error) throw error;
                        await qc.invalidateQueries({ queryKey: ['safety_contacts'] });
                      } catch (err: unknown) {
                        const msg = errorText(err);
                        if (msg.includes('max_active_trusted_contacts')) {
                          setToast(t('safety.contacts.maxActive'));
                        } else {
                          setToast(`${t('common.error')}: ${msg}`);
                        }
                      } finally {
                        setBusy(false);
                      }
                    }}
                  />
                </label>

<button
                  className="btn"
                  disabled={busy}
                  onClick={async () => {
                    const ok = window.confirm(t('common.confirmDelete'));
                    if (!ok) return;
                    setBusy(true);
                    setToast(null);
                    try {
                      const { error } = await supabase.from('trusted_contacts').delete().eq('id', c.id);
                      if (error) throw error;
                      await qc.invalidateQueries({ queryKey: ['safety_contacts'] });
                      setToast(t('common.deleted'));
                    } catch (e: unknown) {
                      setToast(`${t('common.error')}: ${errorText(e)}`);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {t('common.delete')}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="text-sm">
      {label}
      <input className="input mt-2" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}
