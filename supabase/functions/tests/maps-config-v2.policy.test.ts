import { assertEquals } from 'jsr:@std/assert';

import {
  canServeMapsConfigRequest,
  isAllowedMapsConfigOrigin,
} from '../maps-config-v2/policy.ts';

Deno.test('isAllowedMapsConfigOrigin allows server-side callers without an Origin header', () => {
  assertEquals(
    isAllowedMapsConfigOrigin(null, ['https://app.rideiq.com']),
    true,
  );
});

Deno.test('canServeMapsConfigRequest allows authenticated admin callers from non-public origins', () => {
  assertEquals(
    canServeMapsConfigRequest({
      origin: 'https://rideiqadmin.vercel.app',
      allowedOrigins: ['https://app.rideiq.com'],
      hasAuthenticatedUser: true,
    }),
    true,
  );
});

Deno.test('canServeMapsConfigRequest still blocks unknown unauthenticated browser origins', () => {
  assertEquals(
    canServeMapsConfigRequest({
      origin: 'https://rideiqadmin.vercel.app',
      allowedOrigins: ['https://app.rideiq.com'],
      hasAuthenticatedUser: false,
    }),
    false,
  );
});
