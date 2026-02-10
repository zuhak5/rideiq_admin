import React from 'react';
import { useTranslation } from 'react-i18next';
import { formatIQD } from '../lib/money';

export type QuoteBreakdown = {
  currency: 'IQD';
  service_area_id: string | null;
  product_code: string;

  // Route basis (edge function) or straight-line (legacy RPC)
  distance_km: number;

  // Optional when route/ETA is available (fare-quote edge function)
  duration_min?: number;

  base_fare_iqd: number;
  distance_fare_iqd: number;
  time_fare_iqd?: number;

  minimum_fare_iqd: number;
  subtotal_iqd: number;

  product_multiplier: number;
  surge_multiplier_raw: number;
  max_surge_multiplier: number;
  surge_multiplier_applied: number;
  surge_reason: string | null;

  // Optional cash rounding telemetry (fare-quote edge function)
  rounding_step_iqd?: number;
  total_iqd_raw?: number;

  total_iqd: number;
};

function fmtMult(n: number): string {
  if (!Number.isFinite(n)) return '—';
  return `${n.toFixed(2)}×`;
}

export default function QuoteBreakdownCard({ quote, className }: { quote: QuoteBreakdown; className?: string }) {
  const { t } = useTranslation();

  const surgeCapped =
    Number.isFinite(quote.surge_multiplier_raw) &&
    Number.isFinite(quote.surge_multiplier_applied) &&
    quote.surge_multiplier_applied < quote.surge_multiplier_raw - 1e-9;

  return (
    <div className={className ?? 'rounded-2xl border border-gray-200 bg-white p-4 shadow-sm'}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="text-sm font-semibold">{t('quote.title')}</div>
          <div className="text-xs text-gray-500">{t('quote.subtitle')}</div>
        </div>
        <div className="text-right">
          <div className="text-xs text-gray-500">{t('quote.total')}</div>
          <div className="text-lg font-semibold">{formatIQD(quote.total_iqd)}</div>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
        <Row k={t('quote.baseFare')} v={formatIQD(quote.base_fare_iqd)} />
        <Row k={t('quote.distanceFare')} v={formatIQD(quote.distance_fare_iqd)} />
        {quote.time_fare_iqd != null ? <Row k={t('quote.timeFare')} v={formatIQD(quote.time_fare_iqd)} /> : null}

        <Row k={t('quote.distance')} v={`${quote.distance_km.toFixed(2)} km`} />
        {quote.duration_min != null ? <Row k={t('quote.duration')} v={`${quote.duration_min.toFixed(0)} min`} /> : null}

        <Row k={t('quote.minimumFare')} v={formatIQD(quote.minimum_fare_iqd)} />
        <Row k={t('quote.subtotal')} v={formatIQD(quote.subtotal_iqd)} />

        {quote.total_iqd_raw != null && quote.rounding_step_iqd != null && quote.total_iqd_raw !== quote.total_iqd ? (
          <Row
            k={t('quote.rounding')}
            v={`${formatIQD(quote.total_iqd_raw)} → ${formatIQD(quote.total_iqd)} (${quote.rounding_step_iqd} IQD)`}
          />
        ) : null}

        <Row k={t('quote.productMultiplier')} v={fmtMult(quote.product_multiplier)} />
        <Row k={t('quote.surge')} v={fmtMult(quote.surge_multiplier_applied)} />
        <Row k={t('quote.surgeCap')} v={fmtMult(quote.max_surge_multiplier)} />
      </div>

      {surgeCapped ? (
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <div className="font-medium">{t('quote.surgeCappedTitle')}</div>
          <div className="text-xs mt-1">
            {t('quote.surgeCappedBody', {
              raw: quote.surge_multiplier_raw.toFixed(2),
              cap: quote.max_surge_multiplier.toFixed(2),
            })}
          </div>
        </div>
      ) : null}

      {quote.surge_reason ? (
        <div className="mt-2 text-xs text-gray-600">
          {t('quote.surgeReason')}: <span className="font-medium">{quote.surge_reason}</span>
        </div>
      ) : null}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-xl border border-gray-100 px-3 py-2">
      <div className="text-gray-600">{k}</div>
      <div className="font-medium">{v}</div>
    </div>
  );
}
