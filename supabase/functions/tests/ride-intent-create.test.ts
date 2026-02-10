/**
 * Unit tests for ride-intent-create validation helpers.
 * These tests focus on the pure validation logic extracted from the handler,
 * avoiding the need for a live Supabase connection.
 */
import { assertEquals, assertThrows } from 'jsr:@std/assert';

// --- Copied from ride-intent-create/index.ts for isolated testing ---

function isFiniteNumber(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}

function clampString(v: unknown, maxLen: number): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (!t) return null;
  return t.length > maxLen ? t.slice(0, maxLen) : t;
}

function normalizeProductCode(v: unknown): string {
  if (typeof v !== 'string') return 'standard';
  const t = v.trim().toLowerCase();
  return t ? t.slice(0, 32) : 'standard';
}

function normalizeSource(v: unknown): string {
  if (typeof v !== 'string') return 'callcenter';
  const t = v.trim().toLowerCase();
  return t === 'callcenter' ? 'callcenter' : 'callcenter';
}

function validateLatLng(lat: number, lng: number) {
  if (lat < -90 || lat > 90) throw new Error('Invalid latitude');
  if (lng < -180 || lng > 180) throw new Error('Invalid longitude');
}

// --- Tests ---

Deno.test('isFiniteNumber: accepts valid numbers', () => {
  assertEquals(isFiniteNumber(0), true);
  assertEquals(isFiniteNumber(33.3), true);
  assertEquals(isFiniteNumber(-180), true);
});

Deno.test('isFiniteNumber: rejects Infinity and NaN', () => {
  assertEquals(isFiniteNumber(Infinity), false);
  assertEquals(isFiniteNumber(-Infinity), false);
  assertEquals(isFiniteNumber(NaN), false);
});

Deno.test('isFiniteNumber: rejects non-numbers', () => {
  assertEquals(isFiniteNumber('123'), false);
  assertEquals(isFiniteNumber(null), false);
  assertEquals(isFiniteNumber(undefined), false);
});

Deno.test('clampString: returns null for non-strings', () => {
  assertEquals(clampString(123, 100), null);
  assertEquals(clampString(null, 100), null);
});

Deno.test('clampString: trims and respects maxLen', () => {
  assertEquals(clampString('  hello  ', 100), 'hello');
  assertEquals(clampString('abcdef', 3), 'abc');
});

Deno.test('clampString: returns null for empty/whitespace-only strings', () => {
  assertEquals(clampString('', 100), null);
  assertEquals(clampString('   ', 100), null);
});

Deno.test('normalizeProductCode: defaults to standard', () => {
  assertEquals(normalizeProductCode(undefined), 'standard');
  assertEquals(normalizeProductCode(''), 'standard');
});

Deno.test('normalizeProductCode: lowercases and limits length', () => {
  assertEquals(normalizeProductCode('PREMIUM'), 'premium');
  const longCode = 'a'.repeat(50);
  assertEquals(normalizeProductCode(longCode).length, 32);
});

Deno.test('normalizeSource: defaults to callcenter', () => {
  assertEquals(normalizeSource(undefined), 'callcenter');
  assertEquals(normalizeSource('unknown'), 'callcenter');
});

Deno.test('normalizeSource: accepts known values', () => {
  assertEquals(normalizeSource('legacy'), 'callcenter');
  assertEquals(normalizeSource('CALLCENTER'), 'callcenter');
});

Deno.test('validateLatLng: accepts valid coordinates', () => {
  validateLatLng(0, 0);
  validateLatLng(90, 180);
  validateLatLng(-90, -180);
});

Deno.test('validateLatLng: throws on invalid latitude', () => {
  assertThrows(() => validateLatLng(91, 0), Error, 'Invalid latitude');
  assertThrows(() => validateLatLng(-91, 0), Error, 'Invalid latitude');
});

Deno.test('validateLatLng: throws on invalid longitude', () => {
  assertThrows(() => validateLatLng(0, 181), Error, 'Invalid longitude');
  assertThrows(() => validateLatLng(0, -181), Error, 'Invalid longitude');
});
