/**
 * Canonical, non-identifying context blob sent with fare quote requests.
 *
 * This is intentionally small and stable so we can:
 * - store it for auditing/training
 * - evolve it with schema_version
 * - avoid PII / identity-based pricing signals
 */

export function buildFareContext(extra: Record<string, unknown> = {}): Record<string, unknown> {
  const now = new Date().toISOString();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || null;

  const base: Record<string, unknown> = {
    schema_version: 1,
    client: {
      app: 'RideIQ',
      app_version: (import.meta as any).env?.VITE_APP_VERSION ?? null,
      locale: typeof navigator !== 'undefined' ? navigator.language : null,
      timezone: tz,
    },
    request: {
      requested_at_utc: now,
    },
  };

  return { ...base, ...extra };
}
