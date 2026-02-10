'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requirePermission } from '@/lib/auth/guards';
import { approveRoleChangeRequest, rejectRoleChangeRequest } from '@/lib/admin/access';

const approveSchema = z.object({
  requestId: z.string().uuid(),
  note: z.string().min(3).max(500),
  confirm: z.literal('on'),
  status: z.string().max(30).optional(),
  offset: z.string().max(20).optional(),
});

const rejectSchema = z.object({
  requestId: z.string().uuid(),
  note: z.string().min(3).max(500),
  confirm: z.literal('on'),
  status: z.string().max(30).optional(),
  offset: z.string().max(20).optional(),
});

function safeRedirect(status?: string, offset?: string, params?: Record<string, string>): string {
  const usp = new URLSearchParams();
  if (status) usp.set('status', status);
  if (offset) usp.set('offset', offset);
  for (const [k, v] of Object.entries(params ?? {})) usp.set(k, v);
  const qs = usp.toString();
  return qs ? `/admin-access/requests?${qs}` : '/admin-access/requests';
}

export async function approveRequestAction(formData: FormData): Promise<void> {
  const { supabase } = await requirePermission('admin_access.manage');

  const parsed = approveSchema.safeParse({
    requestId: formData.get('requestId'),
    note: typeof formData.get('note') === 'string' ? (formData.get('note') as string).trim() : '',
    confirm: formData.get('confirm'),
    status: formData.get('status') ?? undefined,
    offset: formData.get('offset') ?? undefined,
  });

  if (!parsed.success) {
    redirect(safeRedirect(undefined, undefined, { error: 'Invalid approval request' }));
  }

  try {
    await approveRoleChangeRequest(supabase, {
      requestId: parsed.data.requestId,
      note: parsed.data.note,
    });
  } catch (e) {
    const msg =
      e instanceof Error
        ? e.message.replace(/^admin_approve_role_change_request_v1 failed:\s*/i, '')
        : 'Failed';
    const short = msg.length > 180 ? msg.slice(0, 180) : msg;
    redirect(safeRedirect(parsed.data.status, parsed.data.offset, { error: short }));
  }

  revalidatePath('/admin-access');
  revalidatePath('/admin-access/requests');
  revalidatePath('/audit');
  redirect(safeRedirect(parsed.data.status, parsed.data.offset, { msg: 'Request executed' }));
}

export async function rejectRequestAction(formData: FormData): Promise<void> {
  const { supabase } = await requirePermission('admin_access.manage');

  const parsed = rejectSchema.safeParse({
    requestId: formData.get('requestId'),
    note: typeof formData.get('note') === 'string' ? (formData.get('note') as string).trim() : '',
    confirm: formData.get('confirm'),
    status: formData.get('status') ?? undefined,
    offset: formData.get('offset') ?? undefined,
  });

  if (!parsed.success) {
    redirect(safeRedirect(undefined, undefined, { error: 'Invalid reject request' }));
  }

  try {
    await rejectRoleChangeRequest(supabase, {
      requestId: parsed.data.requestId,
      note: parsed.data.note,
    });
  } catch (e) {
    const msg =
      e instanceof Error
        ? e.message.replace(/^admin_reject_role_change_request_v1 failed:\s*/i, '')
        : 'Failed';
    const short = msg.length > 180 ? msg.slice(0, 180) : msg;
    redirect(safeRedirect(parsed.data.status, parsed.data.offset, { error: short }));
  }

  revalidatePath('/admin-access');
  revalidatePath('/admin-access/requests');
  revalidatePath('/audit');
  redirect(safeRedirect(parsed.data.status, parsed.data.offset, { msg: 'Request rejected' }));
}
