import { unstable_noStore as noStore } from 'next/cache';
import type { SupabaseClient } from '@supabase/supabase-js';
import { invokeEdgeFunction } from '@/lib/supabase/edge';

export type GiftCodeRow = {
  code: string;
  amount_iqd: number | string;
  memo: string | null;
  created_by: string | null;
  created_at: string;
  redeemed_by: string | null;
  redeemed_at: string | null;
  voided_by: string | null;
  voided_at: string | null;
  voided_reason: string | null;
};

export type MerchantPromotionRow = {
  id: string;
  merchant_id: string;
  merchant_name: string;
  merchant_status: string;
  product_id: string | null;
  category: string | null;
  discount_type: string;
  value: number | string;
  starts_at: string;
  ends_at: string;
  is_active: boolean;
  created_at: string;
};

export type ReferralCampaignRow = {
  id: string;
  key: string;
  referrer_reward_iqd: number | string;
  referred_reward_iqd: number | string;
  active: boolean;
  created_at: string;
};

export async function listGiftCodes(
  supabase: SupabaseClient,
  args: { q?: string; status?: string; limit?: number; offset?: number } = {},
): Promise<{ gift_codes: GiftCodeRow[]; page: { limit: number; offset: number; returned: number } }> {
  noStore();
  const data = await invokeEdgeFunction<{
    ok: boolean;
    gift_codes: GiftCodeRow[];
    page: { limit: number; offset: number; returned: number };
  }>(supabase, 'admin-api', {
    path: 'admin-gift-codes-list',
    method: 'POST',
    body: {
      q: args.q ?? '',
      status: args.status ?? null,
      limit: args.limit ?? 50,
      offset: args.offset ?? 0,
    },
  });
  return { gift_codes: data.gift_codes ?? [], page: data.page };
}

export async function generateGiftCodes(
  supabase: SupabaseClient,
  body: { count: number; amount_iqd: number; prefix?: string | null; length?: number; memo?: string | null },
): Promise<{ codes: string[] }> {
  const data = await invokeEdgeFunction<{ ok: boolean; codes: string[] }>(supabase, 'admin-api', {
    path: 'admin-gift-codes-generate',
    method: 'POST',
    body,
  });
  return { codes: data.codes ?? [] };
}

export async function voidGiftCode(
  supabase: SupabaseClient,
  body: { code: string; reason?: string | null },
): Promise<{ gift_code: GiftCodeRow }>
{
  const data = await invokeEdgeFunction<{ ok: boolean; gift_code: GiftCodeRow }>(supabase, 'admin-api', {
    path: 'admin-gift-code-void',
    method: 'POST',
    body,
  });
  return { gift_code: data.gift_code };
}

export async function listMerchantPromotions(
  supabase: SupabaseClient,
  args: { q?: string; only_active?: boolean | null; limit?: number; offset?: number } = {},
): Promise<{ promotions: MerchantPromotionRow[]; page: { limit: number; offset: number; returned: number } }> {
  noStore();
  const data = await invokeEdgeFunction<{
    ok: boolean;
    promotions: MerchantPromotionRow[];
    page: { limit: number; offset: number; returned: number };
  }>(supabase, 'admin-api', {
    path: 'admin-merchant-promotions-list',
    method: 'POST',
    body: {
      q: args.q ?? '',
      only_active: args.only_active ?? null,
      limit: args.limit ?? 50,
      offset: args.offset ?? 0,
    },
  });
  return { promotions: data.promotions ?? [], page: data.page };
}

export async function toggleMerchantPromotion(
  supabase: SupabaseClient,
  body: { id: string; is_active: boolean; note?: string | null },
): Promise<{ promotion: MerchantPromotionRow }> {
  const data = await invokeEdgeFunction<{ ok: boolean; promotion: MerchantPromotionRow }>(supabase, 'admin-api', {
    path: 'admin-merchant-promotion-toggle',
    method: 'POST',
    body,
  });
  return { promotion: data.promotion };
}

export async function listReferralCampaigns(
  supabase: SupabaseClient,
): Promise<{ campaigns: ReferralCampaignRow[] }> {
  noStore();
  const data = await invokeEdgeFunction<{ ok: boolean; campaigns: ReferralCampaignRow[] }>(supabase, 'admin-api', {
    path: 'admin-referral-campaigns-list',
    method: 'POST',
  });
  return { campaigns: data.campaigns ?? [] };
}

export async function updateReferralCampaign(
  supabase: SupabaseClient,
  body: { key: string; referrer_reward_iqd: number; referred_reward_iqd: number; active: boolean },
): Promise<{ campaign: ReferralCampaignRow }> {
  const data = await invokeEdgeFunction<{ ok: boolean; campaign: ReferralCampaignRow }>(supabase, 'admin-api', {
    path: 'admin-referral-campaign-update',
    method: 'POST',
    body,
  });
  return { campaign: data.campaign };
}
