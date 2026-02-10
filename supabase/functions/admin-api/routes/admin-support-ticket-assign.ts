import { createUserClient } from '../../_shared/supabase.ts';
import { requirePermission } from '../../_shared/admin.ts';
import { json, errorJson } from '../../_shared/json.ts';
import { requireMethod, validateJsonBody } from '../../_shared/validate.ts';
import { adminSupportTicketAssignBodySchema } from '../../_shared/schemas.ts';

export async function handle(req: Request, ctx: any): Promise<Response> {
  const methodErr = requireMethod(req, ctx, 'POST');
  if (methodErr) return methodErr;

  const guard = await requirePermission(req, ctx, 'support.manage');
  if ('res' in guard) return guard.res;

  const body = await validateJsonBody(req, ctx, adminSupportTicketAssignBodySchema);
  if (!body.ok) return body.res;

  const supabase = createUserClient(req);
  const { ticket_id, assigned_to, note } = body.data;

  const { data, error } = await supabase.rpc('admin_support_ticket_assign_v1', {
    p_ticket_id: ticket_id,
    p_assigned_to: assigned_to ?? null,
    p_note: note ?? null,
  });

  if (error) {
    ctx?.error?.('admin_support.ticket_assign.rpc_error', { error: error.message });
    return errorJson('RPC error', 500, 'RPC_ERROR', { error: error.message }, ctx.headers);
  }

  return json(data ?? { ok: true }, 200, ctx.headers);
}
