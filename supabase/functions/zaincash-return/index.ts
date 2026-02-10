import { createServiceClient } from '../_shared/supabase.ts';
import { errorJson, json } from '../_shared/json.ts';
import { verifyJwtHS256 } from '../_shared/crypto.ts';
import { getZaincashV2Config, zaincashV2Inquiry } from '../_shared/zaincashV2.ts';
import { withRequestContext } from '../_shared/requestContext.ts';

const APP_BASE_URL = (Deno.env.get('APP_BASE_URL') ?? '').replace(/\/$/, '').replace(/\/wallet$/, '');

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

function mapStatus(s: string) {
  const v = (s ?? '').toLowerCase();
  const succeeded = ['success', 'succeeded', 'paid', 'completed', 'captured', 'done', 'approved'].includes(v);
  const failed = ['failed', 'canceled', 'cancelled', 'declined', 'rejected', 'error', 'expired', 'refunded'].includes(v);
  if (succeeded) return 'succeeded' as const;
  if (failed) return 'failed' as const;
  return 'pending' as const;
}

function pickFirstStringDeep(obj: any, paths: string[]): string {
  for (const p of paths) {
    if (!p) continue;

    // Support dot-paths (e.g. "data.orderId").
    const segs = p.split('.').filter(Boolean);
    let cur: any = obj;
    for (const s of segs) {
      if (cur && typeof cur === 'object' && s in cur) cur = cur[s];
      else {
        cur = undefined;
        break;
      }
    }

    if (typeof cur === 'string' && cur.trim()) return cur.trim();
  }
  return '';
}
/**
 * Extracts the redirect JWT token from the request URL.
 *
 * ZainCash redirects back to the provided successUrl / failureUrl with a JWT token
 * in the URL query string. In the wild, some gateways will append `?token=...` even
 * if the provided URL already contained query params, causing the token to end up
 * embedded inside another parameter value (e.g. `result=success?token=...`).
 *
 * We support both:
 *   - `?token=<JWT>`
 *   - `?result=success?token=<JWT>` (token embedded in another param)
 */
function extractRedirectToken(url: URL): string {
  const direct = String(url.searchParams.get('token') ?? url.searchParams.get('jwt') ?? '').trim();
  if (direct) return direct;

  const embeddedCandidates = [
    url.searchParams.get('result'),
    url.searchParams.get('status'),
    url.searchParams.get('redirect'),
  ].filter(Boolean) as string[];

  for (const c of embeddedCandidates) {
    const v = String(c);
    // token embedded as `...token=<JWT>` or `...?token=<JWT>`
    const m = v.match(/(?:\?|&|^)token=([^&]+)/i);
    if (m?.[1]) return String(m[1]).trim();

    // sometimes the embedded token is still percent-encoded
    const m2 = v.match(/token%3D([^&]+)/i);
    if (m2?.[1]) return decodeURIComponent(m2[1]).trim();
  }

  // last resort: scan the raw query string for token (handles `%3Ftoken%3D...`)
  const raw = url.search ?? '';
  const m3 = raw.match(/(?:\?|&|%3F)token(?:=|%3D)([^&]+)/i);
  if (m3?.[1]) return decodeURIComponent(m3[1]).trim();

  return '';
}


