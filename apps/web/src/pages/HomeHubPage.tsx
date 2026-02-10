import React from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getMyAppContext } from '../lib/profile';

function CardLink({
  to,
  title,
  subtitle,
  badge,
}: {
  to: string;
  title: string;
  subtitle?: string;
  badge?: string;
}) {
  return (
    <Link
      to={to}
      className="block rounded-xl border bg-white p-4 shadow-sm hover:shadow transition-shadow"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">{title}</div>
          {subtitle ? <div className="mt-1 text-xs text-gray-500">{subtitle}</div> : null}
        </div>
        {badge ? (
          <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-700">
            {badge}
          </span>
        ) : null}
      </div>
    </Link>
  );
}

export default function HomeHubPage() {
  const { t } = useTranslation();
  const ctxQ = useQuery({
    queryKey: ['my-app-context'],
    queryFn: getMyAppContext,
  });

  if (ctxQ.isLoading) return <div className="p-6">{t('common.loading')}</div>;
  if (ctxQ.isError) return <div className="p-6 text-red-600">{t('common.error')}</div>;

  const ctx = ctxQ.data;
  if (!ctx) return <div className="p-6 text-red-600">{t('common.error')}</div>;

  const driverDest = ctx.has_driver ? '/driver' : '/onboarding/driver';
  const merchantDest = ctx.has_merchant ? '/merchant' : '/onboarding/merchant';

  const merchantBadge =
    ctx.has_merchant ? (ctx.merchant_status ? t(`merchant.status.${ctx.merchant_status}`) : undefined) : t('common.setup');

  const roleBadge = t(`roles.${ctx.active_role}`);

  return (
    <div className="p-6">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <div className="text-xl font-semibold">{t('home.title')}</div>
          <div className="mt-1 text-sm text-gray-600">{t('home.subtitle')}</div>
        </div>
        <span className="rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-800">{roleBadge}</span>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
        <CardLink to="/rider" title={t('home.tiles.ride.title')} subtitle={t('home.tiles.ride.subtitle')} />
        <CardLink to="/businesses" title={t('home.tiles.businesses.title')} subtitle={t('home.tiles.businesses.subtitle')} />
        <CardLink to="/orders" title={t('home.tiles.orders.title')} subtitle={t('home.tiles.orders.subtitle')} />
        <CardLink to="/chats" title={t('home.tiles.chats.title')} subtitle={t('home.tiles.chats.subtitle')} />
        <CardLink to="/wallet" title={t('home.tiles.wallet.title')} subtitle={t('home.tiles.wallet.subtitle')} />
        <CardLink
          to={driverDest}
          title={t('home.tiles.driver.title')}
          subtitle={ctx.has_driver ? t('home.tiles.driver.subtitle_ready') : t('home.tiles.driver.subtitle_setup')}
          badge={ctx.has_driver ? t('common.ready') : t('common.setup')}
        />
        <CardLink
          to={merchantDest}
          title={t('home.tiles.merchant.title')}
          subtitle={ctx.has_merchant ? t('home.tiles.merchant.subtitle_ready') : t('home.tiles.merchant.subtitle_setup')}
          badge={merchantBadge}
        />
        <CardLink to="/history" title={t('home.tiles.history.title')} subtitle={t('home.tiles.history.subtitle')} />
      </div>
    </div>
  );
}
