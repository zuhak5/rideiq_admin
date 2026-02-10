import { createUserClient } from '../../_shared/supabase.ts';
import { requirePermission } from '../../_shared/admin.ts';
import { json, errorJson } from '../../_shared/json.ts';
import { requireMethod, validateJsonBody } from '../../_shared/validate.ts';
import { adminServiceAreaUpsertBodySchema } from '../../_shared/schemas.ts';

export async function handle(req: Request, ctx: any): Promise<Response> {
  const methodErr = requireMethod(req, ctx, 'POST');
  if (methodErr) return methodErr;

  const guard = await requirePermission(req, ctx, 'service_areas.manage');
  if ('res' in guard) return guard.res;

  const body = await validateJsonBody(req, ctx, adminServiceAreaUpsertBodySchema);
  if (!body.ok) return body.res;

  const supabase = createUserClient(req);
  const b = body.data;

  const { data, error } = await supabase.rpc('admin_service_area_upsert_v1', {
    p_id: b.id ?? null,
    p_name: b.name,
    p_governorate: b.governorate,
    p_geojson: b.geojson,
    p_priority: b.priority,
    p_is_active: b.is_active,
    p_pricing_config_id: b.pricing_config_id ?? null,
    p_min_base_fare_iqd: b.min_base_fare_iqd ?? null,
    p_surge_multiplier: b.surge_multiplier ?? null,
    p_surge_reason: b.surge_reason ?? null,
    p_match_radius_m: b.match_radius_m ?? null,
    p_driver_loc_stale_after_seconds: b.driver_loc_stale_after_seconds ?? null,
    p_cash_rounding_step_iqd: b.cash_rounding_step_iqd ?? null,
  });

  if (error) {
    ctx?.error?.('admin_service_areas.upsert.db_error', { error: error.message });
    return errorJson('DB error', 500, 'DB_ERROR', { error: error.message }, ctx.headers);
  }

  return json({ ok: true, id: data }, 200, ctx.headers);
}
