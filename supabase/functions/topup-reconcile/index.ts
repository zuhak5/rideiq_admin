import { createServiceClient } from '../_shared/supabase.ts';
import { errorJson, json } from '../_shared/json.ts';
import { requireCronSecret } from '../_shared/cronAuth.ts';
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

function parseBool(v: string | null) {
  if (!v) return false;
  const s = v.trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'y' || s === 'on';
}

function mapStatus(s: string) {
  const v = (s ?? '').toLowerCase();
  const succeeded = ['success', 'succeeded', 'paid', 'completed', 'captured', 'done'].includes(v);
  const failed = ['failed', 'canceled', 'cancelled', 'declined', 'rejected', 'error', 'expired', 'refunded'].includes(v);
  if (succeeded) return 'succeeded' as const;
  if (failed) return 'failed' as const;
  return 'pending' as const;
}


async function checkZainCash(txId: string) {
  const cfg = getZaincashV2Config();
  const { status, raw } = await zaincashV2Inquiry(cfg, txId);
  const statusRaw = String(status ?? '').toLowerCase();
  return { ok: true, statusRaw, payload: { transactionId: txId, inquiry: raw } };
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
  add(`${baseUrl}${QICARD_DEFAULT_STATUS_PATH}`.replace('{id}', encodeURIComponent(providerTxId)));
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

async function checkAsiaPayFromEvents(service: ReturnType<typeof createServiceClient>, intentId: string) {
  // PayDollar/AsiaPay recommends using server-to-server datafeed as the source of truth.
  // We reconcile by looking for the latest datafeed event for this intent.
  const { data } = await service
    .from('provider_events')
    .select('provider_event_id,payload,received_at')
    .eq('provider_code', 'asiapay')
    .like('provider_event_id', `datafeed:${intentId}%`)
    .order('received_at', { ascending: false })
    .limit(1);

  const row = (data ?? [])[0] as any;
  if (!row) {
    return { ok: false, statusRaw: 'pending', payload: { reason: 'no_datafeed_event', intentId } as any, providerTxId: null as string | null };
  }

  const payload = (row.payload ?? {}) as Record<string, unknown>;
  const successCode = String((payload as any).successcode ?? (payload as any).SuccessCode ?? (payload as any).successCode ?? '').trim();
  const payRef = String((payload as any).PayRef ?? (payload as any).payRef ?? (payload as any).payref ?? '').trim();

  const isSuccess = successCode === '0' || successCode.toLowerCase() === 'success';
  const statusRaw = isSuccess ? 'success' : 'failed';
  return { ok: true, statusRaw, payload: payload as any, providerTxId: payRef || null };
}

Deno.serve((req) =>
  withRequestContext('topup-reconcile', req, async (_ctx) => {

  try {
    // This function is intended for server-side cron usage.
    const provided = req.headers.get('x-cron-secret') ?? '';
    const cronAuth = requireCronSecret(req);
    if (cronAuth) return cronAuth;

    const url = new URL(req.url);
    const dryRun = parseBool(url.searchParams.get('dry_run')) || parseBool(req.headers.get('x-dry-run'));
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') ?? '50')));
    const providerCodeFilter = (url.searchParams.get('provider_code') ?? '').trim().toLowerCase() || null;
    const intentIdFilter = (url.searchParams.get('intent_id') ?? '').trim() || null;
    const minAgeSeconds = Math.min(3600, Math.max(0, Number(url.searchParams.get('min_age_seconds') ?? '120')));

    if (intentIdFilter && !isUuid(intentIdFilter)) return errorJson('Invalid intent_id', 400, 'VALIDATION_ERROR');

    const service = createServiceClient();

    let q = service
      .from('topup_intents')
      .select('id,user_id,provider_code,provider_tx_id,status,created_at,provider_payload')
      .in('status', ['created', 'pending'])
      .order('created_at', { ascending: true })
      .limit(limit);

    if (providerCodeFilter) q = q.eq('provider_code', providerCodeFilter);
    if (intentIdFilter) q = q.eq('id', intentIdFilter);

    const { data: intents, error } = await q;
    if (error) return errorJson(error.message ?? 'Query failed', 500, 'QUERY_FAILED');

    const now = Date.now();
    const results: Array<Record<string, unknown>> = [];

    for (const intent of intents ?? []) {
      const createdAt = new Date(String((intent as any).created_at ?? '')).getTime();
      if (Number.isFinite(createdAt) && now - createdAt < minAgeSeconds * 1000) continue;

      const intentId = String((intent as any).id);
      const providerCode = String((intent as any).provider_code ?? '').toLowerCase();
      const providerTxId = String((intent as any).provider_tx_id ?? '') || null;

const paymentsCfg = getPaymentsPublicConfig();
const provider = findProvider(paymentsCfg, providerCode);
if (!provider || !provider.enabled) {
  results.push({ intent_id: intentId, provider_code: providerCode, action: 'skipped', reason: 'provider_missing_or_disabled' });
  continue;
}

const kind = provider.kind;


      let check: { ok: boolean; statusRaw: string; payload: unknown; providerTxId?: string | null };
      let providerTxIdForFinalize: string | null = providerTxId;
      if (kind === 'zaincash') {
        if (!providerTxId) {
          results.push({ intent_id: intentId, provider_code: providerCode, action: 'skipped', reason: 'missing_provider_tx_id' });
          continue;
        }
        check = await checkZainCash(providerTxId);
      } else if (kind === 'qicard') {
        if (!providerTxId) {
          results.push({ intent_id: intentId, provider_code: providerCode, action: 'skipped', reason: 'missing_provider_tx_id' });
          continue;
        }
        check = await checkQiCard(providerTxId, intentId);
      } else if (kind === 'asiapay') {
        check = await checkAsiaPayFromEvents(service, intentId);
        providerTxIdForFinalize = (check as any).providerTxId ?? providerTxIdForFinalize;
      } else {
        results.push({ intent_id: intentId, provider_code: providerCode, action: 'skipped', reason: 'unsupported_provider_kind' });
        continue;
      }

      // Log provider check event (best effort). In dry-run we avoid writes.
      if (!dryRun) {
        try {
          await service.from('provider_events').insert({
            provider_code: providerCode,
            provider_event_id: `${providerTxIdForFinalize ?? intentId}:reconcile`,
            payload: { check: check.payload, ok: check.ok, statusRaw: check.statusRaw },
          });
        } catch {
          // ignore duplicates
        }
      }

      const mapped = mapStatus(check.statusRaw);
      if (mapped === 'succeeded') {
        if (dryRun) {
          results.push({ intent_id: intentId, provider_code: providerCode, action: 'would_finalize', provider_tx_id: providerTxIdForFinalize });
          continue;
        }
        const { error: finErr } = await service.rpc('wallet_finalize_topup', {
          p_intent_id: intentId,
          p_provider_tx_id: providerTxIdForFinalize,
          p_provider_payload: check.payload as any,
        });
        if (finErr) {
          results.push({ intent_id: intentId, provider_code: providerCode, action: 'error', error: finErr.message });
        } else {
          results.push({ intent_id: intentId, provider_code: providerCode, action: 'finalized' });
        }
      } else if (mapped === 'failed') {
        if (dryRun) {
          results.push({ intent_id: intentId, provider_code: providerCode, action: 'would_fail', reason: `${providerCode}_failed:${check.statusRaw || 'failed'}` });
          continue;
        }
        const { error: failErr } = await service.rpc('wallet_fail_topup', {
          p_intent_id: intentId,
          p_failure_reason: `${providerCode}_failed:${check.statusRaw || 'failed'}`,
          p_provider_payload: check.payload as any,
        });
        if (failErr) {
          results.push({ intent_id: intentId, provider_code: providerCode, action: 'error', error: failErr.message });
        } else {
          results.push({ intent_id: intentId, provider_code: providerCode, action: 'failed' });
        }
      } else {
        if (dryRun) {
          results.push({ intent_id: intentId, provider_code: providerCode, action: 'would_mark_pending' });
        } else {
          await service
            .from('topup_intents')
            .update({ status: 'pending', provider_payload: check.payload as any })
            .eq('id', intentId);
          results.push({ intent_id: intentId, provider_code: providerCode, action: 'pending' });
        }
      }
    }

    return json({ ok: true, dry_run: dryRun, processed: results.length, results });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return errorJson(msg, 500, 'INTERNAL');
  }
  }),
);
