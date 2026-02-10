'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth/guards';
import { createClient } from '@/lib/supabase/server';
import { setMerchantStatus } from '@/lib/admin/merchants';

const Uuid = z.string().uuid();
const StatusEnum = z.enum(['draft', 'pending', 'approved', 'suspended']);

const SetStatusSchema = z.object({
  merchant_id: Uuid,
  to_status: StatusEnum,
  note: z.string().trim().max(500).optional().default(''),
});

export async function setMerchantStatusAction(formData: FormData) {
  await requirePermission('merchants.manage');

  const data = SetStatusSchema.parse({
    merchant_id: formData.get('merchant_id'),
    to_status: formData.get('to_status'),
    note: formData.get('note'),
  });

  const supabase = await createClient();
  await setMerchantStatus(supabase, {
    merchant_id: data.merchant_id,
    to_status: data.to_status,
    note: data.note,
  });

  revalidatePath('/merchants');
  revalidatePath(`/merchants/${data.merchant_id}`);
}
