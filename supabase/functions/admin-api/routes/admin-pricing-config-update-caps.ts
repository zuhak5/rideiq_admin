import { createUserClient } from '../../_shared/supabase.ts';
import { requirePermission } from '../../_shared/admin.ts';
import { json, errorJson } from '../../_shared/json.ts';
import { requireMethod, validateJsonBody } from '../../_shared/validate.ts';
import { adminPricingUpdateCapsBodySchema } from '../../_shared/schemas.ts';

export async function handle(req: Request, ctx: any): Promise<Response> {
  const methodErr = requireMethod(req, ctx, 'POST');
  if (methodErr) return methodErr;

  const guard = await requirePermission(req, ctx, 'pricing.manage');
  if ('res' in guard) return guard.res;

  const body = await validateJsonBody(req, ctx, adminPricingUpdateCapsBodySchema);
  if (!body.ok) return body.res;

  const b = body.data;
  const supabase = createUserClient(req);

  const { error } = await supabase.rpc('admin_update_pricing_config_caps', {
    p_id: b.pricing_config_id,
    p_max_surge_multiplier: b.max_surge_multiplier,
  });

  if (error) {
    ctx?.error?.('admin_pricing.update_caps.db_error', { error: error.message });
    return errorJson('DB error', 500, 'DB_ERROR', { error: error.message }, ctx.headers);
  }

  return json({ ok: true }, 200, ctx.headers);
}