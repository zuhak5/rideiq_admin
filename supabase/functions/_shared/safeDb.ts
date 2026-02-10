import type { RequestContext } from './requestContext.ts';

type AnyRow = Record<string, unknown>;

// Defensive DB helpers: never throw, always log, return empty/null on failure.
// Keep them small so individual edge handlers stay within the "~90 lines" rule.

export async function safeSelectView(
  service: any,
  viewName: string,
  ctx: RequestContext,
  eventPrefix = 'db',
): Promise<AnyRow[]> {
  const { data, error } = await service.from(viewName).select('*');
  if (error) {
    ctx.warn(`${eventPrefix}.view_failed`, { view: viewName, error: error.message });
    return [];
  }
  return (Array.isArray(data) ? data : []) as AnyRow[];
}

export async function safeSelectSingle(
  service: any,
  viewName: string,
  ctx: RequestContext,
  eventPrefix = 'db',
): Promise<AnyRow | null> {
  const rows = await safeSelectView(service, viewName, ctx, eventPrefix);
  return rows[0] ?? null;
}

export async function safeRpc(
  service: any,
  fn: string,
  ctx: RequestContext,
  eventPrefix = 'db',
): Promise<AnyRow | null> {
  const { data, error } = await service.rpc(fn);
  if (error) {
    ctx.warn(`${eventPrefix}.rpc_failed`, { fn, error: error.message });
    return null;
  }
  const row = Array.isArray(data) ? data[0] : data;
  return (row && typeof row === 'object') ? (row as AnyRow) : null;
}