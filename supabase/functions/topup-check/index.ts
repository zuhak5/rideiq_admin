import { createServiceClient, requireUser } from '../_shared/supabase.ts';
import { errorJson, json } from '../_shared/json.ts';
import { buildRateLimitHeaders, consumeRateLimit, getClientIp } from '../_shared/rateLimit.ts';
import { getZaincashV2Config, zaincashV2Inquiry } from '../_shared/zaincashV2.ts';
import { findProvider, getPaymentsPublicConfig } from '../_shared/paymentsConfig.ts';
import { QICARD_DEFAULT_STATUS_PATH } from '../_shared/constants.ts';
import { withRequestContext } from '../_shared/requestContext.ts';


function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

function envTrim(key: string) {
  return (Deno.env.get(key) ?? '').trim();
}

function basicAuthHeader(user: string, pass: string) {
  return `Basic ${btoa(`${user}:${pass}`)}`;
}

function mapStatus(s: string) {
  const v = (s ?? '').toLowerCase();
  const succeeded = ['success', 'succeeded', 'paid', 'completed', 'captured', 'done', 'approved'].includes(v);
  const failed = ['failed', 'canceled', 'cancelled', 'declined', 'rejected', 'error', 'expired', 'refunded'].includes(v);
  if (succeeded) return 'succeeded' as const;
  if (failed) return 'failed' as const;
  return 'pending' as const;
}


async function checkZainCash(txId: string) {
  const cfg = getZaincashV2Config();
  const { status, raw } = await zaincashV2Inquiry(cfg, txId);

  // return statusRaw in lower-case so our mapper can work
  return {
    ok: true,
    statusRaw: String(status ?? '').toLowerCase(),
    payload: {
      transactionId: txId,
      inquiry: raw,
    },
  };
}


async function checkQiCard(providerTxId: string, intentId: string) {
  const baseUrl = String(envTrim('QICARD_BASE_URL') ?? '').replace(/\/$/, '');
  const statusPathEnv = envTrim('QICARD_STATUS_PATH');
  // Default: try `/payment/{id}/status` first.
  let statusPath = String(statusPathEnv || QICARD_DEFAULT_STATUS_PATH).trim();

  const bearerToken = String(envTrim('QICARD_BEARER_TOKEN')).trim();
  const basicUser = String(envTrim('QICARD_BASIC_AUTH_USER')).trim();
  const basicPass = String(envTrim('QICARD_BASIC_AUTH_PASS')).trim();
  const terminalId = String(envTrim('QICARD_TERMINAL_ID')).trim();

  if (!baseUrl) {
    return { ok: false, statusRaw: 'pending', payload: { error: 'qicard_missing_base_url', intentId } };
  }

  const headers: Record<string, string> = { accept: 'application/json' };
  if (basicUser && basicPass) headers.Authorization = basicAuthHeader(basicUser, basicPass);
  else if (bearerToken) headers.Authorization = `Bearer ${bearerToken}`;
  if (terminalId) headers['X-Terminal-Id'] = terminalId;

  async function fetchStatus(url: string) {
    const res = await fetch(url, { method: 'GET', headers });
    const text = await res.text();
    let out: any = null;
    try { out = JSON.parse(text); } catch { out = null; }

    const statusRaw = String(
      out?.status ??
      out?.paymentStatus ??
      out?.state ??
      out?.payment?.status ??
      out?.payment?.paymentStatus ??
      out?.data?.status ??
      out?.result?.status ??
      ''
    ).toLowerCase();

    const providerErrorCode = out?.error?.code ?? out?.errorCode ?? out?.code ?? null;

    return {
      ok: res.ok,
      statusRaw,
      payload: {
        url,
        http_status: res.status,
        provider_error_code: providerErrorCode,
        body: out ?? { raw: text },
      },
    };
  }

  const candidates: string[] = [];
  const add = (u: string) => { if (!candidates.includes(u)) candidates.push(u); };

  add(`${baseUrl}${statusPath}`.replace('{id}', encodeURIComponent(providerTxId)));
  add(`${baseUrl}/payment/{id}/status`.replace('{id}', encodeURIComponent(providerTxId)));
  add(`${baseUrl}/payment/{id}`.replace('{id}', encodeURIComponent(providerTxId)));

  let last: any = null;
  for (const url of candidates) {
    const r = await fetchStatus(url);
    last = r;
    if (r.statusRaw) return r;
    if (r.ok) return r;
  }

  return last ?? { ok: false, statusRaw: 'pending', payload: { error: 'qicard_status_unreachable' } };
}
async function checkAsiaPayFromEvents(service: any, intentId: string) {
  // Prefer the server-to-server datafeed events.
  const patterns = [`datafeed:${intentId}:`, `return:${intentId}:`];

  for (const prefix of patterns) {
    const { data } = await service
      .from('provider_events')
      .select('provider_event_id,payload,received_at')
      .eq('provider_code', 'asiapay')
      .like('provider_event_id', `${prefix}%`)
      .order('received_at', { ascending: false })
      .limit(1);

    const payload = (data?.[0] as any)?.payload ?? null;
    if (!payload) continue;

    const successCode = String(payload?.SuccessCode ?? payload?.successCode ?? payload?.success_code ?? '').trim();
    const statusRaw =
      successCode === '0' || successCode.toLowerCase() === 'success'
        ? 'success'
        : successCode
          ? 'failed'
          : String(payload?.status ?? payload?.result ?? '').toLowerCase() || 'pending';

    const providerTxId = String(payload?.PayRef ?? payload?.payRef ?? payload?.pay_ref ?? payload?.Prc ?? payload?.prc ?? '');

    return { ok: true, statusRaw, payload, providerTxId: providerTxId || null };
  }

  return { ok: true, statusRaw: 'pending', payload: null, providerTxId: null };
}

