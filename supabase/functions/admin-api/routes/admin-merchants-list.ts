import { createUserClient } from '../../_shared/supabase.ts';
import { requirePermission } from '../../_shared/admin.ts';
import { json, errorJson } from '../../_shared/json.ts';
import { requireMethod, validateJsonBody } from '../../_shared/validate.ts';
import { merchantsListBodySchema } from '../../_shared/schemas.ts';

export async function handle(req: Request, ctx: any): Promise<Response> {
  const methodErr = requireMethod(req, ctx, 'POST');
  if (methodErr) return methodErr;

  const guard = await requirePermission(req, ctx, 'merchants.read');
  if ('res' in guard) return guard.res;

  const body = await validateJsonBody(req, ctx, merchantsListBodySchema);
  if (!body.ok) return body.res;

  const { q, status, limit, offset } = body.data;
  const supabase = createUserClient(req);

  const { data, error } = await supabase.rpc('admin_merchants_list_v1', {
    p_q: q ?? null,
    p_status: status ?? null,
    p_limit: limit,
    p_offset: offset,
  });

  if (error) {
    ctx?.error?.('admin_merchants.list.rpc_error', { error: error.message });
    return errorJson('RPC error', 500, 'RPC_ERROR', { error: error.message }, ctx.headers);
  }

  const merchants = (data ?? []) as any[];
  return json({ ok: true, merchants, page: { limit, offset, returned: merchants.length } }, 200, ctx.headers);
}
