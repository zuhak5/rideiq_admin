import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { setActiveRole, setRoleOnboardingCompleted } from '../lib/profile';

type Choice = 'rider' | 'driver' | 'merchant';

export default function RoleChooserPage() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const [busy, setBusy] = React.useState<Choice | null>(null);
  const [err, setErr] = React.useState<string | null>(null);

  const choose = async (choice: Choice) => {
    setErr(null);
    setBusy(choice);
    try {
      // Mark onboarding as completed so we don't block navigation on refresh.
      await setRoleOnboardingCompleted(true);

      if (choice === 'rider') {
        await setActiveRole('rider');
        nav('/home', { replace: true });
        return;
      }

      // For driver/merchant, complete the dedicated onboarding first.
      nav(choice === 'driver' ? '/onboarding/driver' : '/onboarding/merchant', { replace: true });
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="text-2xl font-semibold">{t('onboarding.chooseRoleTitle')}</h1>
      <p className="mt-2 text-sm opacity-80">{t('onboarding.chooseRoleSubtitle')}</p>

      {err && <div className="mt-4 rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm">{err}</div>}

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <button
          className="rounded-2xl border border-white/10 bg-white/5 p-5 text-left hover:bg-white/10"
          disabled={!!busy}
          onClick={() => choose('rider')}
        >
          <div className="text-lg font-semibold">{t('roles.rider')}</div>
          <div className="mt-1 text-sm opacity-80">{t('roles.riderDesc')}</div>
          <div className="mt-4">
            <span className="btn btn-primary">{busy === 'rider' ? t('common.working') : t('common.continue')}</span>
          </div>
        </button>

        <button
          className="rounded-2xl border border-white/10 bg-white/5 p-5 text-left hover:bg-white/10"
          disabled={!!busy}
          onClick={() => choose('driver')}
        >
          <div className="text-lg font-semibold">{t('roles.driver')}</div>
          <div className="mt-1 text-sm opacity-80">{t('roles.driverDesc')}</div>
          <div className="mt-4">
            <span className="btn btn-primary">{busy === 'driver' ? t('common.working') : t('common.apply')}</span>
          </div>
        </button>

        <button
          className="rounded-2xl border border-white/10 bg-white/5 p-5 text-left hover:bg-white/10"
          disabled={!!busy}
          onClick={() => choose('merchant')}
        >
          <div className="text-lg font-semibold">{t('roles.merchant')}</div>
          <div className="mt-1 text-sm opacity-80">{t('roles.merchantDesc')}</div>
          <div className="mt-4">
            <span className="btn btn-primary">{busy === 'merchant' ? t('common.working') : t('common.apply')}</span>
          </div>
        </button>
      </div>

      <div className="mt-6 text-xs opacity-70">{t('onboarding.chooseRoleHint')}</div>
    </div>
  );
}
