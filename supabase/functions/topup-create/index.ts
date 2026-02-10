import { createServiceClient, requireUser } from '../_shared/supabase.ts';
import { errorJson, json } from '../_shared/json.ts';
import { buildRateLimitHeaders, consumeRateLimit, getClientIp } from '../_shared/rateLimit.ts';
import { logAppEvent } from '../_shared/log.ts';
import { SUPABASE_URL } from '../_shared/config.ts';
import { shaHex } from '../_shared/crypto.ts';
import { CURRENCY_IQD, ISO4217_NUMERIC_IQD, QICARD_DEFAULT_CREATE_PATH } from '../_shared/constants.ts';
import { getZaincashV2Config, zaincashV2InitPayment } from '../_shared/zaincashV2.ts';
import { findPreset, findProvider, getPaymentsPublicConfig } from '../_shared/paymentsConfig.ts';
import { withRequestContext } from '../_shared/requestContext.ts';
import { emitMetricBestEffort, metricTimer } from '../_shared/metrics.ts';
import {
  expiresIso,
  fraudEnforceActionBestEffort,
  fraudGetActiveActionBestEffort,
  fraudLogEventBestEffort,
  fraudOpenCaseBestEffort,
} from '../_shared/fraud.ts';

type Body = {
  provider_code?: string;
  preset_id?: string;
  idempotency_key?: string;
};

const APP_SERVICE_TYPE = Deno.env.get('TOPUP_SERVICE_TYPE') ?? 'Ride top-up';

const ACTION_BLOCK = 'block_topup_create';

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}


function envTrim(key: string) {
  return (Deno.env.get(key) ?? '').trim();
}

function basicAuthHeader(user: string, pass: string) {
  return `Basic ${btoa(`${user}:${pass}`)}`;
}


// (JWT signing + SHA helpers moved to _shared/crypto.ts)

