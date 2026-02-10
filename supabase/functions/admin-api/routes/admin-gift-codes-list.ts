import { createUserClient } from '../../_shared/supabase.ts';
import { requirePermission } from '../../_shared/admin.ts';
import { json, errorJson } from '../../_shared/json.ts';
import { requireMethod, validateJsonBody } from '../../_shared/validate.ts';
import { adminGiftCodesListBodySchema } from '../../_shared/schemas.ts';

export async function handle(req: Request, ctx: any): Promise<Response> {
  const methodErr = requireMethod(req, ctx, 'POST');
  if (methodErr) return methodErr;

  const guard = await requirePermission(req, ctx, 'promotions.read');
  if ('res' in guard) return guard.res;

  const body = await validateJsonBody(req, ctx, adminGiftCodesListBodySchema);
  if (!body.ok) return body.res;

  const { q, status, limit, offset } = body.data;
  const supabase = createUserClient(req);

  const { data, error } = await supabase.rpc('admin_gift_codes_list_v1', {
    p_q: q ?? null,
    p_status: status ?? null,
    p_limit: limit,
    p_offset: offset,
  });

  if (error) {
    ctx?.error?.('admin_gift_codes.list.rpc_error', { error: error.message });
    return errorJson('RPC error', 500, 'RPC_ERROR', { error: error.message }, ctx.headers);
  }

  const rows = (data ?? []) as any[];
  return json(
    {
      ok: true,
      gift_codes: rows,
      page: { limit, offset, returned: rows.length },
    },
    200,
    ctx.headers,
  );
}
