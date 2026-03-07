import { assertEquals } from 'jsr:@std/assert';

import {
  ALL_PROVIDER_CODES,
  parseProviderCode,
} from '../_shared/geo/types.ts';

Deno.test('maps provider contract only exposes google, mapbox, and here', () => {
  assertEquals([...ALL_PROVIDER_CODES], ['google', 'mapbox', 'here']);
});

Deno.test('parseProviderCode rejects removed legacy providers', () => {
  assertEquals(parseProviderCode('google'), 'google');
  assertEquals(parseProviderCode('mapbox'), 'mapbox');
  assertEquals(parseProviderCode('here'), 'here');
  assertEquals(parseProviderCode('ors'), null);
  assertEquals(parseProviderCode('thunderforest'), null);
});
