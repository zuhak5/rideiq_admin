import i18n from '../i18n';

export function formatIQD(amount: number | bigint | string | null | undefined): string {
  const n =
    amount == null
      ? NaN
      : typeof amount === 'bigint'
        ? Number(amount)
        : typeof amount === 'string'
          ? Number(amount)
          : amount;
  if (!Number.isFinite(n)) return '—';

  // Iraq's de-facto UX is whole dinars (no decimals).
  try {
    const lang = (i18n.language ?? '').toLowerCase();
    const locale = lang.startsWith('ar') ? 'ar-IQ' : 'en-IQ';
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: 'IQD',
      maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return `${Math.trunc(n).toLocaleString()} IQD`;
  }
}

export function formatSignedIQD(amount: number | bigint | string | null | undefined): string {
  const n =
    amount == null
      ? NaN
      : typeof amount === 'bigint'
        ? Number(amount)
        : typeof amount === 'string'
          ? Number(amount)
          : amount;
  if (!Number.isFinite(n)) return '—';
  const sign = n > 0 ? '+' : n < 0 ? '−' : '';
  const abs = Math.abs(Math.trunc(n));
  // Keep the sign outside the currency formatting to avoid locale edge-cases.
  return `${sign}${formatIQD(abs)}`;
}


export function parseIQDInput(input: string): number {
  // Accepts "12,000" or "12000" and returns 12000 (IQD, whole dinars)
  const cleaned = (input ?? '').toString().trim().replace(/[\s,]/g, '');
  if (!cleaned) return 0;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.trunc(n));
}
