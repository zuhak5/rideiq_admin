import { createUserClient } from '../../_shared/supabase.ts';
import { requirePermission } from '../../_shared/admin.ts';
import { json, errorJson } from '../../_shared/json.ts';
import { requireMethod, validateJsonBody } from '../../_shared/validate.ts';
import { adminServiceAreasListBodySchema } from '../../_shared/schemas.ts';

export async function handle(req: Request, ctx: any): Promise<Response> {
  const methodErr = requireMethod(req, ctx, 'POST');
  if (methodErr) return methodErr;

  const guard = await requirePermission(req, ctx, 'service_areas.read');
  if ('res' in guard) return guard.res;

  const body = await validateJsonBody(req, ctx, adminServiceAreasListBodySchema);
  if (!body.ok) return body.res;

  const { q, limit, offset } = body.data;
  const supabase = createUserClient(req);

  const { data, error } = await supabase.rpc('admin_service_areas_list_v1', {
    p_q: q,
    p_limit: limit,
    p_offset: offset,
  });

  if (error) {
    ctx?.error?.('admin_service_areas.list.db_error', { error: error.message });
    return errorJson('DB error', 500, 'DB_ERROR', { error: error.message }, ctx.headers);
  }

  const areas = (data ?? []) as any[];
  const geojson = {
    type: 'FeatureCollection',
    features: areas
      .filter((a) => !!a?.geom_geojson)
      .map((a) => ({
        type: 'Feature',
        geometry: a.geom_geojson,
        properties: {
          id: a.id,
          name: a.name,
          governorate: a.governorate,
          is_active: a.is_active,
          priority: a.priority,
        },
      })),
  };

  return json(
    {
      ok: true,
      areas,
      geojson,
      page: { limit, offset, returned: areas.length },
    },
    200,
    ctx.headers,
  );
}
