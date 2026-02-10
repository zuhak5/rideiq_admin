'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth/guards';
import { closeFraudCase, resolveFraudAction } from '@/lib/admin/fraud';

const closeCaseSchema = z.object({
  caseId: z.string().uuid(),
  resolutionReason: z.string().min(3).max(200),
  confirm: z.literal('on'),
});

export async function closeFraudCaseAction(formData: FormData): Promise<void> {
  const { user, supabase } = await requirePermission('fraud.manage');

  const parsed = closeCaseSchema.safeParse({
    caseId: formData.get('caseId'),
    resolutionReason: typeof formData.get('resolutionReason') === 'string' ? String(formData.get('resolutionReason')).trim() : '',
    confirm: formData.get('confirm'),
  });
  if (!parsed.success) {
    throw new Error('Invalid request');
  }

  await closeFraudCase(supabase, {
    caseId: parsed.data.caseId,
    closedBy: user.id,
    resolutionReason: parsed.data.resolutionReason,
  });

  revalidatePath('/fraud');
}

const resolveActionSchema = z.object({
  actionId: z.string().uuid(),
  resolutionReason: z.string().min(3).max(200),
  confirm: z.literal('on'),
});

export async function resolveFraudActionAction(formData: FormData): Promise<void> {
  const { supabase } = await requirePermission('fraud.manage');

  const parsed = resolveActionSchema.safeParse({
    actionId: formData.get('actionId'),
    resolutionReason: typeof formData.get('resolutionReason') === 'string' ? String(formData.get('resolutionReason')).trim() : '',
    confirm: formData.get('confirm'),
  });
  if (!parsed.success) {
    throw new Error('Invalid request');
  }

  await resolveFraudAction(supabase, {
    actionId: parsed.data.actionId,
    resolutionReason: parsed.data.resolutionReason,
  });

  revalidatePath('/fraud');
}
