/**
 * Durable webhook inbox.
 *
 * Store every verified provider callback into `public.provider_events`.
 * The table has a unique index on (provider_code, provider_event_id), so
 * inserts are naturally idempotent (replays become a no-op).
 */

export type StoredProviderEvent = {
  id: number | null;
  inserted: boolean;
};

function isUniqueViolation(err: any): boolean {
  const code = String(err?.code ?? '').trim();
  if (code === '23505') return true;
  const msg = String(err?.message ?? err ?? '');
  return /duplicate key|unique constraint/i.test(msg);
}

export async function storeProviderEvent(
  service: any,
  providerCode: string,
  providerEventId: string,
  payload: unknown,
): Promise<StoredProviderEvent> {
  const { data, error } = await service
    .from('provider_events')
    .insert({ provider_code: providerCode, provider_event_id: providerEventId, payload })
    .select('id')
    .maybeSingle();

  if (!error) return { id: (data as any)?.id ?? null, inserted: true };

  // Only treat unique violations as "duplicate"; propagate all other errors.
  if (!isUniqueViolation(error)) {
    throw new Error(`provider_events insert failed: ${error?.code ?? ''} ${error?.message ?? String(error)}`);
  }

  // Duplicate: fetch id so callers can link jobs to an existing inbox record.
  const { data: existing, error: selError } = await service
    .from('provider_events')
    .select('id')
    .eq('provider_code', providerCode)
    .eq('provider_event_id', providerEventId)
    .maybeSingle();
  if (selError) {
    throw new Error(`provider_events select failed: ${selError?.code ?? ''} ${selError?.message ?? String(selError)}`);
  }
  return { id: (existing as any)?.id ?? null, inserted: false };
}
