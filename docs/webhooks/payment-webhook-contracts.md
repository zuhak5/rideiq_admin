# Payment webhook auth contracts

This document defines the **per-route webhook auth contract** for all payment-provider callback endpoints.

All webhook handlers must follow the invariant:

> **verify → persist → enqueue → respond 2xx**

Durability is provided by the **durable inbox** (`public.provider_events`) and the **job queue** (`public.webhook_jobs`).

## Cross-cutting rules

### Request identifiers
- Every webhook handler runs inside `withRequestContext(...)` and echoes:
  - `x-request-id`
  - `x-trace-id`
  - optionally `x-correlation-id`

### Optional replay protection (timestamp)
The project supports **best-effort** replay protection:
- If a provider includes a timestamp header, we reject stale deliveries.
- If the provider does **not** include a timestamp header, the request is not rejected on this basis.

Implementation:
- Helper: `supabase/functions/_shared/webhookReplay.ts` (`requireFreshWebhookTimestamp(req, headers)`).
- Config: `WEBHOOK_MAX_AGE_SECONDS` (default `300`). Set `<=0` to disable.
- Recognized headers (first match wins):
  - `x-webhook-timestamp`, `webhook-timestamp`, `x-timestamp`, `x-signature-timestamp`, `stripe-timestamp`
- Stale response:
  - HTTP `401`
  - code: `STALE_WEBHOOK`

### Idempotency
Idempotency is enforced through DB constraints:
- Durable inbox: unique `(provider_code, provider_event_id)`
- Queue: unique `dedupe_key = ${provider_code}:${job_kind}:${provider_event_id}`

### Insecure modes (dev-only)
Some providers require a local/dev bypass for early integration.

Rules:
- Insecure flags are **provider-specific** (no global `ALLOW_INSECURE_WEBHOOKS`).
- If an insecure flag is enabled in production, handlers **fail closed**.

## Route inventory

| Route (Edge Function) | Method | Content-Type | Auth / integrity verification | Correlation ID | Durable inbox ID | Job kind |
|---|---:|---|---|---|---|---|
| `qicard-notify` | POST | JSON or form-urlencoded | HMAC-SHA256 signature over raw body (`QICARD_WEBHOOK_SECRET`) via `x-signature` / `x-webhook-signature` / `x-qicard-signature`. Optional timestamp replay guard. Dev-only bypass: `QICARD_ALLOW_INSECURE_WEBHOOKS`. | `topup_intents.id` (UUID) | provider payload ID or hash of raw | `topup_webhook` |
| `qicard-withdraw-webhook` | POST | JSON | HMAC-SHA256 signature over raw body (`QICARD_PAYOUT_WEBHOOK_SECRET`). Optional timestamp replay guard. Dev-only bypass: `QICARD_ALLOW_INSECURE_WEBHOOKS`. | `wallet_withdraw_requests.id` (UUID) | `payout:${eventId}` | `withdraw_webhook` |
| `asiapay-notify` | POST | `application/x-www-form-urlencoded` | PayDollar/AsiaPay secure hash validation (`ASIAPAY_SECURE_HASH_SECRET`). Optional timestamp replay guard. Dev-only bypass: `ASIAPAY_ALLOW_INSECURE_WEBHOOKS`. | merchant ref / order ref | stable event id derived from ref + status | `topup_webhook` |
| `asiapay-withdraw-webhook` | POST | `application/x-www-form-urlencoded` | PayDollar/AsiaPay payout secure hash validation (`ASIAPAY_PAYOUT_SECURE_HASH_SECRET`). Optional timestamp replay guard. Dev-only bypass: `ASIAPAY_ALLOW_INSECURE_WEBHOOKS`. | withdraw ref | `payout:${stableEventId}` | `withdraw_webhook` |
| `zaincash-webhook` | POST | JSON | JWT (`webhook_token`) HS256 verified with `apiKey` (`getZaincashV2Config()`). Optional timestamp replay guard. | `topup_intents.id` (UUID) from `externalReferenceId` claim | claim `eventId`/`jti` or SHA-256 of token | `topup_webhook` |
| `zaincash-withdraw-webhook` | POST | JSON | JWT (`webhook_token`) HS256 verified with `apiKey` (`getZaincashV2Config()`). Optional timestamp replay guard. | `wallet_withdraw_requests.id` (UUID) from `externalReferenceId` claim | `payout:${eventId}` | `withdraw_webhook` |

## Route-specific notes

### QiCard (`qicard-notify`, `qicard-withdraw-webhook`)
- Signature verification is required when secrets are set.
- If secrets are missing and `QICARD_ALLOW_INSECURE_WEBHOOKS=false`, handlers fail closed with `CONFIG_ERROR`.
- If `QICARD_ALLOW_INSECURE_WEBHOOKS=true` in production, handlers return `INSECURE_WEBHOOKS_DISABLED`.

### AsiaPay / PayDollar (`asiapay-notify`, `asiapay-withdraw-webhook`)
- Uses secure hash parameters embedded in the form payload.
- Handlers respond with provider-expected OK text/body but still persist + enqueue before returning 2xx.

### ZainCash (`zaincash-webhook`, `zaincash-withdraw-webhook`)
- Uses a JWT token (`webhook_token`) signed with the provider API key (HS256).
- `externalReferenceId` is required and must be a UUID (mapped to internal intent/withdraw request).

## Response semantics
- `2xx` only when:
  - accepted and queued, OR
  - intentionally ignored (e.g., missing token / missing reference)
- `401` for auth/signature failures and stale timestamp guard
- `5xx` for internal/config failures that should trigger provider retry (where applicable)
