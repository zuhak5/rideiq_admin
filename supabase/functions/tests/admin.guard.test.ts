import { assertEquals, assertStrictEquals } from 'jsr:@std/assert';

import { adminAuthGuard, requirePermission } from '../_shared/admin.ts';
import { requireUser } from '../_shared/supabase.ts';

Deno.test('adminAuthGuard uses shared JWT claims verification for admin routes', () => {
  assertStrictEquals(adminAuthGuard, requireUser);
});

Deno.test('requirePermission returns 401 when the authorization header is missing', async () => {
  const guard = await requirePermission(
    new Request('http://localhost/functions/v1/admin-api/admin-live-drivers', { method: 'POST' }),
    { headers: {} } as any,
    'maps.view',
  );

  if (!('res' in guard)) {
    throw new Error('Expected an unauthorized response');
  }

  assertEquals(guard.res.status, 401);
  assertEquals(await guard.res.json(), {
    ok: false,
    error: 'Unauthorized',
    code: 'UNAUTHORIZED',
  });
});
