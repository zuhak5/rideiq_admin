'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth/guards';
import { actionPayoutJob } from '@/lib/admin/payouts';

const Uuid = z.string().uuid();

const RetrySchema = z.object({
  job_id: Uuid,
  note: z.string().trim().max(500).optional().default(''),
});

export async function retryPayoutJobAction(formData: FormData) {
  const { supabase } = await requirePermission('payouts.retry');

  const data = RetrySchema.parse({
    job_id: formData.get('job_id'),
    note: formData.get('note'),
  });

  await actionPayoutJob(supabase, { job_id: data.job_id, action: 'retry_now', note: data.note });

  revalidatePath('/payouts/jobs');
  revalidatePath(`/payouts/jobs/${data.job_id}`);
}

const CancelSchema = z.object({
  job_id: Uuid,
  note: z.string().trim().max(500).optional().default(''),
});

export async function cancelPayoutJobAction(formData: FormData) {
  const { supabase } = await requirePermission('payouts.retry');

  const data = CancelSchema.parse({
    job_id: formData.get('job_id'),
    note: formData.get('note'),
  });

  await actionPayoutJob(supabase, { job_id: data.job_id, action: 'cancel', note: data.note });

  revalidatePath('/payouts/jobs');
  revalidatePath(`/payouts/jobs/${data.job_id}`);
}

const ForceConfirmSchema = z.object({
  job_id: Uuid,
  provider_ref: z.string().trim().max(255).optional().default(''),
  note: z.string().trim().max(500).optional().default(''),
  confirm: z.literal('on'),
});

export async function forceConfirmPayoutJobAction(formData: FormData) {
  const { supabase } = await requirePermission('withdrawals.mark_paid');

  const data = ForceConfirmSchema.parse({
    job_id: formData.get('job_id'),
    provider_ref: formData.get('provider_ref'),
    note: formData.get('note'),
    confirm: formData.get('confirm'),
  });

  await actionPayoutJob(supabase, {
    job_id: data.job_id,
    action: 'force_confirm',
    provider_ref: data.provider_ref,
    note: data.note,
  });

  revalidatePath('/payouts/jobs');
  revalidatePath(`/payouts/jobs/${data.job_id}`);
}
