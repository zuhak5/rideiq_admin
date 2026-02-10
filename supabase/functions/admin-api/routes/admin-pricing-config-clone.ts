import { createUserClient } from '../../_shared/supabase.ts';
import { requirePermission } from '../../_shared/admin.ts';
import { json, errorJson } from '../../_shared/json.ts';
import { requireMethod, validateJsonBody } from '../../_shared/validate.ts';
import { adminPricingCloneBodySchema } from '../../_shared/schemas.ts';

export async function handle(req: Request, ctx: any): Promise<Response> {
  const methodErr = requireMethod(req, ctx, 'POST');
  if (methodErr) return methodErr;

  const guard = await requirePermission(req, ctx, 'pricing.manage');
  if ('res' in guard) return guard.res;

  const body = await validateJsonBody(req, ctx, adminPricingCloneBodySchema);
  if (!body.ok) return body.res;

  const supabase = createUserClient(req);
  const b = body.data;

  const { data, error } = await supabase.rpc('admin_clone_pricing_config_v1', {
    p_source_id: b.pricing_config_id,
    p_name: b.name ?? null,
    p_effective_from: b.effective_from ?? new Date().toISOString(),
    p_active: b.active ?? true,
    p_set_default: b.set_default ?? false,
  });

  if (error) {
    ctx?.error?.('admin_pricing.clone.db_error', { error: error.message });
    return errorJson('DB error', 500, 'DB_ERROR', { error: error.message }, ctx.headers);
  }

  return json({ ok: true, id: data }, 200, ctx.headers);
}
