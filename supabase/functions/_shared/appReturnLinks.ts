import { envTrim } from './config.ts';

const WALLET_ROUTE_SEGMENTS = ['rider', 'account', 'wallet'] as const;
const HTML_HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'no-store',
};

type ReturnValue = string | number | boolean | null | undefined;

export type TopupReturnResponseParams = {
  provider: string;
  intentId?: string | null;
  paymentId?: string | null;
  status?: string | null;
  verified?: boolean | null;
  extras?: Record<string, ReturnValue>;
  appLinkBaseUrl?: string | null;
  appCustomSchemeBaseUrl?: string | null;
  legacyAppBaseUrl?: string | null;
};

export type TopupReturnTargets = {
  preferredUrl: string | null;
  fallbackUrl: string | null;
};

function firstNonEmpty(...values: Array<string | null | undefined>) {
  for (const value of values) {
    const normalized = String(value ?? '').trim();
    if (normalized) return normalized;
  }
  return null;
}

function appendWalletRoute(url: URL): URL {
  const isHttp = url.protocol === 'http:' || url.protocol === 'https:';
  const route = isHttp
    ? url.pathname.split('/').filter(Boolean)
    : [url.host, ...url.pathname.split('/').filter(Boolean)].filter(Boolean);

  const endsWithWalletRoute =
    route.length >= WALLET_ROUTE_SEGMENTS.length &&
    WALLET_ROUTE_SEGMENTS.every(
      (segment, index) =>
        route[route.length - WALLET_ROUTE_SEGMENTS.length + index] === segment,
    );

  if (!endsWithWalletRoute) {
    if (route[route.length - 1] === 'wallet') {
      route.splice(route.length - 1, 1, ...WALLET_ROUTE_SEGMENTS);
    } else {
      route.push(...WALLET_ROUTE_SEGMENTS);
    }
  }

  if (isHttp) {
    url.pathname = `/${route.join('/')}`;
    return url;
  }

  url.host = route[0] ?? '';
  url.pathname = route.length > 1 ? `/${route.slice(1).join('/')}` : '';
  return url;
}

function buildUrl(baseUrl: string | null | undefined, query: URLSearchParams) {
  const raw = String(baseUrl ?? '').trim();
  if (!raw) return null;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  appendWalletRoute(url);
  for (const [key, value] of query.entries()) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

function buildQuery(params: TopupReturnResponseParams) {
  const query = new URLSearchParams();
  query.set('tab', 'topups');
  query.set('provider', params.provider);

  if (params.intentId) query.set('intent_id', params.intentId);
  if (params.paymentId) query.set('payment_id', params.paymentId);
  if (params.status) query.set('status', params.status);
  if (params.verified !== null && params.verified !== undefined) {
    query.set('verified', params.verified ? '1' : '0');
  }

  for (const [key, value] of Object.entries(params.extras ?? {})) {
    if (value === null || value === undefined) continue;
    const normalized = String(value).trim();
    if (!normalized) continue;
    query.set(key, normalized);
  }

  return query;
}

function redirect(location: string) {
  return new Response(null, {
    status: 302,
    headers: {
      Location: location,
      'Cache-Control': 'no-store',
    },
  });
}

function bridgeHtml(preferredUrl: string, fallbackUrl: string) {
  const preferred = JSON.stringify(preferredUrl);
  const fallback = JSON.stringify(fallbackUrl);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>Returning to Rabi7</title>
</head>
<body>
  <p>Returning to the app...</p>
  <p><a id="open-app-link" href=${preferred}>Open Rabi7</a></p>
  <script>
    const preferredUrl = ${preferred};
    const fallbackUrl = ${fallback};
    window.location.replace(preferredUrl);
    window.setTimeout(() => {
      window.location.replace(fallbackUrl);
    }, 900);
  </script>
</body>
</html>`;
}

export function resolveTopupReturnTargets(
  params: TopupReturnResponseParams,
): TopupReturnTargets {
  const query = buildQuery(params);
  const preferredBase = firstNonEmpty(
    params.appLinkBaseUrl,
    envTrim('APP_LINK_BASE_URL'),
    params.legacyAppBaseUrl,
    envTrim('APP_BASE_URL'),
  );
  const fallbackBase = firstNonEmpty(
    params.appCustomSchemeBaseUrl,
    envTrim('APP_CUSTOM_SCHEME_BASE_URL'),
  );
  const legacyBase = firstNonEmpty(
    params.legacyAppBaseUrl,
    envTrim('APP_BASE_URL'),
  );

  const preferredUrl =
    buildUrl(preferredBase, query) ?? buildUrl(legacyBase, query);
  const fallbackUrl = buildUrl(fallbackBase, query);

  return {
    preferredUrl,
    fallbackUrl,
  };
}

export function createTopupReturnResponse(
  params: TopupReturnResponseParams,
): Response | null {
  const targets = resolveTopupReturnTargets(params);
  const primary = targets.preferredUrl ?? targets.fallbackUrl;
  if (!primary) return null;

  if (
    targets.preferredUrl &&
    targets.fallbackUrl &&
    targets.preferredUrl !== targets.fallbackUrl
  ) {
    return new Response(bridgeHtml(targets.preferredUrl, targets.fallbackUrl), {
      status: 200,
      headers: HTML_HEADERS,
    });
  }

  return redirect(primary);
}
