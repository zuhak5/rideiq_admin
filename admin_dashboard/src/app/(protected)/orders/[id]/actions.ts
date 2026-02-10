'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth/guards';
import { createClient } from '@/lib/supabase/server';
import { setOrderStatus } from '@/lib/admin/orders';

const Uuid = z.string().uuid();
const StatusEnum = z.enum(['placed', 'accepted', 'preparing', 'out_for_delivery', 'fulfilled', 'cancelled']);

const SetStatusSchema = z.object({
  order_id: Uuid,
  to_status: StatusEnum,
  note: z.string().trim().max(500).optional().default(''),
});

export async function setOrderStatusAction(formData: FormData) {
  await requirePermission('orders.manage');

  const data = SetStatusSchema.parse({
    order_id: formData.get('order_id'),
    to_status: formData.get('to_status'),
    note: formData.get('note'),
  });

  const supabase = await createClient();
  await setOrderStatus(supabase, {
    order_id: data.order_id,
    to_status: data.to_status,
    note: data.note,
  });

  revalidatePath('/orders');
  revalidatePath(`/orders/${data.order_id}`);
}
