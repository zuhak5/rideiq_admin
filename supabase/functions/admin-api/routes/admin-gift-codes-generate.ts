import { createUserClient } from '../../_shared/supabase.ts';
import { requirePermission } from '../../_shared/admin.ts';
import { enforceAdminRateLimit } from '../../_shared/adminRateLimit.ts';
import { json, errorJson } from '../../_shared/json.ts';
import { requireMethod, validateJsonBody } from '../../_shared/validate.ts';
import { adminGiftCodesGenerateBodySchema } from '../../_shared/schemas.ts';

export async function handle(req: Request, ctx: any): Promise<Response> {
  const methodErr = requireMethod(req, ctx, 'POST');
  if (methodErr) return methodErr;

  const guard = await requirePermission(req, ctx, 'promotions.manage');
  if ('res' in guard) return guard.res;

  const rl = await enforceAdminRateLimit(ctx, {
    action: 'gift_codes_generate',
    adminId: guard.user.id,
    windowSeconds: 60,
    limit: 30,
    failOpen: false,
  });
  if (rl) return rl;

  const body = await validateJsonBody(req, ctx, adminGiftCodesGenerateBodySchema);
  if (!body.ok) return body.res;

  const { count, amount_iqd, prefix, length, memo } = body.data;
  const supabase = createUserClient(req);

  const { data, error } = await supabase.rpc('admin_generate_gift_codes_v1', {
    p_count: count,
    p_amount_iqd: amount_iqd,
    p_prefix: prefix ?? null,
    p_length: length,
    p_memo: memo ?? null,
  });

  if (error) {
    ctx?.error?.('admin_gift_codes.generate.rpc_error', { error: error.message });
    return errorJson('RPC error', 500, 'RPC_ERROR', { error: error.message }, ctx.headers);
  }

  const codes = ((data ?? []) as any[]).map((r) => String(r.code ?? r));
  return json({ ok: true, codes }, 200, ctx.headers);
}
