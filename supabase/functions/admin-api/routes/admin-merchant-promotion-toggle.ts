import { createUserClient } from '../../_shared/supabase.ts';
import { requirePermission } from '../../_shared/admin.ts';
import { enforceAdminRateLimit } from '../../_shared/adminRateLimit.ts';
import { json, errorJson } from '../../_shared/json.ts';
import { requireMethod, validateJsonBody } from '../../_shared/validate.ts';
import { adminMerchantPromotionToggleBodySchema } from '../../_shared/schemas.ts';

export async function handle(req: Request, ctx: any): Promise<Response> {
  const methodErr = requireMethod(req, ctx, 'POST');
  if (methodErr) return methodErr;

  const guard = await requirePermission(req, ctx, 'promotions.manage');
  if ('res' in guard) return guard.res;

  const rl = await enforceAdminRateLimit(ctx, {
    action: 'merchant_promotion_toggle',
    adminId: guard.user.id,
    windowSeconds: 60,
    limit: 240,
    failOpen: false,
  });
  if (rl) return rl;

  const body = await validateJsonBody(req, ctx, adminMerchantPromotionToggleBodySchema);
  if (!body.ok) return body.res;

  const { id, is_active, note } = body.data;
  const supabase = createUserClient(req);

  const { data, error } = await supabase.rpc('admin_set_merchant_promotion_active_v1', {
    p_id: id,
    p_is_active: is_active,
    p_note: note ?? null,
  });

  if (error) {
    ctx?.error?.('admin_merchant_promotions.toggle.rpc_error', { error: error.message });
    return errorJson('RPC error', 500, 'RPC_ERROR', { error: error.message }, ctx.headers);
  }

  return json({ ok: true, promotion: data }, 200, ctx.headers);
}
