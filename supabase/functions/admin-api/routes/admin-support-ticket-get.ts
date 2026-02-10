import { createUserClient } from '../../_shared/supabase.ts';
import { requirePermission } from '../../_shared/admin.ts';
import { json, errorJson } from '../../_shared/json.ts';
import { requireMethod, validateQuery } from '../../_shared/validate.ts';
import { adminSupportTicketGetQuerySchema } from '../../_shared/schemas.ts';

export async function handle(req: Request, ctx: any): Promise<Response> {
  const methodErr = requireMethod(req, ctx, 'GET');
  if (methodErr) return methodErr;

  const guard = await requirePermission(req, ctx, 'support.read');
  if ('res' in guard) return guard.res;

  const q = validateQuery(req, ctx, adminSupportTicketGetQuerySchema);
  if (!q.ok) return q.res;

  const supabase = createUserClient(req);
  const { data, error } = await supabase.rpc('admin_support_ticket_get_v1', { p_ticket_id: q.data.ticket_id });

  if (error) {
    ctx?.error?.('admin_support.ticket_get.rpc_error', { error: error.message });
    return errorJson('RPC error', 500, 'RPC_ERROR', { error: error.message }, ctx.headers);
  }

  return json(data ?? { ok: true }, 200, ctx.headers);
}
