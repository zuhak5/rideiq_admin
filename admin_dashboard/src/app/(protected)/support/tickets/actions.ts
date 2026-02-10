'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { getAdminContext } from '@/lib/auth/guards';
import { assignSupportTicket, setSupportTicketStatus, replyToSupportTicket, addSupportInternalNote } from '@/lib/admin/support';

const uuid = z.string().uuid();
const statusEnum = z.enum(['open', 'pending', 'resolved', 'closed']);

function cleanOptionalText(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : '';
  return s ? s : null;
}

export async function assignTicketAction(formData: FormData): Promise<void> {
  const ctx = await getAdminContext();
  if (!ctx.guard.can('support.manage')) throw new Error('Forbidden');

  const ticket_id = uuid.parse(formData.get('ticket_id'));
  const assignedRaw = String(formData.get('assigned_to') ?? '').trim();
  const assigned_to = assignedRaw ? uuid.parse(assignedRaw) : null;
  const note = cleanOptionalText(formData.get('note'));

  await assignSupportTicket(ctx.supabase, { ticket_id, assigned_to, note });

  revalidatePath('/support/tickets');
  revalidatePath(`/support/tickets/${ticket_id}`);
}

export async function setTicketStatusAction(formData: FormData): Promise<void> {
  const ctx = await getAdminContext();
  if (!ctx.guard.can('support.manage')) throw new Error('Forbidden');

  const ticket_id = uuid.parse(formData.get('ticket_id'));
  const status = statusEnum.parse(formData.get('status'));
  const note = cleanOptionalText(formData.get('note'));

  await setSupportTicketStatus(ctx.supabase, { ticket_id, status, note });

  revalidatePath('/support/tickets');
  revalidatePath(`/support/tickets/${ticket_id}`);
}

export async function replyTicketAction(formData: FormData): Promise<void> {
  const ctx = await getAdminContext();
  if (!ctx.guard.can('support.manage')) throw new Error('Forbidden');

  const ticket_id = uuid.parse(formData.get('ticket_id'));
  const message = z.string().min(1).max(4000).parse(String(formData.get('message') ?? '').trim());

  await replyToSupportTicket(ctx.supabase, { ticket_id, message, attachments: [] });

  revalidatePath('/support/tickets');
  revalidatePath(`/support/tickets/${ticket_id}`);
}

export async function addInternalNoteAction(formData: FormData): Promise<void> {
  const ctx = await getAdminContext();
  if (!ctx.guard.can('support.manage')) throw new Error('Forbidden');

  const ticket_id = uuid.parse(formData.get('ticket_id'));
  const note = z.string().min(1).max(4000).parse(String(formData.get('note') ?? '').trim());

  await addSupportInternalNote(ctx.supabase, { ticket_id, note });

  revalidatePath(`/support/tickets/${ticket_id}`);
}
