'use server';

import { z } from 'zod';
import { randomUUID } from 'crypto';
import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth/guards';
import { refundPayment } from '@/lib/admin/payments';

const schema = z.object({
  paymentId: z.string().uuid(),
  rideId: z.string().uuid(),
  refundAmountIqd: z.preprocess(
    (v) => {
      if (typeof v !== 'string') return null;
      const s = v.trim();
      if (!s) return null;
      const n = Number(s);
      if (!Number.isFinite(n)) return null;
      return Math.floor(n);
    },
    z.number().int().nonnegative().nullable(),
  ),
  reason: z.string().min(3).max(500),
  confirm: z.literal('on'),
});

export async function refundPaymentAction(formData: FormData): Promise<void> {
  const { supabase } = await requirePermission('payments.refund');

  const parsed = schema.safeParse({
    paymentId: formData.get('paymentId'),
    rideId: formData.get('rideId'),
    refundAmountIqd: formData.get('refundAmountIqd'),
    reason: typeof formData.get('reason') === 'string' ? String(formData.get('reason')).trim() : '',
    confirm: formData.get('confirm'),
  });

  if (!parsed.success) {
    throw new Error('Invalid request');
  }

  await refundPayment(supabase, {
    paymentId: parsed.data.paymentId,
    refundAmountIqd: parsed.data.refundAmountIqd,
    reason: parsed.data.reason,
    idempotencyKey: randomUUID(),
  });

  revalidatePath(`/payments/${parsed.data.paymentId}`);
  revalidatePath('/payments');
  revalidatePath(`/rides/${parsed.data.rideId}`);
  revalidatePath('/audit');
}
