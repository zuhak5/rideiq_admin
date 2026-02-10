import { assertEquals } from 'jsr:@std/assert';

import { normalizeOrsDirectionsLanguage } from '../_shared/geo/providers/ors.ts';

Deno.test('normalizeOrsDirectionsLanguage keeps supported ORS language values', () => {
  assertEquals(normalizeOrsDirectionsLanguage('en'), 'en');
  assertEquals(normalizeOrsDirectionsLanguage('de'), 'de');
  assertEquals(normalizeOrsDirectionsLanguage('zh'), 'zh');
});

Deno.test('normalizeOrsDirectionsLanguage reduces locale variants to base language', () => {
  assertEquals(normalizeOrsDirectionsLanguage('en-US'), 'en');
  assertEquals(normalizeOrsDirectionsLanguage('de-DE'), 'de');
  assertEquals(normalizeOrsDirectionsLanguage('zh-CN'), 'zh');
});

Deno.test('normalizeOrsDirectionsLanguage rejects unsupported directions languages', () => {
  assertEquals(normalizeOrsDirectionsLanguage('ar'), null);
  assertEquals(normalizeOrsDirectionsLanguage('ar-IQ'), null);
  assertEquals(normalizeOrsDirectionsLanguage(''), null);
});
