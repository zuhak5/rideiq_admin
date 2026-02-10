/**
 * Normalize unknown errors into a safe, user-facing payload.
 *
 * Supabase/PostgREST errors are often plain objects (not `Error` instances).
 * If we do `String(err)` we get "[object Object]" which is useless.
 */

export type NormalizedError = {
  message: string;
  code?: string;
  details?: string;
  hint?: string;
  raw?: unknown;
};

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function truncate(s: string, maxLen = 800): string {
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen) + '…';
}

export function normalizeError(e: unknown): NormalizedError {
  if (e instanceof Error) {
    return {
      message: truncate(e.message || 'Error'),
      details: e.stack,
      raw: e,
    };
  }

  if (typeof e === 'string') {
    return { message: truncate(e), raw: e };
  }

  if (e && typeof e === 'object') {
    const anyE = e as Record<string, unknown>;
    const messageProp = typeof anyE.message === 'string' ? (anyE.message as string) : undefined;
    const codeProp = typeof anyE.code === 'string' ? (anyE.code as string) : undefined;
    const detailsProp = typeof anyE.details === 'string' ? (anyE.details as string) : undefined;
    const hintProp = typeof anyE.hint === 'string' ? (anyE.hint as string) : undefined;

    const msg = messageProp ?? safeStringify(anyE);

    return {
      message: truncate(msg),
      code: codeProp,
      details: detailsProp,
      hint: hintProp,
      raw: e,
    };
  }

  return { message: truncate(String(e)), raw: e };
}
