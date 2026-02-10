'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth/guards';
import { generateGiftCodes, voidGiftCode, toggleMerchantPromotion, updateReferralCampaign } from '@/lib/admin/promotions';

export type GenerateGiftCodesState = {
  ok: boolean;
  codes: string[];
  error?: string;
};

const generateSchema = z.object({
  count: z.number().int().min(1).max(500),
  amount_iqd: z.number().int().min(1).max(10_000_000),
  prefix: z.string().max(12).optional().nullable(),
  length: z.number().int().min(8).max(24).default(12),
  memo: z.string().max(200).optional().nullable(),
});

function toInt(v: FormDataEntryValue | null): number {
  const s = typeof v === 'string' ? v : '';
  return Number(s);
}

export async function generateGiftCodesAction(
  _prev: GenerateGiftCodesState,
  formData: FormData,
): Promise<GenerateGiftCodesState> {
  try {
    const { supabase } = await requirePermission('promotions.manage');
    const prefixRaw = typeof formData.get('prefix') === 'string' ? String(formData.get('prefix')).trim() : '';
    const memoRaw = typeof formData.get('memo') === 'string' ? String(formData.get('memo')).trim() : '';

    const parsed = generateSchema.safeParse({
      count: toInt(formData.get('count')),
      amount_iqd: toInt(formData.get('amount_iqd')),
      prefix: prefixRaw ? prefixRaw : null,
      length: toInt(formData.get('length')) || 12,
      memo: memoRaw ? memoRaw : null,
    });

    if (!parsed.success) {
      return { ok: false, codes: [], error: 'Invalid request' };
    }

    const res = await generateGiftCodes(supabase, parsed.data);
    revalidatePath('/promotions');
    return { ok: true, codes: res.codes };
  } catch (e: any) {
    return { ok: false, codes: [], error: String(e?.message ?? e ?? 'Failed') };
  }
}

const voidSchema = z.object({
  code: z.string().min(1).max(24),
  reason: z.string().max(200).optional().nullable(),
});

export async function voidGiftCodeAction(formData: FormData): Promise<void> {
  const { supabase } = await requirePermission('promotions.manage');
  const reasonRaw = typeof formData.get('reason') === 'string' ? String(formData.get('reason')).trim() : '';
  const parsed = voidSchema.safeParse({
    code: formData.get('code'),
    reason: reasonRaw ? reasonRaw : null,
  });
  if (!parsed.success) throw new Error('Invalid request');
  await voidGiftCode(supabase, parsed.data);
  revalidatePath('/promotions');
}

const togglePromoSchema = z.object({
  id: z.string().uuid(),
  is_active: z.boolean(),
  note: z.string().max(200).optional().nullable(),
});

export async function toggleMerchantPromotionAction(formData: FormData): Promise<void> {
  const { supabase } = await requirePermission('promotions.manage');
  const noteRaw = typeof formData.get('note') === 'string' ? String(formData.get('note')).trim() : '';
  const parsed = togglePromoSchema.safeParse({
    id: formData.get('id'),
    is_active: formData.get('is_active') === 'true' || formData.get('is_active') === 'on',
    note: noteRaw ? noteRaw : null,
  });
  if (!parsed.success) throw new Error('Invalid request');
  await toggleMerchantPromotion(supabase, parsed.data);
  revalidatePath('/promotions');
}

const updateCampaignSchema = z.object({
  key: z.string().min(1).max(80),
  referrer_reward_iqd: z.number().int().min(0).max(10_000_000),
  referred_reward_iqd: z.number().int().min(0).max(10_000_000),
  active: z.boolean(),
});

export async function updateReferralCampaignAction(formData: FormData): Promise<void> {
  const { supabase } = await requirePermission('promotions.manage');
  const parsed = updateCampaignSchema.safeParse({
    key: formData.get('key'),
    referrer_reward_iqd: toInt(formData.get('referrer_reward_iqd')),
    referred_reward_iqd: toInt(formData.get('referred_reward_iqd')),
    active: formData.get('active') === 'true' || formData.get('active') === 'on',
  });
  if (!parsed.success) throw new Error('Invalid request');
  await updateReferralCampaign(supabase, parsed.data);
  revalidatePath('/promotions');
}
