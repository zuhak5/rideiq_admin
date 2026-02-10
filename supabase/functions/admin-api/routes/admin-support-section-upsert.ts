import { createUserClient } from '../../_shared/supabase.ts';
import { requirePermission } from '../../_shared/admin.ts';
import { json, errorJson } from '../../_shared/json.ts';
import { requireMethod, validateJsonBody } from '../../_shared/validate.ts';
import { adminSupportSectionUpsertBodySchema } from '../../_shared/schemas.ts';

export async function handle(req: Request, ctx: any): Promise<Response> {
  const methodErr = requireMethod(req, ctx, 'POST');
  if (methodErr) return methodErr;

  const guard = await requirePermission(req, ctx, 'support.manage');
  if ('res' in guard) return guard.res;

  const body = await validateJsonBody(req, ctx, adminSupportSectionUpsertBodySchema);
  if (!body.ok) return body.res;

  const supabase = createUserClient(req);
  const b = body.data;

  const { data, error } = await supabase.rpc('admin_support_section_upsert_v1', {
    p_id: b.id ?? null,
    p_key: b.key,
    p_title: b.title,
    p_sort_order: b.sort_order ?? 0,
    p_enabled: b.enabled ?? true,
  });

  if (error) {
    ctx?.error?.('admin_support.section_upsert.rpc_error', { error: error.message });
    return errorJson('RPC error', 500, 'RPC_ERROR', { error: error.message }, ctx.headers);
  }

  return json(data ?? { ok: true }, 200, ctx.headers);
}
