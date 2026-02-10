'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth/guards';
import { cancelRide } from '@/lib/admin/rides';

const schema = z.object({
  rideId: z.string().uuid(),
  expectedVersion: z.coerce.number().int().nonnegative(),
  reason: z.string().min(3).max(500),
  confirm: z.literal('on'),
});

export async function cancelRideAction(formData: FormData): Promise<void> {
  const { supabase } = await requirePermission('rides.cancel');

  const parsed = schema.safeParse({
    rideId: formData.get('rideId'),
    expectedVersion: formData.get('expectedVersion'),
    reason: typeof formData.get('reason') === 'string' ? String(formData.get('reason')).trim() : '',
    confirm: formData.get('confirm'),
  });

  if (!parsed.success) {
    throw new Error('Invalid request');
  }

  await cancelRide(supabase, {
    rideId: parsed.data.rideId,
    expectedVersion: parsed.data.expectedVersion,
    reason: parsed.data.reason,
  });

  revalidatePath(`/rides/${parsed.data.rideId}`);
  revalidatePath('/rides');
  revalidatePath('/audit');
}
