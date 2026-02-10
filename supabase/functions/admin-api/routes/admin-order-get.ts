import { createUserClient } from '../../_shared/supabase.ts';
import { requirePermission } from '../../_shared/admin.ts';
import { json, errorJson } from '../../_shared/json.ts';
import { requireMethod, validateQuery } from '../../_shared/validate.ts';
import { adminOrderDetailQuerySchema } from '../../_shared/schemas.ts';

export async function handle(req: Request, ctx: any): Promise<Response> {
  const methodErr = requireMethod(req, ctx, 'GET');
  if (methodErr) return methodErr;

  const guard = await requirePermission(req, ctx, 'orders.read');
  if ('res' in guard) return guard.res;

  const query = validateQuery(req, ctx, adminOrderDetailQuerySchema);
  if (!query.ok) return query.res;

  const supabase = createUserClient(req);
  const { data, error } = await supabase.rpc('admin_order_get_v1', { p_order_id: query.data.order_id });

  if (error) {
    ctx?.error?.('admin_order.get.rpc_error', { error: error.message });
    return errorJson('RPC error', 500, 'RPC_ERROR', { error: error.message }, ctx.headers);
  }

  return json(data ?? { ok: false }, 200, ctx.headers);
}
