import { envTrim } from './config.ts';
import {
  CURRENCY_IQD,
  DEFAULT_ZAINCASH_LANGUAGE,
  DEFAULT_ZAINCASH_SCOPE,
  ZAINCASH_OAUTH_PATH,
  ZAINCASH_V2_INIT_PATH,
  ZAINCASH_V2_INQUIRY_PREFIX,
} from './constants.ts';

export type ZaincashV2Config = {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  apiKey: string;
  scope: string;
  language: 'En' | 'Ar' | 'Ku';
  serviceType: string;
};

function mustEnv(name: string): string {
  const v = envTrim(name);
  if (!v) throw new Error(`Missing ${name}`);
  return v;
}

export function getZaincashV2Config(): ZaincashV2Config {
  const baseUrl = mustEnv('ZAINCASH_V2_BASE_URL').replace(/\/$/, '');
  return {
    baseUrl,
    clientId: mustEnv('ZAINCASH_V2_CLIENT_ID'),
    clientSecret: mustEnv('ZAINCASH_V2_CLIENT_SECRET'),
    apiKey: mustEnv('ZAINCASH_V2_API_KEY'),
    scope: envTrim('ZAINCASH_V2_SCOPE') || DEFAULT_ZAINCASH_SCOPE,
    language: (envTrim('ZAINCASH_V2_LANGUAGE') as any) || DEFAULT_ZAINCASH_LANGUAGE,
    serviceType: envTrim('ZAINCASH_V2_SERVICE_TYPE') || envTrim('TOPUP_SERVICE_TYPE') || 'Ride top-up',
  };
}

type FetchJsonOut = {
  status: number;
  ok: boolean;
  url: string;
  contentType: string;
  data: any;
};

function safeStringify(obj: unknown, maxLen = 900): string {
  try {
    const s = JSON.stringify(obj);
    if (s.length <= maxLen) return s;
    return s.slice(0, maxLen) + '…';
  } catch {
    return String(obj);
  }
}

function safeJsonParse(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    const trimmed = (text ?? '').trim();
    return { raw: trimmed.slice(0, 2000) };
  }
}

async function fetchJson(url: string, init: RequestInit): Promise<FetchJsonOut> {
  const res = await fetch(url, init);
  const contentType = (res.headers.get('content-type') ?? '').toLowerCase();
  const text = await res.text();
  const data = safeJsonParse(text);

  // Treat non-JSON responses as provider errors even if HTTP is 2xx, because
  // ZainCash v2 endpoints are expected to return JSON.
  const looksJson = contentType.includes('application/json') || contentType.includes('+json');
  if (!looksJson && res.ok) {
    const err: any = new Error(
      `ZainCash HTTP ${res.status} non-JSON response from ${res.url} (check ZAINCASH_V2_BASE_URL / endpoint paths)`,
    );
    err.status = res.status;
    err.body = data;
    throw err;
  }

  if (!res.ok) {
    const err: any = new Error(`ZainCash HTTP ${res.status} from ${res.url}: ${safeStringify(data)}`);
    err.status = res.status;
    err.body = data;
    throw err;
  }

  return { status: res.status, ok: res.ok, url: res.url, contentType, data };
}

function isUuidDashed(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

function normalizeUuid(v: unknown): string {
  if (typeof v !== 'string') return '';
  const t = v.trim();
  if (!t) return '';
  if (isUuidDashed(t)) return t;

  // Some gateways return UUIDs without dashes (32 hex chars). Normalize to dashed form.
  if (/^[0-9a-f]{32}$/i.test(t)) {
    return `${t.slice(0, 8)}-${t.slice(8, 12)}-${t.slice(12, 16)}-${t.slice(16, 20)}-${t.slice(20)}`;
  }

  return '';
}

function isUuid(v: unknown): v is string {
  // Type guard: true if the value is a UUID (dashed or 32-hex). Use normalizeUuid() to get canonical form.
  return !!normalizeUuid(v);
}

function isHttpUrl(v: unknown): v is string {
  return typeof v === 'string' && /^https?:\/\//i.test(v);
}

function extractUuidFromText(text: string): string {
  if (!text) return '';

  // Try dashed UUID first.
  const dashed = text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);
  if (dashed && dashed[0]) return normalizeUuid(dashed[0]);

  // Fallback: 32-hex UUID without dashes.
  const nodash = text.match(/[0-9a-f]{32}/i);
  if (nodash && nodash[0]) return normalizeUuid(nodash[0]);

  return '';
}


