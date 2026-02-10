/**
 * Iraq-only phone normalization.
 *
 * We enforce Iraqi mobile numbers only:
 * - Local format: 07XXXXXXXXX (11 digits)
 * - International: +9647XXXXXXXXX or 9647XXXXXXXXX
 *
 * Normalized output:
 * - E164 with plus: +9647XXXXXXXXX
 * - E164 without plus: 9647XXXXXXXXX
 */

export class PhoneNormalizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PhoneNormalizationError';
  }
}

function digitsOnly(input: string): string {
  return input.replace(/[\s\-().]/g, '');
}

export function normalizeIraqPhoneE164(phone: string): string {
  const raw = digitsOnly((phone ?? '').trim());
  if (!raw) throw new PhoneNormalizationError('Phone is required');

  let p = raw;
  // + prefix removed by digitsOnly? we didn't remove '+', so handle here
  if (p.startsWith('+')) p = p.slice(1);
  if (p.startsWith('00')) p = p.slice(2);

  if (p.startsWith('964')) {
    // ok
  } else if (p.startsWith('0')) {
    p = '964' + p.slice(1);
  } else if (p.startsWith('7')) {
    // e.g., 7501234567 (10 digits total) -> 9647501234567
    p = '964' + p;
  } else {
    throw new PhoneNormalizationError('Phone must be an Iraqi mobile number');
  }

  // Validate: 964 + 7 + 9 digits
  if (!/^9647\d{9}$/.test(p)) {
    throw new PhoneNormalizationError('Invalid Iraqi mobile number format');
  }
  return `+${p}`;
}

export function normalizeIraqPhoneNoPlus(phone: string): string {
  return normalizeIraqPhoneE164(phone).slice(1);
}

export function toIraqLocal07(phone: string): string {
  const p = normalizeIraqPhoneNoPlus(phone); // 9647xxxxxxxxx
  return '0' + p.slice(3); // 07xxxxxxxxx
}
