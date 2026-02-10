import { CURRENCY_IQD } from './constants.ts';

export type ProviderCode = 'qicard' | 'asiapay' | 'zaincash';

export type WebhookTopupResult = {
  outcome: 'succeeded' | 'failed' | 'pending' | 'ignored';
  intentId?: string;
  providerTxId?: string | null;
  reason?: string;
};

export type WebhookWithdrawResult = {
  outcome: 'succeeded' | 'failed' | 'pending' | 'ignored';
  withdrawId?: string;
  providerRef?: string | null;
  reason?: string;
};

export type ServiceClient = {
  from: any;
  rpc: any;
};

function isUuid(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

function pickFirst(...vals: unknown[]) {
  for (const v of vals) {
    if (v === null || v === undefined) continue;
    if (typeof v === 'string' && v.trim() === '') continue;
    return v;
  }
  return null;
}

function mapGenericStatus(raw: string) {
  const s = (raw ?? '').toLowerCase();
  if (['success', 'succeeded', 'paid', 'completed', 'captured', 'done', 'ok', '00'].includes(s)) return 'succeeded';
  if (['fail', 'failed', 'error', 'canceled', 'cancelled', 'declined', 'rejected', 'expired'].includes(s)) return 'failed';
  return 'pending';
}

export async function processTopupWebhook(
  service: ServiceClient,
  providerCode: ProviderCode,
  providerPayload: any,
  correlationId: string | null,
): Promise<WebhookTopupResult> {
  if (providerCode === 'qicard') {
    const payload = providerPayload ?? {};
    const statusRaw = String(
      pickFirst(payload.status, payload.paymentStatus, payload.state, payload.result) ?? '',
    ).toLowerCase();

    const intentId = correlationId ?? String(
      pickFirst(
        payload.reference,
        payload.orderId,
        payload.order_id,
        payload.merchantReference,
        payload.merchant_reference,
        payload?.metadata?.intent_id,
        payload?.metadata?.intentId,
      ) ?? '',
    );

    const providerTxId = String(
      pickFirst(payload.id, payload.paymentId, payload.payment_id, payload.transactionId, payload.transaction_id) ?? '',
    ).trim();

    if (!isUuid(intentId)) return { outcome: 'ignored', reason: 'missing_intent_id' };

    const mapped = mapGenericStatus(statusRaw);

    if (mapped === 'succeeded') {
      const { error } = await service.rpc('wallet_finalize_topup', {
        p_intent_id: intentId,
        p_provider_tx_id: providerTxId || null,
        p_provider_payload: payload,
      });
      if (error) throw new Error(error.message ?? 'wallet_finalize_topup_failed');
      return { outcome: 'succeeded', intentId, providerTxId: providerTxId || null };
    }

    if (mapped === 'failed') {
      const { error } = await service.rpc('wallet_fail_topup', {
        p_intent_id: intentId,
        p_failure_reason: `qicard_failed:${statusRaw || 'failed'}`,
        p_provider_payload: payload,
      });
      if (error) throw new Error(error.message ?? 'wallet_fail_topup_failed');
      return { outcome: 'failed', intentId, providerTxId: providerTxId || null };
    }

    // pending/unknown: update only
    await service
      .from('topup_intents')
      .update({ status: 'pending', provider_tx_id: providerTxId || null, provider_payload: payload })
      .eq('id', intentId);

    return { outcome: 'pending', intentId, providerTxId: providerTxId || null };
  }

  if (providerCode === 'zaincash') {
    const claims = (providerPayload?.claims ?? providerPayload?.webhook ?? providerPayload) as any;
    const raw = providerPayload?.raw ?? null;

    const statusRaw = String(pickFirst(claims?.status, claims?.transactionStatus) ?? '').trim().toLowerCase();
    const txId = String(pickFirst(claims?.transactionId, claims?.transaction_id) ?? '').trim();

    const intentId = correlationId ?? String(
      pickFirst(
        claims?.externalReferenceId,
        claims?.external_reference_id,
        claims?.merchantReference,
      ) ?? '',
    ).trim();

    if (!isUuid(intentId)) return { outcome: 'ignored', reason: 'missing_intent_id' };

    const mapped = mapGenericStatus(statusRaw);

    const payload = { webhook: claims, raw };

    if (mapped === 'succeeded') {
      const { error } = await service.rpc('wallet_finalize_topup', {
        p_intent_id: intentId,
        p_provider_tx_id: txId || null,
        p_provider_payload: payload,
      });
      if (error) throw new Error(error.message ?? 'wallet_finalize_topup_failed');
      return { outcome: 'succeeded', intentId, providerTxId: txId || null };
    }

    if (mapped === 'failed') {
      const { error } = await service.rpc('wallet_fail_topup', {
        p_intent_id: intentId,
        p_failure_reason: `webhook:${statusRaw || 'failed'}`,
        p_provider_payload: payload,
      });
      if (error) throw new Error(error.message ?? 'wallet_fail_topup_failed');
      return { outcome: 'failed', intentId, providerTxId: txId || null };
    }

    await service
      .from('topup_intents')
      .update({ status: 'pending', provider_tx_id: txId || null, provider_payload: payload })
      .eq('id', intentId);

    return { outcome: 'pending', intentId, providerTxId: txId || null };
  }

  if (providerCode === 'asiapay') {
    const paramsObj = providerPayload ?? {};

    const src = String(paramsObj.src ?? paramsObj.Src ?? '');
    const prc = String(paramsObj.prc ?? paramsObj.Prc ?? '');
    const successCode = String(paramsObj.successcode ?? paramsObj.SuccessCode ?? paramsObj.successCode ?? '');

    const ref = correlationId ?? String(
      paramsObj.Ref ?? paramsObj.ref ?? paramsObj.orderRef ?? paramsObj.OrderRef ?? paramsObj.MerchantRef ?? '',
    );

    const payRef = String(paramsObj.PayRef ?? paramsObj.payRef ?? paramsObj.payref ?? '');
    const curr = String(paramsObj.Curr ?? paramsObj.curr ?? paramsObj.currCode ?? paramsObj.CurrCode ?? '');
    const amt = String(paramsObj.Amt ?? paramsObj.amt ?? paramsObj.amount ?? paramsObj.Amount ?? '');

    if (!isUuid(ref)) return { outcome: 'ignored', reason: 'invalid_ref' };

    // Defensive validation: confirm intent exists and amount/currency match.
    const { data: intent, error: intentErr } = await service
      .from('topup_intents')
      .select('id,provider_code,amount_iqd,status,provider_payload')
      .eq('id', ref)
      .maybeSingle();

    if (intentErr) throw new Error(intentErr.message ?? 'intent_lookup_failed');
    if (!intent) return { outcome: 'ignored', reason: 'intent_not_found' };
    if (String(intent.provider_code) !== 'asiapay') return { outcome: 'ignored', reason: 'provider_code_mismatch' };

    const amtNum = Number(amt);
    const amtIqd = Number.isFinite(amtNum) ? Math.trunc(amtNum) : NaN;
    const cfgCurr = String(Deno.env.get('ASIAPAY_CURR_CODE') ?? '').trim();

    const currOk = !cfgCurr || !curr || curr.trim() === cfgCurr || curr.trim().toUpperCase() === CURRENCY_IQD;
    const amtOk = Number.isFinite(amtIqd) && amtIqd > 0 && amtIqd === Number(intent.amount_iqd);

    const isSuccess = String(successCode).trim() === '0' || String(successCode).toLowerCase() === 'success';

    if (!currOk || !amtOk) {
      // Keep pending and attach validation flags.
      try {
        const merged = {
          ...(typeof intent.provider_payload === 'object' && intent.provider_payload ? (intent.provider_payload as Record<string, unknown>) : {}),
          validation: {
            ...(typeof (intent.provider_payload as any)?.validation === 'object' ? (intent.provider_payload as any).validation : {}),
            asiapay: {
              curr_ok: currOk,
              amt_ok: amtOk,
              expected_amount_iqd: intent.amount_iqd,
              got_amount: amt,
              expected_curr_code: cfgCurr || null,
              got_curr: curr || null,
              at: new Date().toISOString(),
            },
          },
          last_datafeed: paramsObj,
        };
        await service
          .from('topup_intents')
          .update({ status: 'pending', provider_tx_id: payRef || null, provider_payload: merged })
          .eq('id', ref);
      } catch {
        // ignore
      }
      return { outcome: 'pending', intentId: ref, providerTxId: payRef || null, reason: 'validation_failed' };
    }

    if (isSuccess) {
      const { error } = await service.rpc('wallet_finalize_topup', {
        p_intent_id: ref,
        p_provider_tx_id: payRef || null,
        p_provider_payload: paramsObj,
      });
      if (error) throw new Error(error.message ?? 'wallet_finalize_topup_failed');
      return { outcome: 'succeeded', intentId: ref, providerTxId: payRef || null };
    }

    const { error } = await service.rpc('wallet_fail_topup', {
      p_intent_id: ref,
      p_failure_reason: `asiapay_failed:${successCode || 'failed'}`,
      p_provider_payload: paramsObj,
    });
    if (error) throw new Error(error.message ?? 'wallet_fail_topup_failed');
    return { outcome: 'failed', intentId: ref, providerTxId: payRef || null };
  }

  return { outcome: 'ignored', reason: 'unknown_provider' };
}

export async function processWithdrawWebhook(
  service: ServiceClient,
  providerCode: ProviderCode,
  providerPayload: any,
  correlationId: string | null,
): Promise<WebhookWithdrawResult> {
  const withdrawId = correlationId;
  if (!withdrawId || !isUuid(withdrawId)) return { outcome: 'ignored', reason: 'missing_or_invalid_withdraw_id' };

  if (providerCode === 'qicard') {
    const payload = providerPayload?.raw ?? providerPayload ?? {};
    const providerRef = String(
      pickFirst(payload.transactionId, payload.transaction_id, payload.txId, payload.tx_id, payload.paymentId, payload.payment_id) ?? '',
    ).trim();
    const status = mapGenericStatus(String(pickFirst(payload.status, payload.result, payload.code, payload.success) ?? ''));

    if (status === 'succeeded') {
      await service
        .from('payout_provider_jobs')
        .update({
          status: 'confirmed',
          provider_ref: providerRef || null,
          confirmed_at: new Date().toISOString(),
          response_payload: payload,
        })
        .eq('withdraw_request_id', withdrawId)
        .eq('payout_kind', 'qicard');

      const { error: finErr } = await service.rpc('system_withdraw_mark_paid', {
        p_request_id: withdrawId,
        p_payout_reference: providerRef || null,
        p_provider_payload: { provider: 'qicard', webhook: payload },
      });
      if (finErr) throw new Error(finErr.message ?? 'system_withdraw_mark_paid_failed');
      return { outcome: 'succeeded', withdrawId, providerRef: providerRef || null };
    }

    if (status === 'failed') {
      await service
        .from('payout_provider_jobs')
        .update({
          status: 'failed',
          provider_ref: providerRef || null,
          failed_at: new Date().toISOString(),
          last_error: String(payload.error ?? payload.message ?? 'failed'),
          response_payload: payload,
        })
        .eq('withdraw_request_id', withdrawId)
        .eq('payout_kind', 'qicard');

      const { error } = await service.rpc('system_withdraw_mark_failed', {
        p_request_id: withdrawId,
        p_error_message: String(payload.error ?? payload.message ?? 'failed'),
        p_provider_payload: { provider: 'qicard', webhook: payload },
      });
      if (error) throw new Error(error.message ?? 'system_withdraw_mark_failed_failed');
      return { outcome: 'failed', withdrawId, providerRef: providerRef || null };
    }

    await service
      .from('payout_provider_jobs')
      .update({ response_payload: payload })
      .eq('withdraw_request_id', withdrawId)
      .eq('payout_kind', 'qicard');

    return { outcome: 'pending', withdrawId, providerRef: providerRef || null };
  }

  if (providerCode === 'asiapay') {
    const payload = providerPayload ?? {};
    const prc = String(payload.prc ?? payload.Prc ?? '');
    const successCode = String(payload.successcode ?? payload.SuccessCode ?? payload.successCode ?? '');
    const payRef = String(payload.PayRef ?? payload.payRef ?? payload.payref ?? '');

    // PayDollar/AsiaPay convention: SuccessCode=0 indicates success
    const mapped = successCode.trim() === '0' || successCode.toLowerCase() === 'success'
      ? 'succeeded'
      : prc.toLowerCase().includes('fail') || successCode === '1' || successCode.toLowerCase() === 'failed'
        ? 'failed'
        : 'pending';

    if (mapped === 'succeeded') {
      await service
        .from('payout_provider_jobs')
        .update({
          status: 'confirmed',
          provider_ref: payRef || null,
          confirmed_at: new Date().toISOString(),
          response_payload: payload,
        })
        .eq('withdraw_request_id', withdrawId)
        .eq('payout_kind', 'asiapay');

      const { error: finErr } = await service.rpc('system_withdraw_mark_paid', {
        p_request_id: withdrawId,
        p_payout_reference: payRef || null,
        p_provider_payload: { provider: 'asiapay', webhook: payload },
      });
      if (finErr) throw new Error(finErr.message ?? 'system_withdraw_mark_paid_failed');
      return { outcome: 'succeeded', withdrawId, providerRef: payRef || null };
    }

    if (mapped === 'failed') {
      await service
        .from('payout_provider_jobs')
        .update({
          status: 'failed',
          provider_ref: payRef || null,
          failed_at: new Date().toISOString(),
          last_error: `successCode=${successCode || ''} prc=${prc || ''}`,
          response_payload: payload,
        })
        .eq('withdraw_request_id', withdrawId)
        .eq('payout_kind', 'asiapay');

      const { error } = await service.rpc('system_withdraw_mark_failed', {
        p_request_id: withdrawId,
        p_error_message: `successCode=${successCode || ''} prc=${prc || ''}`,
        p_provider_payload: { provider: 'asiapay', webhook: payload },
      });
      if (error) throw new Error(error.message ?? 'system_withdraw_mark_failed_failed');
      return { outcome: 'failed', withdrawId, providerRef: payRef || null };
    }

    await service
      .from('payout_provider_jobs')
      .update({ response_payload: payload })
      .eq('withdraw_request_id', withdrawId)
      .eq('payout_kind', 'asiapay');

    return { outcome: 'pending', withdrawId, providerRef: payRef || null };
  }

  if (providerCode === 'zaincash') {
    const claims = providerPayload?.claims ?? providerPayload?.webhook ?? providerPayload ?? {};
    const txId = String(pickFirst(claims.transactionId, claims.transaction_id) ?? '').trim();
    const statusRaw = String(pickFirst(claims.status, claims.transactionStatus) ?? '').trim().toLowerCase();

    const mapped = statusRaw === 'success' || statusRaw === 'paid' || statusRaw === 'completed'
      ? 'succeeded'
      : statusRaw === 'failed' || statusRaw === 'canceled' || statusRaw === 'cancelled' || statusRaw === 'expired'
        ? 'failed'
        : 'pending';

    if (mapped === 'succeeded') {
      await service
        .from('payout_provider_jobs')
        .update({
          status: 'confirmed',
          provider_ref: txId || null,
          confirmed_at: new Date().toISOString(),
          response_payload: providerPayload,
        })
        .eq('withdraw_request_id', withdrawId)
        .eq('payout_kind', 'zaincash');

      const { error: finErr } = await service.rpc('system_withdraw_mark_paid', {
        p_request_id: withdrawId,
        p_payout_reference: txId || null,
        p_provider_payload: { provider: 'zaincash', webhook: claims, raw: providerPayload?.raw ?? null },
      });
      if (finErr) throw new Error(finErr.message ?? 'system_withdraw_mark_paid_failed');
      return { outcome: 'succeeded', withdrawId, providerRef: txId || null };
    }

    if (mapped === 'failed') {
      await service
        .from('payout_provider_jobs')
        .update({
          status: 'failed',
          provider_ref: txId || null,
          failed_at: new Date().toISOString(),
          last_error: `status=${statusRaw || 'failed'}`,
          response_payload: providerPayload,
        })
        .eq('withdraw_request_id', withdrawId)
        .eq('payout_kind', 'zaincash');

      const { error } = await service.rpc('system_withdraw_mark_failed', {
        p_request_id: withdrawId,
        p_error_message: `status=${statusRaw || 'failed'}`,
        p_provider_payload: { provider: 'zaincash', webhook: claims, raw: providerPayload?.raw ?? null },
      });
      if (error) throw new Error(error.message ?? 'system_withdraw_mark_failed_failed');
      return { outcome: 'failed', withdrawId, providerRef: txId || null };
    }

    await service
      .from('payout_provider_jobs')
      .update({ response_payload: providerPayload })
      .eq('withdraw_request_id', withdrawId)
      .eq('payout_kind', 'zaincash');

    return { outcome: 'pending', withdrawId, providerRef: txId || null };
  }

  return { outcome: 'ignored', reason: 'unknown_provider' };
}