Deno.serve((req) =>
  withRequestContext('zaincash-return', req, async (_ctx) => {

  try {
    if (req.method !== 'GET') return errorJson('Method not allowed', 405);

    const url = new URL(req.url);
    const token = extractRedirectToken(url);
    const intentIdQ = String(url.searchParams.get('intentId') ?? '').trim();
    const resultHint = String(url.searchParams.get('result') ?? '').trim().split('?')[0].toLowerCase();

    if (!token) return errorJson('Missing token', 400, 'VALIDATION_ERROR');

    let cfg;
    try {
      cfg = getZaincashV2Config();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return errorJson(`ZainCash v2 is not configured: ${msg}`, 500, 'MISCONFIGURED');
    }

    // Verify redirect token using the ZainCash v2 API key (HS256).
    const payload = await verifyJwtHS256(token, cfg.apiKey).catch(() => null);
    if (!payload) return errorJson('Invalid token', 400, 'INVALID_TOKEN');

    // Try to extract intentId (externalReferenceId/orderId) and transactionId from token.
    // ZainCash status-change redirect/webhook tokens can carry these identifiers either
    // at the top-level or nested under a "data" object (e.g. data.orderId).
    const tokenExternalRef = pickFirstStringDeep(payload, [
      // common
      'externalReferenceId',
      'external_reference_id',
      'externalRef',
      'external_ref',
      'ref',
      // nested
      'data.externalReferenceId',
      'data.external_reference_id',
      // sometimes orderId is the only stable UUID you control
      'data.orderId',
      'data.order_id',
    ]);

    const tokenOrderId = pickFirstStringDeep(payload, [
      'orderId',
      'orderid',
      'order_id',
      'data.orderId',
      'data.order_id',
      'transactionDetails.orderId',
      'data.transactionDetails.orderId',
      'init.transactionDetails.orderId',
    ]);

    const tokenTxId = pickFirstStringDeep(payload, [
      'transactionId',
      'transaction_id',
      'txId',
      'tx_id',
      'id',
      // nested
      'data.transactionId',
      'data.transaction_id',
      // ZainCash status-change tokens often include this and it may match transactionId
      'data.merchantReferenceId',
      'data.merchantReferenceID',
      'transactionDetails.transactionId',
      'data.transactionDetails.transactionId',
      'init.transactionDetails.transactionId',
    ]);

    const intentId =
      (intentIdQ && isUuid(intentIdQ) ? intentIdQ : '') ||
      (tokenExternalRef && isUuid(tokenExternalRef) ? tokenExternalRef : '') ||
      (tokenOrderId && isUuid(tokenOrderId) ? tokenOrderId : '');

    if (!intentId) return errorJson('Invalid intentId', 400, 'VALIDATION_ERROR');

    // Prefer inquiry response as the source of truth if we have a transaction id.
    let finalStatus = pickFirstStringDeep(payload, [
      'status',
      'transactionStatus',
      'transaction_status',
      'result',
      // nested
      'data.currentStatus',
      'data.status',
      'data.transactionStatus',
      'data.transaction_status',
    ]).toLowerCase();
    let inquiryRaw: any = null;

    if (tokenTxId) {
      try {
        const inq = await zaincashV2Inquiry(cfg, tokenTxId);
        finalStatus = String(inq.status ?? finalStatus).toLowerCase();
        inquiryRaw = inq.raw;
      } catch (e) {
        // keep token-derived status, but attach error for diagnostics
        inquiryRaw = { error: e instanceof Error ? e.message : String(e) };
      }
    }

    // If the token didn't carry status, fall back to URL hint.
    if (!finalStatus && resultHint) finalStatus = resultHint;

    const mapped = mapStatus(finalStatus || 'pending');

    const service = createServiceClient();

    // Log provider event (best-effort)
    try {
      await service.from('provider_events').insert({
        provider_code: 'zaincash',
        provider_event_id: tokenTxId ? `redirect:${tokenTxId}` : `redirect:${intentId}`,
        payload: { token_payload: payload, inquiry: inquiryRaw, status: finalStatus, result_hint: resultHint },
      });
    } catch {
      // ignore duplicates
    }

    if (mapped === 'succeeded') {
      const { error: finErr } = await service.rpc('wallet_finalize_topup', {
        p_intent_id: intentId,
        p_provider_tx_id: tokenTxId || null,
        p_provider_payload: { token_payload: payload, inquiry: inquiryRaw, status: finalStatus } as any,
      });
      if (finErr) return errorJson(finErr.message ?? 'Finalize failed', 500, 'FINALIZE_FAILED');
    } else if (mapped === 'failed') {
      const { error: failErr } = await service.rpc('wallet_fail_topup', {
        p_intent_id: intentId,
        p_failure_reason: `zaincash_failed:${finalStatus || 'failed'}`,
        p_provider_payload: { token_payload: payload, inquiry: inquiryRaw, status: finalStatus } as any,
      });
      if (failErr) return errorJson(failErr.message ?? 'Fail update failed', 500, 'FAIL_UPDATE_FAILED');
    } else {
      // pending: persist latest provider payload for debugging
      await service.from('topup_intents').update({ status: 'pending', provider_payload: { token_payload: payload, inquiry: inquiryRaw, status: finalStatus } as any }).eq('id', intentId);
    }

    const dest = APP_BASE_URL
      ? `${APP_BASE_URL}/wallet?tab=topups&intent_id=${encodeURIComponent(intentId)}&status=${encodeURIComponent(finalStatus || mapped)}`
      : null;

    if (dest) return Response.redirect(dest, 302);

    return json({ ok: true, intent_id: intentId, status: finalStatus, provider_tx_id: tokenTxId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return errorJson(msg, 500, 'INTERNAL');
  }
  }),
);
