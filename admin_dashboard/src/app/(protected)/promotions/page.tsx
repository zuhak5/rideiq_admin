import { getAdminContext } from '@/lib/auth/guards';
import PromotionsClient from './promotionsClient';
import { listGiftCodes, listMerchantPromotions, listReferralCampaigns } from '@/lib/admin/promotions';
import { redirect } from 'next/navigation';
import type * as React from 'react';

export default async function PromotionsPage(): Promise<React.JSX.Element> {
  const ctx = await getAdminContext();
  if (!ctx.can('promotions.read')) {
    redirect(`/forbidden?permission=${encodeURIComponent('promotions.read')}`);
  }

  const [gift, merch, ref] = await Promise.all([
    listGiftCodes(ctx.supabase, { limit: 50, offset: 0 }),
    listMerchantPromotions(ctx.supabase, { limit: 50, offset: 0 }),
    listReferralCampaigns(ctx.supabase),
  ]);

  return (
    <PromotionsClient
      canManage={ctx.can('promotions.manage')}
      initialGiftCodes={gift.gift_codes}
      initialMerchantPromotions={merch.promotions}
      initialReferralCampaigns={ref.campaigns}
    />
  );
}
