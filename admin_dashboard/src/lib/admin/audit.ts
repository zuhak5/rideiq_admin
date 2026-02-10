import { unstable_noStore as noStore } from 'next/cache';
import type { SupabaseClient } from '@supabase/supabase-js';

// NOTE: keep this list broad so the UI doesn't break when new audit actions are added server-side.
// We still include the known actions for ergonomics, but allow arbitrary strings.
export type AuditAction =
  | 'grant_admin'
  | 'revoke_admin'
  | 'set_admin_roles'
  | 'request_admin_role_change'
  | 'reject_admin_role_change'
  | 'cancel_ride'
  | 'transition_driver_status'
  | 'convert_ride_intent'
  | 'refund_payment'
  | 'withdraw_approve'
  | 'withdraw_reject'
  | 'withdraw_mark_paid'
  | 'payout_job_create'
  | 'payout_job_retry'
  | 'payout_job_cancel'
  | 'payout_job_force_confirm'
  | (string & {});

export type AuditUserRef = {
  display_name: string | null;
  phone: string | null;
} | null;

export type AdminAuditRow = {
  id: number;
  created_at: string;
  actor_id: string;
  action: AuditAction;
  target_user_id: string;
  note: string | null;
  details?: Record<string, unknown> | null;
  actor?: AuditUserRef;
  target?: AuditUserRef;
};

export async function listAdminAuditLog(
  supabase: SupabaseClient,
  args: { limit?: number; offset?: number; action?: AuditAction | string } = {},
): Promise<{ rows: AdminAuditRow[]; page: { limit: number; offset: number; returned: number } }> {
  noStore();

  const limit = Math.min(200, Math.max(1, args.limit ?? 50));
  const offset = Math.max(0, args.offset ?? 0);

  const query = supabase
    .from('admin_audit_log')
    .select(
      'id,created_at,actor_id,action,target_user_id,note,details,actor:profiles!admin_audit_log_actor_id_fkey(display_name,phone),target:profiles!admin_audit_log_target_user_id_fkey(display_name,phone)',
    );

  const action = typeof args.action === 'string' ? args.action.trim() : '';
  if (action) {
    query.eq('action', action);
  }

  const { data, error } = await query
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    throw new Error(`admin_audit_log select failed: ${error.message}`);
  }

  // Supabase join results may come back as a single object or a single-element array depending
  // on relationship metadata. Normalize to our UI shape.
  const rows = (data ?? []).map((r: any) => {
    const actor = Array.isArray(r.actor) ? (r.actor[0] ?? null) : (r.actor ?? null);
    const target = Array.isArray(r.target) ? (r.target[0] ?? null) : (r.target ?? null);
    return { ...r, actor, target } as AdminAuditRow;
  });
  return {
    rows,
    page: {
      limit,
      offset,
      returned: rows.length,
    },
  };
}
