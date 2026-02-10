import { assertEquals } from 'jsr:@std/assert';

import { getOrsErrorCode, getOrsErrorMessage, isOrsNoRouteError } from '../_shared/geo/providers/orsErrors.ts';

Deno.test('getOrsErrorCode reads nested and root ORS error codes', () => {
  assertEquals(getOrsErrorCode({ error: { code: 2010 } }), 2010);
  assertEquals(getOrsErrorCode({ error: { code: '2009' } }), 2009);
  assertEquals(getOrsErrorCode({ code: 2009 }), 2009);
  assertEquals(getOrsErrorCode({}), null);
});

Deno.test('getOrsErrorMessage reads nested and root ORS error messages', () => {
  assertEquals(getOrsErrorMessage({ error: { message: 'Route could not be found.' } }), 'Route could not be found.');
  assertEquals(getOrsErrorMessage({ message: 'Could not find point 0' }), 'Could not find point 0');
  assertEquals(getOrsErrorMessage({}), null);
});

Deno.test('isOrsNoRouteError classifies ORS no-route codes', () => {
  assertEquals(isOrsNoRouteError({ error: { code: 2009 } }), true);
  assertEquals(isOrsNoRouteError({ error: { code: 2010 } }), true);
  assertEquals(isOrsNoRouteError({ error: { code: 2004 } }), false);
  assertEquals(isOrsNoRouteError({}), false);
});
