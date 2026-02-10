'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth/guards';

const grantSchema = z.object({
  userId: z.string().uuid(),
  note: z.string().min(3).max(500),
  confirm: z.literal('on'),
});

export async function grantAdminAction(formData: FormData): Promise<void> {
  const { supabase } = await requirePermission('admin_access.manage');

  const rawNote = formData.get('note');
  const note = typeof rawNote === 'string' ? rawNote.trim() : '';

  const parsed = grantSchema.safeParse({
    userId: formData.get('userId'),
    note,
    confirm: formData.get('confirm'),
  });
  if (!parsed.success) throw new Error('Invalid request');

  const { error } = await supabase.rpc('admin_grant_user_v1', {
    p_user: parsed.data.userId,
    p_note: parsed.data.note,
  });
  if (error) throw new Error(error.message);

  revalidatePath('/users');
  revalidatePath('/audit');
}

const revokeSchema = z.object({
  userId: z.string().uuid(),
  note: z.string().min(3).max(500),
  confirm: z.literal('on'),
});

export async function revokeAdminAction(formData: FormData): Promise<void> {
  const { supabase } = await requirePermission('admin_access.manage');

  const rawNote = formData.get('note');
  const note = typeof rawNote === 'string' ? rawNote.trim() : '';

  const parsed = revokeSchema.safeParse({
    userId: formData.get('userId'),
    note,
    confirm: formData.get('confirm'),
  });
  if (!parsed.success) throw new Error('Invalid request');

  const { error } = await supabase.rpc('admin_revoke_user_v1', {
    p_user: parsed.data.userId,
    p_note: parsed.data.note,
  });
  if (error) throw new Error(error.message);

  revalidatePath('/users');
  revalidatePath('/audit');
}