function extractTransactionIdFromRedirectUrl(redirectUrl: string): string {
  // ZainCash sometimes encodes the transaction id into the redirectUrl itself.
  // Accept UUIDs with dashes or 32-hex and normalize to dashed form.
  const fromText = extractUuidFromText(redirectUrl);
  const normalized = normalizeUuid(fromText);
  if (normalized) return normalized;

  try {
    const u = new URL(redirectUrl);
    const candidates = ['transactionId', 'transaction_id', 'txId', 'tx_id', 'id'];
    for (const key of candidates) {
      const v = u.searchParams.get(key);
      const n = normalizeUuid(v);
      if (n) return n;
    }
  } catch {
    // ignore
  }

  return '';
}

function normKey(k: string): string {
  return k.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function deepFind(obj: any, match: (key: string, value: any) => boolean, maxDepth = 8) {
  const visited = new Set<any>();
  const stack: Array<{ v: any; depth: number }> = [{ v: obj, depth: 0 }];

  while (stack.length) {
    const { v, depth } = stack.pop()!;
    if (v == null) continue;
    if (typeof v !== 'object') continue;
    if (visited.has(v)) continue;
    visited.add(v);

    if (Array.isArray(v)) {
      if (depth < maxDepth) {
        for (let i = 0; i < v.length; i++) stack.push({ v: v[i], depth: depth + 1 });
      }
      continue;
    }

    for (const [k, val] of Object.entries(v)) {
      if (match(k, val)) return { key: k, value: val };
      if (depth < maxDepth && typeof val === 'object' && val !== null) stack.push({ v: val, depth: depth + 1 });
    }
  }

  return null;
}

function summarizeInitBody(data: any): string {
  if (data == null) return 'null';
  if (typeof data === 'string') return `string:${data.slice(0, 200)}`;
  if (typeof data !== 'object') return `type:${typeof data}`;

  const d: any = data;
  const msg = d.message ?? d.error ?? d.error_description ?? d.description ?? d.details ?? null;
  const code = d.code ?? d.errorCode ?? d.error_code ?? d.statusCode ?? null;
  const status = d.status ?? d.result ?? d.responseStatus ?? null;
  const redirectError = d.redirectError ?? d.redirect_error ?? null;
  const errFlag = d.err ?? null;
  const keys = Object.keys(d).slice(0, 18).join(',');

  // If safeJsonParse fell back to {raw: ...}, surface that.
  const raw = typeof d.raw === 'string' ? d.raw.slice(0, 200) : null;

  const redErrStr =
    redirectError != null && String(redirectError).trim() !== ''
      ? `redirectError=${String(redirectError).slice(0, 200)}`
      : null;
  const errStr =
    errFlag != null && String(errFlag).trim() !== '' ? `err=${String(errFlag).slice(0, 60)}` : null;

  return [
    keys ? `keys=[${keys}]` : null,
    status != null ? `status=${String(status)}` : null,
    code != null ? `code=${String(code)}` : null,
    msg != null ? `message=${String(msg).slice(0, 200)}` : null,
    redErrStr,
    errStr,
    raw ? `raw=${raw}` : null,
  ]
    .filter(Boolean)
    .join(' ');
}


async function getAccessToken(cfg: ZaincashV2Config): Promise<string> {
  const url = cfg.baseUrl + ZAINCASH_OAUTH_PATH;

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    scope: cfg.scope,
  });

  const { data, status } = await fetchJson(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });

  const accessToken = (data?.access_token ?? data?.accessToken ?? '').toString();
  if (!accessToken) {
    const err: any = new Error(`ZainCash token response missing access_token: ${safeStringify(data)}`);
    err.status = status;
    err.body = data;
    throw err;
  }

  return accessToken;
}

