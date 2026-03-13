import { assertEquals, assertMatch } from 'jsr:@std/assert';

import {
  createTopupReturnResponse,
  resolveTopupReturnTargets,
} from '../_shared/appReturnLinks.ts';

Deno.test('resolveTopupReturnTargets prefers https link and keeps custom-scheme fallback', () => {
  const targets = resolveTopupReturnTargets({
    provider: 'qicard',
    intentId: 'intent-1',
    status: 'succeeded',
    appLinkBaseUrl: 'https://app.example.com',
    appCustomSchemeBaseUrl: 'rabi7://rider/account/wallet',
  });

  assertEquals(
    targets.preferredUrl,
    'https://app.example.com/rider/account/wallet?tab=topups&provider=qicard&intent_id=intent-1&status=succeeded',
  );
  assertEquals(
    targets.fallbackUrl,
    'rabi7://rider/account/wallet?tab=topups&provider=qicard&intent_id=intent-1&status=succeeded',
  );
});

Deno.test('resolveTopupReturnTargets normalizes legacy APP_BASE_URL wallet path', () => {
  const targets = resolveTopupReturnTargets({
    provider: 'asiapay',
    intentId: 'intent-2',
    status: 'failed',
    legacyAppBaseUrl: 'https://app.example.com/wallet',
  });

  assertEquals(
    targets.preferredUrl,
    'https://app.example.com/rider/account/wallet?tab=topups&provider=asiapay&intent_id=intent-2&status=failed',
  );
  assertEquals(targets.fallbackUrl, null);
});

Deno.test('createTopupReturnResponse emits bridge html when both targets exist', async () => {
  const response = createTopupReturnResponse({
    provider: 'zaincash',
    intentId: 'intent-3',
    status: 'pending',
    appLinkBaseUrl: 'https://app.example.com',
    appCustomSchemeBaseUrl: 'rabi7://rider/account/wallet',
  });

  assertEquals(response?.status, 200);
  assertEquals(response?.headers.get('content-type'), 'text/html; charset=utf-8');

  const html = await response?.text();
  assertMatch(html ?? '', /https:\/\/app\.example\.com\/rider\/account\/wallet/);
  assertMatch(html ?? '', /rabi7:\/\/rider\/account\/wallet/);
});

Deno.test('createTopupReturnResponse redirects directly when only one target exists', () => {
  const response = createTopupReturnResponse({
    provider: 'qicard',
    intentId: 'intent-4',
    paymentId: 'payment-4',
    status: 'succeeded',
    appCustomSchemeBaseUrl: 'rabi7://rider/account/wallet',
  });

  assertEquals(response?.status, 302);
  assertEquals(
    response?.headers.get('location'),
    'rabi7://rider/account/wallet?tab=topups&provider=qicard&intent_id=intent-4&payment_id=payment-4&status=succeeded',
  );
});
