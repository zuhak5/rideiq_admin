import { hmacSha256Bytes, shaHex } from './crypto.ts';

export type PayoutKind = 'qicard' | 'asiapay' | 'zaincash';

export type PayoutJob = {
  id: string;
  withdraw_request_id: string;
  payout_kind: PayoutKind;
  amount_iqd: number;
  status: string;
  provider_idempotency_key?: string | null;
  request_payload?: any | null;
};

export type WithdrawRequest = {
  id: string;
  user_id: string;
  payout_kind: PayoutKind;
  amount_iqd: number;
  destination: any;
};

export type SendResult = {
  providerRef?: string;
  requestPayload?: any;
  responsePayload?: any;
  // If true, you may finalize immediately (optional); default is webhook-driven confirmation.
  confirmed?: boolean;
};

export class ProviderConfigError extends Error {}

export async function fetchJsonWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort('timeout'), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    const text = await res.text();
    let data: any = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { res, data, text };
  } finally {
    clearTimeout(t);
  }
}

/**
 * Provider adapter that is configuration-driven.
 *
 * Best practice: do NOT hardcode undocumented payout endpoints.
 * Use env vars per provider to set URL, headers, and signing secrets.
 */
export async function sendPayout(kind: PayoutKind, job: PayoutJob, wr: WithdrawRequest) : Promise<SendResult> {
  const mode = (Deno.env.get('PAYOUT_SEND_MODE') ?? 'mock').toLowerCase();
  if (mode === 'mock') {
    // deterministic-ish mock ref
    const ref = `${kind.toUpperCase()}-${job.id.slice(0, 8).toUpperCase()}`;
    return {
      providerRef: ref,
      requestPayload: { mode: 'mock', kind, amount_iqd: wr.amount_iqd, destination: wr.destination },
      responsePayload: { ok: true, provider_ref: ref, mode: 'mock' },
      confirmed: false,
    };
  }

  if (kind === 'qicard') return await sendQiCard(job, wr);
  if (kind === 'asiapay') return await sendAsiaPay(job, wr);
  return await sendZainCash(job, wr);
}

async function sendQiCard(job: PayoutJob, wr: WithdrawRequest): Promise<SendResult> {
  const url = (Deno.env.get('QICARD_PAYOUT_ENDPOINT') ?? '').trim();
  const apiKey = (Deno.env.get('QICARD_PAYOUT_API_KEY') ?? '').trim();
  if (!url || !apiKey) {
    throw new ProviderConfigError('QICARD_PAYOUT_ENDPOINT or QICARD_PAYOUT_API_KEY missing');
  }

  const payload = {
    idempotency_key: job.provider_idempotency_key ?? job.id,
    withdraw_request_id: wr.id,
    amount_iqd: wr.amount_iqd,
    destination: wr.destination,
  };

  const { res, data } = await fetchJsonWithTimeout(
    url,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    },
    15_000,
  );

  if (!res.ok) {
    throw new Error(`QiCard payout failed (${res.status}): ${typeof data === 'string' ? data : JSON.stringify(data)}`);
  }

  const providerRef = (data?.provider_ref ?? data?.reference ?? data?.ref ?? null) as string | null;
  return { providerRef: providerRef ?? undefined, requestPayload: payload, responsePayload: data, confirmed: false };
}

async function sendAsiaPay(job: PayoutJob, wr: WithdrawRequest): Promise<SendResult> {
  const url = (Deno.env.get('ASIAPAY_PAYOUT_ENDPOINT') ?? '').trim();
  const secureHashSecret = (Deno.env.get('ASIAPAY_PAYOUT_SECURE_HASH_SECRET') ?? '').trim();
  if (!url || !secureHashSecret) {
    throw new ProviderConfigError('ASIAPAY_PAYOUT_ENDPOINT or ASIAPAY_PAYOUT_SECURE_HASH_SECRET missing');
  }

  // AsiaPay/PayDollar ecosystems commonly use a "SecureHash" built from concatenated fields.
  // We keep this configurable to avoid guessing field order.
  const baseString = `${job.provider_idempotency_key ?? job.id}|${wr.id}|${wr.amount_iqd}|${JSON.stringify(wr.destination ?? {})}`;
  const secureHash = await shaHex('SHA-256', baseString + '|' + secureHashSecret);

  const payload = {
    idempotency_key: job.provider_idempotency_key ?? job.id,
    withdraw_request_id: wr.id,
    amount_iqd: wr.amount_iqd,
    destination: wr.destination,
    secure_hash: secureHash,
  };

  const { res, data } = await fetchJsonWithTimeout(
    url,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) },
    15_000,
  );
  if (!res.ok) throw new Error(`AsiaPay payout failed (${res.status}): ${typeof data === 'string' ? data : JSON.stringify(data)}`);

  const providerRef = (data?.provider_ref ?? data?.reference ?? data?.Ref ?? null) as string | null;
  return { providerRef: providerRef ?? undefined, requestPayload: payload, responsePayload: data, confirmed: false };
}

async function sendZainCash(job: PayoutJob, wr: WithdrawRequest): Promise<SendResult> {
  // ZainCash payout/disbursement APIs are not always publicly documented; use business disbursement endpoint config.
  const url = (Deno.env.get('ZAINCASH_DISBURSEMENT_ENDPOINT') ?? '').trim();
  const apiKey = (Deno.env.get('ZAINCASH_DISBURSEMENT_API_KEY') ?? '').trim();
  if (!url || !apiKey) {
    throw new ProviderConfigError('ZAINCASH_DISBURSEMENT_ENDPOINT or ZAINCASH_DISBURSEMENT_API_KEY missing');
  }

  const payload = {
    idempotency_key: job.provider_idempotency_key ?? job.id,
    withdraw_request_id: wr.id,
    amount_iqd: wr.amount_iqd,
    destination: wr.destination,
  };

  const { res, data } = await fetchJsonWithTimeout(
    url,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    },
    15_000,
  );
  if (!res.ok) throw new Error(`ZainCash disbursement failed (${res.status}): ${typeof data === 'string' ? data : JSON.stringify(data)}`);

  const providerRef = (data?.provider_ref ?? data?.reference ?? data?.ref ?? null) as string | null;
  return { providerRef: providerRef ?? undefined, requestPayload: payload, responsePayload: data, confirmed: false };
}
