import { createUserClient } from '../../_shared/supabase.ts';
import { requirePermission } from '../../_shared/admin.ts';
import { json, errorJson } from '../../_shared/json.ts';
import { requireMethod } from '../../_shared/validate.ts';

export async function handle(req: Request, ctx: any): Promise<Response> {
  const methodErr = requireMethod(req, ctx, 'GET');
  if (methodErr) return methodErr;

  const guard = await requirePermission(req, ctx, 'support.read');
  if ('res' in guard) return guard.res;

  const supabase = createUserClient(req);
  const { data, error } = await supabase.rpc('admin_support_sections_list_v1');

  if (error) {
    ctx?.error?.('admin_support.sections_list.rpc_error', { error: error.message });
    return errorJson('RPC error', 500, 'RPC_ERROR', { error: error.message }, ctx.headers);
  }

  const sections = (data ?? []) as any[];
  return json({ ok: true, sections }, 200, ctx.headers);
}
