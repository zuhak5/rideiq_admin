import { createUserClient } from '../../_shared/supabase.ts';
import { requirePermission } from '../../_shared/admin.ts';
import { json, errorJson } from '../../_shared/json.ts';
import { requireMethod, validateQuery } from '../../_shared/validate.ts';
import { adminMerchantDetailQuerySchema } from '../../_shared/schemas.ts';

export async function handle(req: Request, ctx: any): Promise<Response> {
  const methodErr = requireMethod(req, ctx, 'GET');
  if (methodErr) return methodErr;

  const guard = await requirePermission(req, ctx, 'merchants.read');
  if ('res' in guard) return guard.res;

  const query = validateQuery(req, ctx, adminMerchantDetailQuerySchema);
  if (!query.ok) return query.res;

  const supabase = createUserClient(req);
  const { data, error } = await supabase.rpc('admin_merchant_get_v1', { p_merchant_id: query.data.merchant_id });

  if (error) {
    ctx?.error?.('admin_merchant.get.rpc_error', { error: error.message });
    return errorJson('RPC error', 500, 'RPC_ERROR', { error: error.message }, ctx.headers);
  }

  return json(data ?? { ok: false }, 200, ctx.headers);
}
