// Shared protocol constants (safe to hardcode).
// Secrets and environment-specific values (base URLs, credentials, hash secrets, tokens)
// must be provided via Supabase Edge Function Secrets.
//
// Docs:
// - Supabase Edge Function secrets: https://supabase.com/docs/guides/functions/secrets
// - Function config (verify_jwt): https://supabase.com/docs/guides/functions/function-configuration

export const CURRENCY_IQD = 'IQD' as const;

// ISO 4217 numeric currency code for IQD (used by some payment gateways, e.g. PayDollar/AsiaPay).
export const ISO4217_NUMERIC_IQD = '368' as const;

// ZainCash v2 (base URL comes from secret ZAINCASH_V2_BASE_URL)
export const ZAINCASH_OAUTH_PATH = '/oauth2/token' as const;
export const ZAINCASH_V2_INIT_PATH = '/api/v2/payment-gateway/transaction/init' as const;
export const ZAINCASH_V2_INQUIRY_PREFIX = '/api/v2/payment-gateway/transaction/inquiry/' as const;

export const DEFAULT_ZAINCASH_SCOPE = 'payment:read payment:write' as const;
export const DEFAULT_ZAINCASH_LANGUAGE = 'En' as const;

// QiCard (base URL comes from secret QICARD_BASE_URL)
export const QICARD_DEFAULT_CREATE_PATH = '/payment' as const;
export const QICARD_DEFAULT_STATUS_PATH = '/payment/{id}/status' as const;

// General
export const DEFAULT_HTTP_TIMEOUT_MS = 25_000;
