/**
 * Best-effort background work.
 *
 * Supabase Edge Functions run on Deno Deploy. When available, EdgeRuntime.waitUntil
 * allows the runtime to continue processing a promise after the response is returned.
 *
 * This is NOT a durability mechanism — it is only an optimization.
 * Durable work MUST be persisted first (e.g., DB job queue) before calling waitUntil.
 */

export function tryWaitUntil(p: Promise<unknown>): boolean {
  const er = (globalThis as any).EdgeRuntime;
  if (er && typeof er.waitUntil === 'function') {
    try {
      er.waitUntil(p);
      return true;
    } catch {
      // ignore
    }
  }
  return false;
}
