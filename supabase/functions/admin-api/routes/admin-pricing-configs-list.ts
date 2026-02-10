import { createServiceClient } from '../../_shared/supabase.ts';
import { requirePermission } from '../../_shared/admin.ts';
import { json, errorJson } from '../../_shared/json.ts';
import { requireMethod, validateJsonBody } from '../../_shared/validate.ts';
import { adminPricingListBodySchema } from '../../_shared/schemas.ts';

export async function handle(req: Request, ctx: any): Promise<Response> {
  const methodErr = requireMethod(req, ctx, 'POST');
  if (methodErr) return methodErr;

  const guard = await requirePermission(req, ctx, 'pricing.read');
  if ('res' in guard) return guard.res;

  const body = await validateJsonBody(req, ctx, adminPricingListBodySchema);
  if (!body.ok) return body.res;

  const { q, limit, offset } = body.data;
  const svc = createServiceClient();

  let query = svc
    .from('pricing_configs')
    .select(
      'id,name,version,is_default,effective_from,effective_to,base_fare_iqd,per_km_iqd,per_min_iqd,minimum_fare_iqd,max_surge_multiplier,active,updated_at',
    )
    .order('active', { ascending: false })
    .order('is_default', { ascending: false })
    .order('effective_from', { ascending: false })
    .order('updated_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (q) query = query.ilike('name', `%${q}%`);

  const { data, error } = await query;

  if (error) {
    ctx?.error?.('admin_pricing.list.db_error', { error: error.message });
    return errorJson('DB error', 500, 'DB_ERROR', { error: error.message }, ctx.headers);
  }

  const configs = (data ?? []) as any[];
  return json(
    {
      ok: true,
      configs,
      page: { limit, offset, returned: configs.length },
    },
    200,
    ctx.headers,
  );
}
