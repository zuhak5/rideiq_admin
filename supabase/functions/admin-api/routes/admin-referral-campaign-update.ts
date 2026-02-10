import { createUserClient } from '../../_shared/supabase.ts';
import { requirePermission } from '../../_shared/admin.ts';
import { enforceAdminRateLimit } from '../../_shared/adminRateLimit.ts';
import { json, errorJson } from '../../_shared/json.ts';
import { requireMethod, validateJsonBody } from '../../_shared/validate.ts';
import { adminReferralCampaignUpdateBodySchema } from '../../_shared/schemas.ts';

export async function handle(req: Request, ctx: any): Promise<Response> {
  const methodErr = requireMethod(req, ctx, 'POST');
  if (methodErr) return methodErr;

  const guard = await requirePermission(req, ctx, 'promotions.manage');
  if ('res' in guard) return guard.res;

  const rl = await enforceAdminRateLimit(ctx, {
    action: 'referral_campaign_update',
    adminId: guard.user.id,
    windowSeconds: 60,
    limit: 120,
    failOpen: false,
  });
  if (rl) return rl;

  const body = await validateJsonBody(req, ctx, adminReferralCampaignUpdateBodySchema);
  if (!body.ok) return body.res;

  const { key, referrer_reward_iqd, referred_reward_iqd, active } = body.data;
  const supabase = createUserClient(req);

  const { data, error } = await supabase.rpc('admin_update_referral_campaign_v1', {
    p_key: key,
    p_referrer_reward_iqd: referrer_reward_iqd,
    p_referred_reward_iqd: referred_reward_iqd,
    p_active: active,
  });

  if (error) {
    ctx?.error?.('admin_referrals.update.rpc_error', { error: error.message });
    return errorJson('RPC error', 500, 'RPC_ERROR', { error: error.message }, ctx.headers);
  }

  return json({ ok: true, campaign: data }, 200, ctx.headers);
}
