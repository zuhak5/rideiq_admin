import { assertEquals } from 'jsr:@std/assert';

function normalizePaymentMethod(value: unknown) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return normalized === 'wallet' || normalized === 'cash' ? normalized : null;
}

function clampProductCode(value: unknown) {
  if (typeof value !== 'string') return 'standard';
  const normalized = value.trim().toLowerCase();
  return normalized ? normalized.slice(0, 32) : 'standard';
}

Deno.test('normalizePaymentMethod accepts wallet and cash only', () => {
  assertEquals(normalizePaymentMethod('wallet'), 'wallet');
  assertEquals(normalizePaymentMethod(' CASH '), 'cash');
  assertEquals(normalizePaymentMethod('card'), null);
  assertEquals(normalizePaymentMethod(null), null);
});

Deno.test('clampProductCode lowercases and falls back to standard', () => {
  assertEquals(clampProductCode('COMFORT'), 'comfort');
  assertEquals(clampProductCode(''), 'standard');
});
