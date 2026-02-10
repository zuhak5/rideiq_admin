export class PhoneNormalizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PhoneNormalizationError';
  }
}

function digitsOnly(input: string): string {
  return input.replace(/[\s\-().]/g, '');
}

/**
 * Iraq-only normalization.
 * Output: +9647XXXXXXXXX
 */
export function normalizeIraqPhoneE164(phone: string): string {
  const raw = digitsOnly((phone ?? '').trim());
  if (!raw) throw new PhoneNormalizationError('Phone is required');

  let p = raw;
  if (p.startsWith('+')) p = p.slice(1);
  if (p.startsWith('00')) p = p.slice(2);

  if (p.startsWith('964')) {
    // ok
  } else if (p.startsWith('0')) {
    p = '964' + p.slice(1);
  } else if (p.startsWith('7')) {
    p = '964' + p;
  } else {
    throw new PhoneNormalizationError('Phone must be an Iraqi mobile number');
  }

  if (!/^9647\d{9}$/.test(p)) {
    throw new PhoneNormalizationError('Invalid Iraqi mobile number format');
  }

  return `+${p}`;
}
