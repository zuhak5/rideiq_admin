import { withRequestContext } from '../_shared/requestContext.ts';
import { createTopupReturnResponse } from '../_shared/appReturnLinks.ts';

/**
 * QiCard hosted payment page return handler.
 *
 * IMPORTANT:
 * Many 3DS/payment hosted pages return to the merchant using **POST** form-data, not only GET.
 * This function accepts GET/POST and then redirects the browser back to the web app.
 *
 * The authoritative payment state is handled asynchronously via `qicard-notify` (callbackUrl).
 */
function buildReturnResponse(params: URLSearchParams) {
  const requestId = params.get('requestId') ?? params.get('reference') ?? params.get('intent_id') ?? '';
  const paymentId = params.get('paymentId') ?? '';
  const status = params.get('status') ?? params.get('transactionStatus') ?? '';
  return createTopupReturnResponse({
    provider: 'qicard',
    intentId: requestId || null,
    paymentId: paymentId || null,
    status: status || null,
  });
}

async function readParams(req: Request): Promise<URLSearchParams> {
  const url = new URL(req.url);
  const merged = new URLSearchParams(url.search);

  if (req.method !== 'POST') return merged;

  const ct = (req.headers.get('content-type') ?? '').toLowerCase();

  try {
    if (ct.includes('application/x-www-form-urlencoded')) {
      const body = await req.text();
      const bodyParams = new URLSearchParams(body);
      for (const [k, v] of bodyParams.entries()) merged.set(k, v);
      return merged;
    }

    if (ct.includes('multipart/form-data')) {
      const form = await req.formData();
      for (const [k, v] of form.entries()) merged.set(k, String(v));
      return merged;
    }

    if (ct.includes('application/json')) {
      const jsonBody = await req.json().catch(() => ({}));
      if (jsonBody && typeof jsonBody === 'object') {
        for (const [k, v] of Object.entries(jsonBody as Record<string, unknown>)) {
          if (v === undefined || v === null) continue;
          merged.set(k, String(v));
        }
      }
      return merged;
    }
  } catch {
    // If parsing fails, still return query parameters.
  }

  return merged;
}

Deno.serve((req) =>
  withRequestContext('qicard-return', req, async (_ctx) => {

  const response = buildReturnResponse(await readParams(req));
  if (!response) {
    return new Response(
      'Missing APP_LINK_BASE_URL or APP_CUSTOM_SCHEME_BASE_URL',
      { status: 500 },
    );
  }

  return response;
  }),
);
