import { createUserClient } from '../../_shared/supabase.ts';
import { requirePermission } from '../../_shared/admin.ts';
import { enforceAdminRateLimit } from '../../_shared/adminRateLimit.ts';
import { json, errorJson } from '../../_shared/json.ts';
import { requireMethod, validateJsonBody } from '../../_shared/validate.ts';
import { adminGiftCodeVoidBodySchema } from '../../_shared/schemas.ts';

export async function handle(req: Request, ctx: any): Promise<Response> {
  const methodErr = requireMethod(req, ctx, 'POST');
  if (methodErr) return methodErr;

  const guard = await requirePermission(req, ctx, 'promotions.manage');
  if ('res' in guard) return guard.res;

  const rl = await enforceAdminRateLimit(ctx, {
    action: 'gift_code_void',
    adminId: guard.user.id,
    windowSeconds: 60,
    limit: 120,
    failOpen: false,
  });
  if (rl) return rl;

  const body = await validateJsonBody(req, ctx, adminGiftCodeVoidBodySchema);
  if (!body.ok) return body.res;

  const { code, reason } = body.data;
  const supabase = createUserClient(req);

  const { data, error } = await supabase.rpc('admin_void_gift_code_v1', {
    p_code: code,
    p_reason: reason ?? null,
  });

  if (error) {
    ctx?.error?.('admin_gift_codes.void.rpc_error', { error: error.message });
    return errorJson('RPC error', 500, 'RPC_ERROR', { error: error.message }, ctx.headers);
  }

  return json({ ok: true, gift_code: data }, 200, ctx.headers);
}
