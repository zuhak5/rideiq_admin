import { createUserClient } from '../../_shared/supabase.ts';
import { requirePermission } from '../../_shared/admin.ts';
import { json, errorJson } from '../../_shared/json.ts';
import { requireMethod, validateJsonBody } from '../../_shared/validate.ts';
import { adminSupportTicketsListBodySchema } from '../../_shared/schemas.ts';

export async function handle(req: Request, ctx: any): Promise<Response> {
  const methodErr = requireMethod(req, ctx, 'POST');
  if (methodErr) return methodErr;

  const guard = await requirePermission(req, ctx, 'support.read');
  if ('res' in guard) return guard.res;

  const body = await validateJsonBody(req, ctx, adminSupportTicketsListBodySchema);
  if (!body.ok) return body.res;

  const { q, status, priority, assigned_to, limit, offset } = body.data;
  const supabase = createUserClient(req);

  const { data, error } = await supabase.rpc('admin_support_tickets_list_v1', {
    p_q: q ?? null,
    p_status: status ?? null,
    p_priority: priority ?? null,
    p_assigned_to: assigned_to ?? null,
    p_limit: limit,
    p_offset: offset,
  });

  if (error) {
    ctx?.error?.('admin_support.tickets_list.rpc_error', { error: error.message });
    return errorJson('RPC error', 500, 'RPC_ERROR', { error: error.message }, ctx.headers);
  }

  const tickets = (data ?? []) as any[];
  return json({ ok: true, tickets, page: { limit, offset, returned: tickets.length } }, 200, ctx.headers);
}