export type ZaincashV2InitInput = {
  externalReferenceId: string;
  orderId: string;
  amountIQD: number;
  customerPhone: string | null;
  successUrl: string;
  failureUrl: string;
};

export async function zaincashV2InitPayment(
  cfg: ZaincashV2Config,
  input: ZaincashV2InitInput,
): Promise<{ transactionId: string; redirectUrl: string; raw: unknown }> {
  const token = await getAccessToken(cfg);
  const url = cfg.baseUrl + ZAINCASH_V2_INIT_PATH;

  const payload = {
    language: cfg.language,
    externalReferenceId: input.externalReferenceId,
    orderId: input.orderId,
    serviceType: cfg.serviceType,
    amount: { value: input.amountIQD, currency: CURRENCY_IQD },
    customer: input.customerPhone ? { phone: input.customerPhone } : undefined,
    redirectUrls: { successUrl: input.successUrl, failureUrl: input.failureUrl },
  };

  const out = await fetchJson(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const raw = out.data;

  // First: try the documented shape(s)
  const knownTransactionId =
    raw?.transactionId ??
    raw?.transactionID ??
    raw?.transaction_id ??
    raw?.data?.transactionId ??
    raw?.data?.transactionID ??
    raw?.data?.transaction_id ??
    raw?.result?.transactionId ??
    raw?.result?.transactionID ??
    raw?.result?.transaction_id ??
    raw?.response?.transactionId ??
    raw?.response?.transactionID ??
    raw?.response?.transaction_id ??
    raw?.payload?.transactionId ??
    raw?.payload?.transactionID ??
    raw?.payload?.transaction_id;

  const knownRedirectUrl =
    raw?.redirectUrl ??
    raw?.redirectURL ??
    raw?.redirect_url ??
    raw?.data?.redirectUrl ??
    raw?.data?.redirectURL ??
    raw?.data?.redirect_url ??
    raw?.result?.redirectUrl ??
    raw?.result?.redirectURL ??
    raw?.result?.redirect_url ??
    raw?.response?.redirectUrl ??
    raw?.response?.redirectURL ??
    raw?.response?.redirect_url ??
    raw?.payload?.redirectUrl ??
    raw?.payload?.redirectURL ??
    raw?.payload?.redirect_url ??
    raw?.paymentUrl ??
    raw?.payment_url ??
    raw?.data?.paymentUrl ??
    raw?.data?.payment_url;

  let transactionId = normalizeUuid(knownTransactionId) || (typeof knownTransactionId === 'string' ? knownTransactionId.trim() : '');
  let redirectUrl = isHttpUrl(knownRedirectUrl) ? knownRedirectUrl : '';

  // Second: robust deep extraction (handles additional wrapper objects)
  if (!transactionId) {
    const foundTx = deepFind(raw, (k, v) => {
      if (!isUuid(v)) return false;
      const nk = normKey(k);
      return nk.includes('transaction') && nk.includes('id');
    });
    if (foundTx) transactionId = normalizeUuid(foundTx.value) || (typeof foundTx.value === 'string' ? foundTx.value.trim() : String(foundTx.value ?? '').trim());
  }

  if (!redirectUrl) {
    const foundUrl = deepFind(raw, (k, v) => {
      if (!isHttpUrl(v)) return false;
      const nk = normKey(k);
      return nk.includes('redirect') && nk.includes('url') || nk.includes('payment') && nk.includes('url');
    });
    if (foundUrl && isHttpUrl(foundUrl.value)) redirectUrl = foundUrl.value;
  }

  // Third: if we have a redirectUrl but no explicit transactionId, try extracting it from the URL.
  // This isn't a workaround: the transaction id is still the same UUID the gateway created —
  // we're simply making the integration tolerant to provider response shape changes.
  if (!transactionId && redirectUrl) {
    const extracted = extractTransactionIdFromRedirectUrl(redirectUrl);
    transactionId = normalizeUuid(extracted) || (typeof extracted === 'string' ? extracted.trim() : '') || transactionId;
  }

  
// If provider signals an error explicitly, surface it even if redirectUrl exists.
// Note: some responses return err as a number/boolean and redirectError as an object.
  const providerErrVal =
    (raw as any)?.redirectError ??
    (raw as any)?.redirect_error ??
    (raw as any)?.err ??
    (raw as any)?.error ??
    (raw as any)?.message;

  const providerErr = (() => {
    if (providerErrVal == null) return '';
    const asStr = typeof providerErrVal === 'string' ? providerErrVal : safeStringify(providerErrVal, 400);
    const t = String(asStr).trim();
    // Common "no error" values.
    if (!t || t === '0' || t.toLowerCase() === 'false' || t.toLowerCase() === 'ok') return '';
    return t;
  })();

  if (providerErr && (!transactionId || !redirectUrl)) {
    const details = summarizeInitBody(raw);
    const err: any = new Error(`ZainCash init error: ${providerErr}. ${details || ''}`.trim());
    err.status = out.status;
    err.body = raw;
    throw err;
  }

  if (!transactionId || !redirectUrl) {
    const details = summarizeInitBody(raw);
    const err: any = new Error(
      `Unexpected init response (missing transactionId/redirectUrl). ${details || ''}`.trim(),
    );
    err.status = out.status;
    err.body = raw;
    throw err;
  }

  return { transactionId, redirectUrl, raw };
}

export async function zaincashV2BuildInquiryUrl(cfg: ZaincashV2Config, transactionId: string) {
  return cfg.baseUrl + ZAINCASH_V2_INQUIRY_PREFIX + transactionId;
}

export type ZaincashV2InquiryOut = {
  /** Raw provider status (e.g. SUCCESS, FAILED, OTP_SENT). Empty string if the provider did not return one. */
  status: string;
  /** Full provider response body (JSON parsed when possible). */
  raw: unknown;
};

function coerceStatus(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return '';
}

function looksLikeStatusKey(key: string): boolean {
  const k = normKey(key);
  // Prefer the explicit variants and avoid common false positives.
  if (k.includes('statuscode') || k.includes('httpstatus') || k.includes('statusdescription')) return false;
  return k.includes('currentstatus') || k.includes('transactionstatus') || k === 'status' || k.endsWith('status');
}

/**
 * Inquiry a ZainCash v2 transaction by transactionId.
 * Uses OAuth2 client_credentials (same as init) and returns the provider status + raw body.
 */
export async function zaincashV2Inquiry(
  cfg: ZaincashV2Config,
  transactionId: string,
): Promise<ZaincashV2InquiryOut> {
  const tx = normalizeUuid(transactionId);
  if (!tx) throw new Error('Invalid transactionId');

  const token = await getAccessToken(cfg);
  const url = cfg.baseUrl + ZAINCASH_V2_INQUIRY_PREFIX + encodeURIComponent(tx);

  const out = await fetchJson(url, {
    method: 'GET',
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/json',
    },
  });

  const raw: any = out.data;

  // Try the most likely locations first.
  let status =
    coerceStatus(
      raw?.currentStatus ??
        raw?.current_status ??
        raw?.transactionStatus ??
        raw?.transaction_status ??
        raw?.status ??
        raw?.data?.currentStatus ??
        raw?.data?.current_status ??
        raw?.data?.transactionStatus ??
        raw?.data?.transaction_status ??
        raw?.data?.status ??
        raw?.result?.currentStatus ??
        raw?.result?.transactionStatus ??
        raw?.result?.status ??
        raw?.transaction?.currentStatus ??
        raw?.transaction?.transactionStatus ??
        raw?.transaction?.status,
    ) || '';

  // Fallback: deep scan for a "status"-like key.
  if (!status) {
    const found = deepFind(raw, (k, v) => looksLikeStatusKey(k) && typeof v !== 'object' && v != null);
    if (found) status = coerceStatus(found.value);
  }

  return { status, raw };
}