Deno.serve((req) =>
  withRequestContext('topup-check', req, async (_ctx) => {

  try {
    if (req.method !== 'POST') return errorJson('Method not allowed', 405);

    const { user, error } = await requireUser(req);
    if (!user) return errorJson(error ?? 'Unauthorized', 401, 'UNAUTHORIZED');


    const ip = getClientIp(req);
    const rl = await consumeRateLimit({ key: `topup_check:${user.id}:${ip ?? 'noip'}`, windowSeconds: 60, limit: 60 });
    if (!rl.allowed) {
      return json(
        { error: 'Rate limit exceeded', code: 'RATE_LIMITED', reset_at: rl.resetAt, remaining: rl.remaining },
        429,
        buildRateLimitHeaders({ limit: 60, remaining: rl.remaining, resetAt: rl.resetAt }),
      );
    }

    // Body may be missing JSON headers in some clients. Try JSON first, then text parse.
let body: any = {};
try {
  body = await req.json();
} catch (_) {
  try {
    const txt = await req.text();
    body = txt ? JSON.parse(txt) : {};
  } catch (_) {
    body = {};
  }
}

// Accept multiple field names coming from different clients.
const intentCandidate =
  String(body?.intent_id ?? body?.intentId ?? body?.intent ?? body?.id ?? body?.requestId ?? '').trim() || null;

const paymentCandidate =
  String(
    body?.provider_tx_id ??
      body?.providerTxId ??
      body?.payment_id ??
      body?.paymentId ??
      body?.tx_id ??
      body?.txId ??
      ''
  ).trim() || null;

if (intentCandidate && !isUuid(intentCandidate)) return errorJson('Invalid intent_id', 400, 'VALIDATION_ERROR');
if (paymentCandidate && paymentCandidate.length > 200) return errorJson('Invalid paymentId', 400, 'VALIDATION_ERROR');

const service = createServiceClient();

// Find target intent (always scoped to the authenticated user):
// 1) id (intent_id)
// 2) provider_tx_id (paymentId)
// 3) latest pending/created
let intent: any = null;

async function findById(id: string) {
  const { data } = await service
    .from('topup_intents')
    .select('id,user_id,provider_code,provider_tx_id,status,created_at,provider_payload')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle();
  return data ?? null;
}

async function findByProviderTx(tx: string) {
  const { data } = await service
    .from('topup_intents')
    .select('id,user_id,provider_code,provider_tx_id,status,created_at,provider_payload')
    .eq('provider_tx_id', tx)
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .maybeSingle();
  return data ?? null;
}

if (intentCandidate) {
  intent = await findById(intentCandidate);
  if (!intent) {
    // Many UIs accidentally pass paymentId in place of intent_id
    intent = await findByProviderTx(intentCandidate);
  }
}

if (!intent && paymentCandidate) {
  intent = await findByProviderTx(paymentCandidate);
}

if (!intent) {
  const { data, error: qErr } = await service
    .from('topup_intents')
    .select('id,user_id,provider_code,provider_tx_id,status,created_at,provider_payload')
    .eq('user_id', user.id)
    .in('status', ['pending', 'created'])
    .order('created_at', { ascending: false })
    .limit(1);
  if (qErr) return errorJson(qErr.message ?? 'Query failed', 500, 'QUERY_FAILED');
  intent = (data ?? [])[0] ?? null;
}

if (!intent) {
      // When there are no intents, this is not an error for the UI.
      return json({ ok: true, found: false, code: 'NO_INTENTS' }, 200);
    }

  const intentId = String((intent as any).id);


  const providerCode = String(intent.provider_code ?? '').toLowerCase();
  const providerTxId = String(intent.provider_tx_id ?? '') || null;

const paymentsCfg = getPaymentsPublicConfig();
const provider = findProvider(paymentsCfg, providerCode);
if (!provider || !provider.enabled) {
  return errorJson('Payment provider missing or disabled', 400, 'PROVIDER_DISABLED');
}

const kind = provider.kind;


    let check: { ok: boolean; statusRaw: string; payload: unknown } = { ok: false, statusRaw: 'pending', payload: null };
    let providerTxIdForFinalize = providerTxId;

    if (kind === 'qicard') {
      if (!providerTxIdForFinalize) return errorJson('Missing provider_tx_id', 400, 'MISSING_PROVIDER_TX');
      check = await checkQiCard(providerTxIdForFinalize, intentId);
    } else if (kind === 'zaincash') {
      if (!providerTxIdForFinalize) return errorJson('Missing provider_tx_id', 400, 'MISSING_PROVIDER_TX');
      check = await checkZainCash(providerTxIdForFinalize);
    } else if (kind === 'asiapay') {
      const out = await checkAsiaPayFromEvents(service, intentId);
      check = { ok: true, statusRaw: out.statusRaw, payload: out.payload };
      providerTxIdForFinalize = (out as any).providerTxId ?? providerTxIdForFinalize;
    } else {
      return errorJson('Unsupported provider kind', 400, 'UNSUPPORTED_PROVIDER');
    }

    // Log provider check event (best-effort)
    try {
      await service.from('provider_events').insert({
        provider_code: providerCode,
        provider_event_id: `${providerTxIdForFinalize ?? intentId}:usercheck`,
        payload: { check: check.payload, ok: check.ok, statusRaw: check.statusRaw },
      });
    } catch {
      // ignore duplicates
    }

    const mapped = mapStatus(check.statusRaw);

    if (mapped === 'succeeded') {
      const { error: finErr } = await service.rpc('wallet_finalize_topup', {
        p_intent_id: intentId,
        p_provider_tx_id: providerTxIdForFinalize,
        p_provider_payload: check.payload as any,
      });
      if (finErr) return errorJson(finErr.message ?? 'Finalize failed', 500, 'FINALIZE_FAILED');
      return json({ ok: true, intent_id: intentId, status: 'succeeded' });
    }

    if (mapped === 'failed') {
      const { error: failErr } = await service.rpc('wallet_fail_topup', {
        p_intent_id: intentId,
        p_failure_reason: `${providerCode}_failed:${check.statusRaw || 'failed'}`,
        p_provider_payload: check.payload as any,
      });
      if (failErr) return errorJson(failErr.message ?? 'Fail update failed', 500, 'FAIL_UPDATE_FAILED');
      return json({ ok: true, intent_id: intentId, status: 'failed' });
    }

    // Still pending
    await service
      .from('topup_intents')
      .update({ status: 'pending', provider_payload: check.payload as any })
      .eq('id', intentId);

    return json({ ok: true, intent_id: intentId, status: 'pending' });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return errorJson(msg, 500, 'INTERNAL');
  }
  }),
);
