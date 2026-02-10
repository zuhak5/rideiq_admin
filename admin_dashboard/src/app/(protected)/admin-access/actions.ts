'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requirePermission } from '@/lib/auth/guards';
import {
  createRoleChangeRequest,
  approveRoleChangeRequest,
  roleKeysHavePermission,
  setAdminUserRoles,
} from '@/lib/admin/access';

const schema = z.object({
  userId: z.string().uuid(),
  note: z.string().min(3).max(500),
  confirm: z.literal('on'),
  q: z.string().max(200).optional(),
  offset: z.string().max(20).optional(),
});

const approveSchema = z.object({
  requestId: z.string().uuid(),
  note: z.string().min(3).max(500),
  confirm: z.literal('on'),
});

function normalizeRoleKeys(input: FormDataEntryValue[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of input) {
    if (typeof v !== 'string') continue;
    const k = v.trim();
    if (!k) continue;
    if (!/^[a-z0-9_]+$/.test(k)) throw new Error(`Invalid role key: ${k}`);
    if (k.length > 40) throw new Error(`Role key too long: ${k}`);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(k);
    }
  }
  return out;
}

function safeRedirectUrl(q?: string, offset?: string, params?: Record<string, string>): string {
  const usp = new URLSearchParams();
  if (q) usp.set('q', q);
  if (offset) usp.set('offset', offset);
  for (const [k, v] of Object.entries(params ?? {})) usp.set(k, v);
  const qs = usp.toString();
  return qs ? `/admin-access?${qs}` : '/admin-access';
}

export async function setRolesAction(formData: FormData): Promise<void> {
  const { supabase, user } = await requirePermission('admin_access.manage');

  const noteRaw = formData.get('note');
  const note = typeof noteRaw === 'string' ? noteRaw.trim() : '';

  const q = typeof formData.get('q') === 'string' ? (formData.get('q') as string) : undefined;
  const offset =
    typeof formData.get('offset') === 'string' ? (formData.get('offset') as string) : undefined;

  const parsed = schema.safeParse({
    userId: formData.get('userId'),
    note,
    confirm: formData.get('confirm'),
    q,
    offset,
  });

  if (!parsed.success) {
    redirect(safeRedirectUrl(q, offset, { error: 'Invalid request' }));
  }

  let roleKeys: string[] = [];
  try {
    roleKeys = normalizeRoleKeys(formData.getAll('roles'));
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Invalid roles';
    redirect(safeRedirectUrl(parsed.data.q, parsed.data.offset, { error: msg }));
  }

  if (!roleKeys.length) {
    redirect(safeRedirectUrl(parsed.data.q, parsed.data.offset, { error: 'Select at least one role' }));
  }

  // If the current user is changing their own roles and would lose admin_access.manage,
  // require an extra acknowledgement to reduce accidental lockout.
  try {
    const newHasManage = await roleKeysHavePermission(supabase, {
      roleKeys,
      permission: 'admin_access.manage',
    });
    if (parsed.data.userId === user.id && !newHasManage) {
      const confirmSelfDemote = formData.get('confirmSelfDemote');
      if (confirmSelfDemote !== 'on') {
        redirect(
          safeRedirectUrl(parsed.data.q, parsed.data.offset, {
            error: 'Confirm self-demotion acknowledgement',
          }),
        );
      }
    }
  } catch {
    // If the helper RPC isn't deployed yet, fail open (UI still enforces last-manager guardrail in DB).
  }

  try {
    await setAdminUserRoles(supabase, {
      userId: parsed.data.userId,
      roleKeys,
      note: parsed.data.note,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message.replace(/^admin_set_user_roles_v1 failed:\s*/i, '') : 'Failed';

    // Break-glass workflow: super_admin changes require a 2-person approval request.
    if (/super_admin changes require approval request/i.test(msg)) {
      try {
        const requestId = await createRoleChangeRequest(supabase, {
          userId: parsed.data.userId,
          roleKeys,
          note: parsed.data.note,
        });
        revalidatePath('/admin-access');
        revalidatePath('/audit');
        redirect(
          safeRedirectUrl(parsed.data.q, parsed.data.offset, {
            msg: `Request created (${requestId}). Another admin must approve.`,
          }),
        );
      } catch (reqErr) {
        const reqMsg =
          reqErr instanceof Error
            ? reqErr.message.replace(/^admin_create_role_change_request_v1 failed:\s*/i, '')
            : 'Failed';
        const short = reqMsg.length > 180 ? reqMsg.slice(0, 180) : reqMsg;
        redirect(safeRedirectUrl(parsed.data.q, parsed.data.offset, { error: short }));
      }
    }

    // Trim for URL safety.
    const short = msg.length > 180 ? msg.slice(0, 180) : msg;
    redirect(safeRedirectUrl(parsed.data.q, parsed.data.offset, { error: short }));
  }

  revalidatePath('/admin-access');
  revalidatePath('/audit');

  redirect(safeRedirectUrl(parsed.data.q, parsed.data.offset, { msg: 'Roles updated' }));
}

export async function approveRequestAction(formData: FormData): Promise<void> {
  const { supabase } = await requirePermission('admin_access.manage');

  const reqId = typeof formData.get('requestId') === 'string' ? (formData.get('requestId') as string) : '';
  const noteRaw = formData.get('note');
  const note = typeof noteRaw === 'string' ? noteRaw.trim() : '';

  const q = typeof formData.get('q') === 'string' ? (formData.get('q') as string) : undefined;
  const offset = typeof formData.get('offset') === 'string' ? (formData.get('offset') as string) : undefined;

  const parsed = approveSchema.safeParse({
    requestId: reqId,
    note,
    confirm: formData.get('confirm'),
  });

  if (!parsed.success) {
    redirect(safeRedirectUrl(q, offset, { error: 'Invalid approval request' }));
  }

  try {
    await approveRoleChangeRequest(supabase, {
      requestId: parsed.data.requestId,
      note: parsed.data.note,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message.replace(/^admin_approve_role_change_request_v1 failed:\s*/i, '') : 'Failed';
    const short = msg.length > 180 ? msg.slice(0, 180) : msg;
    redirect(safeRedirectUrl(q, offset, { error: short }));
  }

  revalidatePath('/admin-access');
  revalidatePath('/audit');
  redirect(safeRedirectUrl(q, offset, { msg: 'Request approved and executed' }));
}
