import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabaseClient';
import { setActiveRole } from '../lib/profile';
import { errorText } from '../lib/errors';

type MerchantType = 'restaurant' | 'grocery' | 'pharmacy' | 'services' | 'fleet' | 'other';

const TYPES: MerchantType[] = ['restaurant', 'grocery', 'pharmacy', 'services', 'fleet', 'other'];

export default function MerchantOnboardingPage() {
  const { t } = useTranslation();
  const nav = useNavigate();

  const [step, setStep] = React.useState(1);
  const [businessType, setBusinessType] = React.useState<MerchantType>('restaurant');
  const [businessName, setBusinessName] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  const backToRoleChooser = () => nav('/onboarding/role', { replace: true });

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      const { data: sess, error: sessErr } = await supabase.auth.getSession();
      if (sessErr) throw sessErr;
      const uid = sess.session?.user.id;
      if (!uid) throw new Error('Not signed in');

      if (!businessName.trim()) {
        throw new Error(t('merchant.validationName'));
      }

      // Use upsert on unique owner_profile_id.
      const { error } = await supabase.from('merchants').upsert(
        {
          owner_profile_id: uid,
          business_name: businessName.trim(),
          business_type: businessType,
        },
        { onConflict: 'owner_profile_id' },
      );
      if (error) throw error;

      await setActiveRole('merchant');
      nav('/merchant', { replace: true });
    } catch (e: any) {
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t('onboarding.merchantTitle')}</h1>
        <button className="btn" onClick={backToRoleChooser}>{t('common.back')}</button>
      </div>

      {err && <div className="mt-4 rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm">{err}</div>}
      <div className="mt-4 text-sm opacity-80">{t('onboarding.step', { step, total: 2 })}</div>

      {step === 1 && (
        <div className="mt-6 space-y-3">
          <div className="text-sm font-semibold">{t('merchant.type')}</div>
          <div className="grid gap-2 md:grid-cols-3">
            {TYPES.map((k) => (
              <button
                key={k}
                className={businessType === k ? 'btn btn-primary' : 'btn'}
                onClick={() => setBusinessType(k)}
                disabled={busy}
              >
                {t(`merchantTypes.${k}`)}
              </button>
            ))}
          </div>

          <div className="mt-6 flex justify-end">
            <button className="btn btn-primary" onClick={() => setStep(2)} disabled={busy}>
              {t('common.continue')}
            </button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="mt-6 space-y-3">
          <label className="block text-sm">
            <div className="mb-1 opacity-80">{t('merchant.name')}</div>
            <input className="input w-full" value={businessName} onChange={(e) => setBusinessName(e.target.value)} />
          </label>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm opacity-80">
            {t('merchant.pendingHint')}
          </div>

          <div className="mt-6 flex justify-between">
            <button className="btn" onClick={() => setStep(1)} disabled={busy}>
              {t('common.back')}
            </button>
            <button className="btn btn-primary" onClick={submit} disabled={busy}>
              {busy ? t('common.working') : t('onboarding.finish')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
