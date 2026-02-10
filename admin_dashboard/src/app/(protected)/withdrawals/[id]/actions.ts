'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth/guards';
import { createClient } from '@/lib/supabase/server';
import { approveWithdrawal, rejectWithdrawal, markWithdrawalPaid } from '@/lib/admin/withdrawals';
import { createPayoutJob } from '@/lib/admin/payouts';

const Uuid = z.string().uuid();

const ApproveSchema = z.object({
  request_id: Uuid,
  note: z.string().trim().max(500).optional().default(''),
});

export async function approveWithdrawalAction(formData: FormData) {
  await requirePermission('withdrawals.approve');

  const data = ApproveSchema.parse({
    request_id: formData.get('request_id'),
    note: formData.get('note'),
  });

  const supabase = await createClient();
  await approveWithdrawal(supabase, { request_id: data.request_id, note: data.note });

  revalidatePath('/withdrawals');
  revalidatePath(`/withdrawals/${data.request_id}`);
}

const RejectSchema = z.object({
  request_id: Uuid,
  note: z.string().trim().max(500).optional().default(''),
});

export async function rejectWithdrawalAction(formData: FormData) {
  await requirePermission('withdrawals.reject');

  const data = RejectSchema.parse({
    request_id: formData.get('request_id'),
    note: formData.get('note'),
  });

  const supabase = await createClient();
  await rejectWithdrawal(supabase, { request_id: data.request_id, note: data.note });

  revalidatePath('/withdrawals');
  revalidatePath(`/withdrawals/${data.request_id}`);
}

const MarkPaidSchema = z.object({
  request_id: Uuid,
  payout_reference: z.string().trim().max(255).optional().default(''),
  note: z.string().trim().max(500).optional().default(''),
});

export async function markWithdrawalPaidAction(formData: FormData) {
  await requirePermission('withdrawals.mark_paid');

  const data = MarkPaidSchema.parse({
    request_id: formData.get('request_id'),
    payout_reference: formData.get('payout_reference'),
    note: formData.get('note'),
  });

  const supabase = await createClient();
  await markWithdrawalPaid(supabase, {
    request_id: data.request_id,
    payout_reference: data.payout_reference,
    note: data.note,
  });

  revalidatePath('/withdrawals');
  revalidatePath(`/withdrawals/${data.request_id}`);
}

const CreatePayoutJobSchema = z.object({
  withdraw_request_id: Uuid,
});

export async function createPayoutJobAction(formData: FormData) {
  await requirePermission('payouts.run');

  const data = CreatePayoutJobSchema.parse({
    withdraw_request_id: formData.get('withdraw_request_id'),
  });

  const supabase = await createClient();
  await createPayoutJob(supabase, { withdraw_request_id: data.withdraw_request_id, idempotency_key: crypto.randomUUID() });

  revalidatePath(`/withdrawals/${data.withdraw_request_id}`);
  revalidatePath('/payouts/jobs');
}
