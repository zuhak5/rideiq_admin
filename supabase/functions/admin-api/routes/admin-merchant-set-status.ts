import { createUserClient } from '../../_shared/supabase.ts';
import { requirePermission } from '../../_shared/admin.ts';
import { json, errorJson } from '../../_shared/json.ts';
import { requireMethod, validateJsonBody } from '../../_shared/validate.ts';
import { merchantSetStatusBodySchema } from '../../_shared/schemas.ts';

export async function handle(req: Request, ctx: any): Promise<Response> {
  const methodErr = requireMethod(req, ctx, 'POST');
  if (methodErr) return methodErr;

  const guard = await requirePermission(req, ctx, 'merchants.manage');
  if ('res' in guard) return guard.res;

  const body = await validateJsonBody(req, ctx, merchantSetStatusBodySchema);
  if (!body.ok) return body.res;

  const { merchant_id, to_status, note } = body.data;
  const supabase = createUserClient(req);

  const { data, error } = await supabase.rpc('admin_set_merchant_status_v1', {
    p_merchant_id: merchant_id,
    p_new_status: to_status,
    p_note: note ?? null,
  });

  if (error) {
    ctx?.error?.('admin_merchant.set_status.rpc_error', { error: error.message });
    return errorJson('RPC error', 500, 'RPC_ERROR', { error: error.message }, ctx.headers);
  }

  return json({ ok: true, merchant: data }, 200, ctx.headers);
}