Deno.serve((req) =>
  withRequestContext('topup-create', req, async (ctx) => {

    const stopTimer = metricTimer(ctx, 'metric.payment.topup_create_latency', { payload: {} });
    let rateHeaders: Record<string, string> = {};

    try {
      if (req.method !== 'POST') {
        emitMetricBestEffort(ctx, { event_type: 'metric.payment.topup_create', level: 'warn', payload: { ok: false, reason: 'method' } });
        await stopTimer('ok', { ok: false, reason: 'method' });
        return errorJson('Method not allowed', 405, 'METHOD_NOT_ALLOWED', undefined, ctx.headers);
      }

      const { user, error: authError } = await requireUser(req, ctx);
      if (!user) {
        emitMetricBestEffort(ctx, { event_type: 'metric.payment.topup_create', level: 'warn', payload: { ok: false, reason: 'unauthorized' } });
        await stopTimer('ok', { ok: false, reason: 'unauthorized' });
        return errorJson(String(authError ?? 'Unauthorized'), 401, 'UNAUTHORIZED', undefined, ctx.headers);
      }

      ctx.setUserId(user.id);

      // Enforcement gate (best-effort; fails open)
      {
        const active = await fraudGetActiveActionBestEffort({ actionType: 'block_topup_create', subjectKind: 'user', subjectId: user.id });
        if (active) {
          await fraudLogEventBestEffort({
            reason: 'payment_fraud_blocked',
            subjectKind: 'user',
            subjectId: user.id,
            severity: 2,
            score: 20,
            metadata: { action_type: 'block_topup_create', action_id: active.id, expires_at: active.expires_at },
            req,
          });

          emitMetricBestEffort(ctx, { event_type: 'metric.payment.topup_create', level: 'warn', payload: { ok: false, reason: 'blocked' } });
          await stopTimer('ok', { ok: false, reason: 'blocked' });
          return json({ error: 'Temporarily blocked', code: 'BLOCKED', retry_at: active.expires_at ?? null }, 429, ctx.headers);
        }
      }

      const ip = getClientIp(req);
      const limit = 10;
      const rl = await consumeRateLimit({ key: `topup:${user.id}:${ip ?? 'noip'}`, windowSeconds: 60, limit });
      if (!rl.allowed) {
        const expiresAt = expiresIso(60);
        await fraudLogEventBestEffort({
          reason: 'payment_fraud_topup_velocity',
          subjectKind: 'user',
          subjectId: user.id,
          severity: 3,
          score: 60,
          metadata: { limit, window_seconds: 60, ip_present: !!ip },
          req,
        });
        await fraudOpenCaseBestEffort({
          reason: 'payment_fraud_suspected',
          subjectKind: 'user',
          subjectId: user.id,
          severity: 3,
          metadata: { source: 'topup-create', limit, window_seconds: 60 },
        });
        await fraudEnforceActionBestEffort({
          actionType: 'block_topup_create',
          reason: 'velocity',
          subjectKind: 'user',
          subjectId: user.id,
          severity: 3,
          expiresAt,
          metadata: { limit, window_seconds: 60 },
        });

        emitMetricBestEffort(ctx, { event_type: 'metric.payment.topup_create', level: 'warn', payload: { ok: false, reason: 'rate_limited' } });
        await stopTimer('ok', { ok: false, reason: 'rate_limited', reset_at: rl.resetAt });
        return json(
          { error: 'Rate limit exceeded', code: 'RATE_LIMITED', reset_at: rl.resetAt, remaining: rl.remaining },
          429,
          {
            ...ctx.headers,
            ...buildRateLimitHeaders({ limit, remaining: rl.remaining, resetAt: rl.resetAt }),
            'Retry-After': String(Math.max(1, Math.ceil((new Date(rl.resetAt).getTime() - Date.now()) / 1000))),
          },
        );
      }

      rateHeaders = buildRateLimitHeaders({ limit, remaining: rl.remaining, resetAt: rl.resetAt });

      const body: Body = await req.json().catch(() => ({}));
      const providerCode = (body.provider_code ?? '').trim().toLowerCase();
      const presetId = (body.preset_id ?? '').trim();
      const idempotencyKey = (body.idempotency_key ?? '').trim() || null;

      if (!providerCode) {
        emitMetricBestEffort(ctx, { event_type: 'metric.payment.topup_create', level: 'warn', payload: { ok: false, reason: 'validation', field: 'provider_code' } });
        await stopTimer('ok', { ok: false, reason: 'validation', field: 'provider_code' });
        return errorJson('provider_code is required', 400, 'VALIDATION_ERROR', undefined, { ...ctx.headers, ...rateHeaders });
      }
      if (!presetId) {
        emitMetricBestEffort(ctx, { event_type: 'metric.payment.topup_create', level: 'warn', payload: { ok: false, reason: 'validation', field: 'preset_id', provider_code: providerCode } });
        await stopTimer('ok', { ok: false, reason: 'validation', field: 'preset_id', provider_code: providerCode });
        return errorJson('preset_id is required', 400, 'VALIDATION_ERROR', undefined, { ...ctx.headers, ...rateHeaders });
      }

      const service = createServiceClient();

    // Payment provider + presets are configured via Edge Function secrets (not DB seed rows)
      let paymentsCfg;
      try {
        paymentsCfg = getPaymentsPublicConfig();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        emitMetricBestEffort(ctx, { event_type: 'metric.payment.misconfigured', level: 'error', payload: { provider_code: providerCode, error: msg } });
        await stopTimer('error', { ok: false, reason: 'misconfigured', provider_code: providerCode, error: msg });
        return errorJson(`Payments config is not configured: ${msg}`, 500, 'MISCONFIGURED', undefined, { ...ctx.headers, ...rateHeaders });
      }

      const provider = findProvider(paymentsCfg, providerCode);
      if (!provider) {
        emitMetricBestEffort(ctx, { event_type: 'metric.payment.topup_create', level: 'warn', payload: { ok: false, reason: 'provider_not_found', provider_code: providerCode } });
        await stopTimer('ok', { ok: false, reason: 'provider_not_found', provider_code: providerCode });
        return errorJson('Payment provider not found', 404, 'NOT_FOUND', undefined, { ...ctx.headers, ...rateHeaders });
      }
      if (!provider.enabled) {
        emitMetricBestEffort(ctx, { event_type: 'metric.payment.topup_create', level: 'warn', payload: { ok: false, reason: 'provider_disabled', provider_code: providerCode } });
        await stopTimer('ok', { ok: false, reason: 'provider_disabled', provider_code: providerCode });
        return errorJson('Payment provider is disabled', 409, 'PROVIDER_DISABLED', undefined, { ...ctx.headers, ...rateHeaders });
      }

      const preset = findPreset(provider, presetId);
      if (!preset || !preset.active) {
        emitMetricBestEffort(ctx, { event_type: 'metric.payment.topup_create', level: 'warn', payload: { ok: false, reason: 'preset_not_found', provider_code: providerCode, preset_id: presetId } });
        await stopTimer('ok', { ok: false, reason: 'preset_not_found', provider_code: providerCode, preset_id: presetId });
        return errorJson('Top-up preset not found', 404, 'NOT_FOUND', undefined, { ...ctx.headers, ...rateHeaders });
      }

      const amountIqd = Number(preset.amount_iqd ?? 0);
      const bonusIqd = Number(preset.bonus_iqd ?? 0);
      if (!Number.isFinite(amountIqd) || amountIqd <= 0) {
        emitMetricBestEffort(ctx, { event_type: 'metric.payment.topup_create', level: 'warn', payload: { ok: false, reason: 'validation', field: 'amount', provider_code: providerCode, preset_id: presetId } });
        await stopTimer('ok', { ok: false, reason: 'validation', field: 'amount', provider_code: providerCode, preset_id: presetId });
        return errorJson('Invalid preset amount', 400, 'VALIDATION_ERROR', undefined, { ...ctx.headers, ...rateHeaders });
      }

    // Insert intent. If the user passes an idempotency_key and it already exists, return existing intent.
    let intentId: string | null = null;
    {
      const { data: ins, error: insErr } = await service
        .from('topup_intents')
        .insert({
          user_id: user.id,
          provider_code: provider.code,
          // We don't rely on seeded DB rows for payment configuration.
          package_id: null,
          amount_iqd: amountIqd,
          bonus_iqd: bonusIqd,
          status: 'created',
          idempotency_key: idempotencyKey,
          provider_payload: { preset_id: presetId },
        })
        .select('id')
        .single();

      if (insErr) {
        const msg = insErr.message ?? '';
        if (idempotencyKey && (msg.includes('duplicate') || msg.includes('23505') || msg.includes('unique'))) {
          const { data: existing, error: exErr } = await service
            .from('topup_intents')
            .select('id')
            .eq('user_id', user.id)
            .eq('idempotency_key', idempotencyKey)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          if (exErr || !existing) {
            emitMetricBestEffort(ctx, { event_type: 'metric.payment.topup_create', level: 'error', payload: { ok: false, reason: 'intent_create_failed', provider_code: providerCode, preset_id: presetId, error: exErr?.message ?? null } });
            await stopTimer('error', { ok: false, reason: 'intent_create_failed', provider_code: providerCode, preset_id: presetId, error: exErr?.message ?? null });
            return errorJson('Failed to create top-up intent', 500, 'INTENT_CREATE_FAILED', undefined, { ...ctx.headers, ...rateHeaders });
          }
          intentId = existing.id as string;
        } else {
          await logAppEvent({
            event_type: 'topup_intent_create_error',
            actor_id: user.id,
            actor_type: 'rider',
            payload: { message: msg, provider: provider.code, preset_id: presetId },
          });
          emitMetricBestEffort(ctx, { event_type: 'metric.payment.topup_create', level: 'error', payload: { ok: false, reason: 'intent_create_failed', provider_code: providerCode, preset_id: presetId, error: msg } });
          await stopTimer('error', { ok: false, reason: 'intent_create_failed', provider_code: providerCode, preset_id: presetId, error: msg });
          return errorJson('Failed to create top-up intent', 500, 'INTENT_CREATE_FAILED', undefined, { ...ctx.headers, ...rateHeaders });
        }
      } else {
        intentId = (ins as any)?.id ?? null;
      }
    }

    if (!intentId) {
      emitMetricBestEffort(ctx, {
        event_type: 'metric.payment.topup_create',
        level: 'error',
        payload: { ok: false, reason: 'intent_create_failed', provider_code: providerCode, preset_id: presetId },
      });
      await stopTimer('error', { ok: false, reason: 'intent_create_failed', provider_code: providerCode, preset_id: presetId });
      return errorJson('Failed to create top-up intent', 500, 'INTENT_CREATE_FAILED', undefined, { ...ctx.headers, ...rateHeaders });
    }

    ctx.setCorrelationId(intentId);

    const providerKind = String((provider as any).kind ?? '').toLowerCase();

    // Provider-specific init.
    if (providerKind === 'zaincash') {
      // ZainCash amount is IQD integer, min 250.
      if (amountIqd < 250) {
        emitMetricBestEffort(ctx, { event_type: 'metric.payment.topup_create', level: 'warn', payload: { ok: false, reason: 'validation', field: 'amount', provider_code: providerCode, preset_id: presetId } });
        await stopTimer('ok', { ok: false, reason: 'validation', field: 'amount', provider_code: providerCode, preset_id: presetId });
        return errorJson('Minimum top-up is 250 IQD.', 400, 'VALIDATION_ERROR', undefined, { ...ctx.headers, ...rateHeaders });
      }

      let cfg;
      try {
        cfg = getZaincashV2Config();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        emitMetricBestEffort(ctx, { event_type: 'metric.payment.misconfigured', level: 'error', payload: { provider_code: 'zaincash', error: msg } });
        await stopTimer('error', { ok: false, reason: 'misconfigured', provider_code: 'zaincash', error: msg });
        return errorJson(`ZainCash v2 is not configured: ${msg}`, 500, 'MISCONFIGURED', undefined, { ...ctx.headers, ...rateHeaders });
      }
      const base = SUPABASE_URL.replace(/\/$/, '');

      // IMPORTANT:
      // ZainCash redirects back to successUrl/failureUrl by appending a `token` query parameter.
      // Some gateways append `?token=...` even if the provided URL already has query params,
      // which can break parsing and cause "Missing token" errors.
      // To be robust, we keep the return URLs free of our own query parameters and derive
      // intentId + status from the signed token (and/or inquiry) in `zaincash-return`.
      const returnUrl = `${base}/functions/v1/zaincash-return`;
      const successUrl = returnUrl;
      const failureUrl = returnUrl;



      const initPayload = {
        // Use intentId as a UUID externalReferenceId (idempotency key)
        externalReferenceId: intentId,
        orderId: intentId,
        amountIQD: Math.trunc(amountIqd),
        // Optional: you can pass user phone if you have it; we keep it unset here.
        customerPhone: null,
        successUrl: successUrl.toString(),
        failureUrl: failureUrl.toString(),
      };

      let transactionId = '';
      let redirectUrl = '';
      let raw: unknown = null;

      try {
        const out = await zaincashV2InitPayment(cfg, initPayload);
        transactionId = out.transactionId;
        redirectUrl = out.redirectUrl;
        raw = out.raw;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const status = (e as any)?.status;
        const body = (e as any)?.body;

        // Best-effort provider event logging (safe for debugging; does not include secrets)
        try {
          await service.from('provider_events').insert({
            provider_code: provider.code,
            provider_event_id: `init:${intentId}`,
            payload: { request: initPayload, response: body ?? null, status: status ?? null, error: msg },
          });
        } catch {
          // ignore duplicates
        }

        await service
          .from('topup_intents')
          .update({
            status: 'failed',
            failure_reason: `zaincash_init_failed:${String(status ?? 'unknown')}`,
            provider_payload: { error: { message: msg, status: status ?? null, body: body ?? null }, request: initPayload },
          })
          .eq('id', intentId);

        emitMetricBestEffort(ctx, {
          event_type: 'metric.payment.provider_error',
          level: 'error',
          payload: { provider_code: 'zaincash', intent_id: intentId, status: status ?? null, error: msg },
        });
        await stopTimer('error', { ok: false, reason: 'provider_error', provider_code: 'zaincash', status: status ?? null });
        return errorJson('Failed to initialize ZainCash payment.', 502, 'PROVIDER_ERROR', { provider_message: msg }, { ...ctx.headers, ...rateHeaders });
      }


      await service
        .from('topup_intents')
        .update({
          status: 'pending',
          provider_tx_id: transactionId,
          provider_payload: { init: raw, external_reference_id: intentId },
        })
        .eq('id', intentId);

      await logAppEvent({
        event_type: 'topup_intent_created',
        actor_id: user.id,
        actor_type: 'rider',
        payload: { intent_id: intentId, provider: 'zaincash', provider_tx_id: transactionId, amount: amountIqd },
      });

      emitMetricBestEffort(ctx, {
        event_type: 'metric.payment.topup_create',
        payload: { ok: true, provider_code: 'zaincash', intent_id: intentId, amount_iqd: amountIqd, preset_id: presetId },
      });
      await stopTimer('ok', { ok: true, provider_code: 'zaincash', intent_id: intentId });

      return json({
        ok: true,
        intent_id: intentId,
        provider_tx_id: transactionId,
        redirect_url: redirectUrl,
        rate_limit: { remaining: rl.remaining, reset_at: rl.resetAt },
      }, 200, { ...ctx.headers, ...rateHeaders });
    }




    if (providerKind === 'asiapay') {
      // Provider settings are stored as Edge Function secrets (env vars), not DB rows.
      const paymentUrl = envTrim('ASIAPAY_PAYMENT_URL');
      const merchantId = envTrim('ASIAPAY_MERCHANT_ID');
      const secret = envTrim('ASIAPAY_SECURE_HASH_SECRET');
      const currCode = (envTrim('ASIAPAY_CURR_CODE') || ISO4217_NUMERIC_IQD).trim();
      const payType = (envTrim('ASIAPAY_PAY_TYPE') || 'N').trim() || 'N';
      const lang = (envTrim('ASIAPAY_LANG') || 'E').trim() || 'E';
      const hashTypeRaw = (envTrim('ASIAPAY_SECURE_HASH_TYPE') || 'sha1').toLowerCase();
      const secureHashType = hashTypeRaw === 'sha256' ? 'sha256' : 'sha1';

      if (!paymentUrl || !merchantId || !secret) {
        await service
          .from('topup_intents')
          .update({ status: 'failed', failure_reason: 'asiapay_missing_config' })
          .eq('id', intentId);
        emitMetricBestEffort(ctx, { event_type: 'metric.payment.misconfigured', level: 'error', payload: { provider_code: 'asiapay', reason: 'missing_config' } });
        await stopTimer('error', { ok: false, reason: 'misconfigured', provider_code: 'asiapay' });
        return errorJson(
          'AsiaPay is not configured. Set payment_url, merchant_id and secure_hash_secret in provider config.',
          500,
          'MISCONFIGURED',
          undefined,
          { ...ctx.headers, ...rateHeaders },
        );
      }

      const returnUrl = `${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/asiapay-return`;

      // Amount for PayDollar is numeric (often supports decimals). We send IQD integer string.
      const amountStr = String(Math.trunc(amountIqd));

      // Signing data string = Merchant ID|Merchant Reference (orderRef)|Currency Code|Amount|Payment Type|Secure Hash Secret
      const signing = `${merchantId}|${intentId}|${currCode}|${amountStr}|${payType}|${secret}`;
      const algo = secureHashType === 'sha256' ? ('SHA-256' as const) : ('SHA-1' as const);
      const secureHash = await shaHex(algo, signing);

      const postFields: Record<string, string> = {
        merchantId,
        orderRef: intentId,
        amount: amountStr,
        currCode,
        payType,
        successUrl: returnUrl,
        failUrl: returnUrl,
        errorUrl: returnUrl,
        lang,
        secureHash,
      };
      // Some merchant accounts require explicit secureHashType parameter.
      postFields.secureHashType = secureHashType;

      // Best-effort provider event logging.
      try {
        await service.from('provider_events').insert({
          provider_code: provider.code,
          provider_event_id: `init:${intentId}`,
          payload: { post_url: paymentUrl, post_fields: postFields },
        });
      } catch {
        // ignore duplicates
      }

      await service
        .from('topup_intents')
        .update({
          status: 'pending',
          provider_tx_id: null,
          provider_payload: { init: { post_url: paymentUrl, post_fields: postFields } },
        })
        .eq('id', intentId);

      await logAppEvent({
        event_type: 'topup_intent_created',
        actor_id: user.id,
        actor_type: 'rider',
        payload: { intent_id: intentId, provider: 'asiapay', amount: amountIqd },
      });

      emitMetricBestEffort(ctx, {
        event_type: 'metric.payment.topup_create',
        payload: { ok: true, provider_code: 'asiapay', intent_id: intentId, amount_iqd: amountIqd, preset_id: presetId },
      });
      await stopTimer('ok', { ok: true, provider_code: 'asiapay', intent_id: intentId });

      return json({
        ok: true,
        intent_id: intentId,
        post_url: paymentUrl,
        post_fields: postFields,
        rate_limit: { remaining: rl.remaining, reset_at: rl.resetAt },
      }, 200, { ...ctx.headers, ...rateHeaders });
    }

    if (providerKind === 'qicard') {
  const baseUrl = String(envTrim('QICARD_BASE_URL')).replace(/\/$/, '');
  // QiCard sandbox docs typically expose: .../api/v1/payment
  // So default `createPath` is `/payment` when baseUrl already ends with `/api/v1`.
  const createPath = String(envTrim('QICARD_CREATE_PATH') || QICARD_DEFAULT_CREATE_PATH);
  const bearerToken = String(envTrim('QICARD_BEARER_TOKEN')).trim();
  const basicUser = String(envTrim('QICARD_BASIC_AUTH_USER')).trim();
  const basicPass = String(envTrim('QICARD_BASIC_AUTH_PASS')).trim();
  const terminalId = String(envTrim('QICARD_TERMINAL_ID')).trim();
  const currency = String(envTrim('QICARD_CURRENCY') || CURRENCY_IQD).trim() || CURRENCY_IQD;

      if (!baseUrl) {
        await service.from('topup_intents').update({ status: 'failed', failure_reason: 'qicard_missing_base_url' }).eq('id', intentId);
        emitMetricBestEffort(ctx, { event_type: 'metric.payment.misconfigured', level: 'error', payload: { provider_code: 'qicard', reason: 'missing_base_url' } });
        await stopTimer('error', { ok: false, reason: 'misconfigured', provider_code: 'qicard' });
        return errorJson('QiCard is not configured (missing QICARD_BASE_URL).', 500, 'MISCONFIGURED', undefined, { ...ctx.headers, ...rateHeaders });
      }

  const notifyUrl = `${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/qicard-notify`;
  const defaultReturnUrl = `${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/qicard-return`;
  const returnUrl = String(envTrim('QICARD_RETURN_URL') || defaultReturnUrl);

  const payload: Record<string, unknown> = {
    // QiCard requires requestId uniqueness per merchant terminal.
    // Use the topup intent UUID for idempotency + correlation.
    requestId: intentId,
    amount: Math.trunc(amountIqd),
    currency,
    description: `${APP_SERVICE_TYPE} (${preset.label})`,
    reference: intentId,
    callbackUrl: notifyUrl,
    returnUrl,
    metadata: { intent_id: intentId, user_id: user.id, provider: provider.code, preset_id: preset.id },
  };

  const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json' };
  if (basicUser && basicPass) headers.Authorization = basicAuthHeader(basicUser, basicPass);
  else if (bearerToken) headers.Authorization = `Bearer ${bearerToken}`;
  if (terminalId) headers['X-Terminal-Id'] = terminalId;

  const res = await fetch(`${baseUrl}${createPath}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  let out: any = null;
  try {
    out = JSON.parse(text);
  } catch {
    out = null;
  }

  const redirectUrl = String(out?.formUrl ?? out?.form_url ?? out?.checkoutUrl ?? out?.url ?? out?.redirect_url ?? '');
  const providerTxId = String(out?.paymentId ?? out?.payment_id ?? out?.id ?? out?.txId ?? out?.transactionId ?? '');

  // Log response for debugging/idempotency.
  try {
    await service.from('provider_events').insert({
      provider_code: provider.code,
      provider_event_id: providerTxId || `init:${intentId}`,
      payload: { request: payload, response: out ?? text, status: res.status },
    });
  } catch {
    // ignore duplicates
  }

  if (!res.ok || !redirectUrl) {
    await service
      .from('topup_intents')
      .update({ status: 'failed', failure_reason: `qicard_init_failed:${res.status}`, provider_payload: { init: out ?? text, request: payload } })
      .eq('id', intentId);
    emitMetricBestEffort(ctx, { event_type: 'metric.payment.provider_error', level: 'error', payload: { provider_code: 'qicard', intent_id: intentId, status: res.status, error: out?.error ?? null } });
    await stopTimer('error', { ok: false, reason: 'provider_error', provider_code: 'qicard', status: res.status });
    return errorJson('Failed to initialize QiCard payment.', 502, 'PROVIDER_ERROR', undefined, { ...ctx.headers, ...rateHeaders });
  }

  await service
    .from('topup_intents')
    .update({ status: 'pending', provider_tx_id: providerTxId || null, provider_payload: { init: out ?? {}, request: payload } })
    .eq('id', intentId);

  await logAppEvent({
    event_type: 'topup_intent_created',
    actor_id: user.id,
    actor_type: 'rider',
    payload: { intent_id: intentId, provider: 'qicard', provider_tx_id: providerTxId || null, amount: amountIqd, preset_id: preset.id },
  });

  emitMetricBestEffort(ctx, { event_type: 'metric.payment.topup_create', payload: { ok: true, provider_code: 'qicard', intent_id: intentId, amount_iqd: amountIqd, preset_id: presetId } });
  await stopTimer('ok', { ok: true, provider_code: 'qicard', intent_id: intentId });
  return json(
    { ok: true, intent_id: intentId, redirect_url: redirectUrl, rate_limit: { remaining: rl.remaining, reset_at: rl.resetAt } },
    200,
    { ...ctx.headers, ...rateHeaders },
  );
}

      emitMetricBestEffort(ctx, {
        event_type: 'metric.payment.topup_create',
        level: 'warn',
        payload: { ok: false, reason: 'not_implemented', provider_code: providerCode, preset_id: presetId },
      });
      await stopTimer('ok', { ok: false, reason: 'not_implemented', provider_code: providerCode });
      return errorJson(
        'This payment provider is not yet supported in the current app build.',
        400,
        'NOT_IMPLEMENTED',
        undefined,
        { ...ctx.headers, ...rateHeaders },
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      emitMetricBestEffort(ctx, { event_type: 'metric.payment.topup_create', level: 'error', payload: { ok: false, reason: 'internal_error', error: msg } });
      await stopTimer('error', { ok: false, reason: 'internal_error' });
      return errorJson(msg, 500, 'INTERNAL', undefined, { ...ctx.headers, ...rateHeaders });
    }
  }),
);
