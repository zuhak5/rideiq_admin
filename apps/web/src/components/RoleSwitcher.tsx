import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getMyAppContext, setActiveRole } from '../lib/profile';

export default function RoleSwitcher() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const qc = useQueryClient();

  const ctxQ = useQuery({
    queryKey: ['my-app-context'],
    queryFn: getMyAppContext,
  });

  if (ctxQ.isLoading || ctxQ.isError) return null;
  const ctx = ctxQ.data;
  if (!ctx) return null;
  if (!ctx.role_onboarding_completed) return null;

  const active = ctx.active_role;
  const hasDriver = ctx.has_driver;
  const hasMerchant = ctx.has_merchant;

  const onChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const next = e.target.value as 'rider' | 'driver' | 'merchant';

    if (next === 'driver' && !hasDriver) {
      nav('/onboarding/driver');
      return;
    }
    if (next === 'merchant' && !hasMerchant) {
      nav('/onboarding/merchant');
      return;
    }

    await setActiveRole(next);

    await Promise.all([
      qc.invalidateQueries({ queryKey: ['my-app-context'] }),
      qc.invalidateQueries({ queryKey: ['my-profile-basics'] }),
    ]);

    nav(next === 'rider' ? '/rider' : next === 'driver' ? '/driver' : '/merchant');
  };

  return (
    <label className="flex items-center gap-2 text-xs opacity-90">
      <span className="hidden md:inline">{t('roles.current')}:</span>
      <select className="input py-1 text-xs" value={active} onChange={onChange}>
        <option value="rider">{t('roles.rider')}</option>
        <option value="driver">{hasDriver ? t('roles.driver') : `${t('roles.driver')} (${t('common.setup')})`}</option>
        <option value="merchant">{hasMerchant ? t('roles.merchant') : `${t('roles.merchant')} (${t('common.setup')})`}</option>
      </select>
    </label>
  );
}
