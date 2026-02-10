const ORS_NO_ROUTE_CODES = new Set<number>([
  // See ORS docs for directions endpoint status codes.
  2009,
  2010,
]);

function asRecord(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  return v as Record<string, unknown>;
}

export function getOrsErrorCode(raw: unknown): number | null {
  const root = asRecord(raw);
  const nested = asRecord(root?.error);
  const fromNested = nested?.code;
  const fromRoot = root?.code;

  for (const candidate of [fromNested, fromRoot]) {
    if (typeof candidate === 'number' && Number.isFinite(candidate)) return Math.trunc(candidate);
    if (typeof candidate === 'string' && /^\d+$/.test(candidate)) return Number(candidate);
  }
  return null;
}

export function getOrsErrorMessage(raw: unknown): string | null {
  const root = asRecord(raw);
  const nested = asRecord(root?.error);
  const msg = nested?.message ?? root?.message;
  if (typeof msg !== 'string') return null;
  const trimmed = msg.trim();
  return trimmed ? trimmed : null;
}

export function isOrsNoRouteError(raw: unknown): boolean {
  const code = getOrsErrorCode(raw);
  if (code == null) return false;
  return ORS_NO_ROUTE_CODES.has(code);
}
