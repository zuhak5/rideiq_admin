import { createUserClient } from '../../_shared/supabase.ts';
import { requirePermission } from '../../_shared/admin.ts';
import { json, errorJson } from '../../_shared/json.ts';
import { requireMethod, validateJsonBody } from '../../_shared/validate.ts';
import { ordersListBodySchema } from '../../_shared/schemas.ts';

export async function handle(req: Request, ctx: any): Promise<Response> {
  const methodErr = requireMethod(req, ctx, 'POST');
  if (methodErr) return methodErr;

  const guard = await requirePermission(req, ctx, 'orders.read');
  if ('res' in guard) return guard.res;

  const body = await validateJsonBody(req, ctx, ordersListBodySchema);
  if (!body.ok) return body.res;

  const { q, status, merchant_id, limit, offset } = body.data;
  const supabase = createUserClient(req);

  const { data, error } = await supabase.rpc('admin_orders_list_v1', {
    p_q: q ?? null,
    p_status: status ?? null,
    p_merchant_id: merchant_id ?? null,
    p_limit: limit,
    p_offset: offset,
  });

  if (error) {
    ctx?.error?.('admin_orders.list.rpc_error', { error: error.message });
    return errorJson('RPC error', 500, 'RPC_ERROR', { error: error.message }, ctx.headers);
  }

  const orders = (data ?? []) as any[];
  return json({ ok: true, orders, page: { limit, offset, returned: orders.length } }, 200, ctx.headers);
}
