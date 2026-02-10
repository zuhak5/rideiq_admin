'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { getAdminContext } from '@/lib/auth/guards';
import { transitionDriver } from '@/lib/admin/drivers';

const schema = z.object({
  driverId: z.string().uuid(),
  toStatus: z.enum(['suspended', 'available', 'offline']),
  reason: z.string().min(3).max(500),
  confirm: z.literal('on'),
});

export async function transitionDriverAction(formData: FormData): Promise<void> {
  const ctx = await getAdminContext();
  if (!ctx.can('drivers.read')) {
    throw new Error('Forbidden');
  }

  const parsed = schema.safeParse({
    driverId: formData.get('driverId'),
    toStatus: formData.get('toStatus'),
    reason: typeof formData.get('reason') === 'string' ? String(formData.get('reason')).trim() : '',
    confirm: formData.get('confirm'),
  });
  if (!parsed.success) {
    throw new Error('Invalid request');
  }

  // Best-effort local gate; server-side enforcement is in the edge function.
  const needed = parsed.data.toStatus === 'suspended' ? 'drivers.suspend' : 'drivers.suspend';
  if (!ctx.can(needed)) {
    throw new Error('Forbidden');
  }

  await transitionDriver(ctx.supabase, {
    driverId: parsed.data.driverId,
    toStatus: parsed.data.toStatus,
    reason: parsed.data.reason,
  });

  revalidatePath(`/drivers/${parsed.data.driverId}`);
  revalidatePath('/drivers');
  revalidatePath('/audit');
}
