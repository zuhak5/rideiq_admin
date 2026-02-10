import { withRequestContext } from '../_shared/requestContext.ts';

/**
 * QiCard hosted payment page return handler.
 *
 * IMPORTANT:
 * Many 3DS/payment hosted pages return to the merchant using **POST** form-data, not only GET.
 * This function accepts GET/POST and then redirects the browser back to the web app.
 *
 * The authoritative payment state is handled asynchronously via `qicard-notify` (callbackUrl).
 */
const APP_BASE_URL = (Deno.env.get('APP_BASE_URL') ?? '').replace(/\/$/, '');

function redirect(location: string) {
  return new Response(null, {
    status: 302,
    headers: {
      Location: location,
      'Cache-Control': 'no-store',
    },
  });
}

function buildRedirectUrl(params: URLSearchParams) {
  const requestId = params.get('requestId') ?? params.get('reference') ?? params.get('intent_id') ?? '';
  const paymentId = params.get('paymentId') ?? '';
  const status = params.get('status') ?? params.get('transactionStatus') ?? '';

  const base = `${APP_BASE_URL}/wallet`;
  const qs = new URLSearchParams();
  qs.set('tab', 'topups');
  if (requestId) qs.set('intent_id', requestId);
  if (paymentId) qs.set('payment_id', paymentId);
  if (status) qs.set('status', status);
  qs.set('provider', 'qicard');

  return `${base}?${qs.toString()}`;
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

  if (!APP_BASE_URL) {
    return new Response('Missing APP_BASE_URL', { status: 500 });
  }

  const params = await readParams(req);

  // Always redirect back to the app (the app will show "processing" and rely on webhook/polling).
  return redirect(buildRedirectUrl(params));
  }),
);
