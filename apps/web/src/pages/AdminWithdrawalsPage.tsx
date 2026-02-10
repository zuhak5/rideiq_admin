import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabaseClient';
import { getIsAdmin } from '../lib/admin';
import { errorText } from '../lib/errors';
import AdminNav from '../components/AdminNav';
import { formatIQD } from '../lib/money';

type ProfileMini = {
  id: string | null;
  display_name: string | null;
  phone: string | null;
};

type WithdrawRow = {
  id: string;
  user_id: string;
  amount_iqd: number;
  payout_kind: 'qicard' | 'asiapay' | 'zaincash';
  destination: Record<string, unknown> | null;
  status: 'requested' | 'approved' | 'rejected' | 'paid' | 'cancelled';
  note: string | null;
  payout_reference: string | null;
  created_at: string;
  approved_at: string | null;
  paid_at: string | null;
  cancelled_at: string | null;
  rejected_at: string | null;
  profiles?: ProfileMini | null;
};

function fmtWhen(iso?: string | null) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function destinationSummary(kind: WithdrawRow['payout_kind'], dest: WithdrawRow['destination']) {
  const d = dest ?? {};
  const s = (k: string) => {
    const v = (d as Record<string, unknown>)[k];
    return typeof v === 'string' ? v : '';
  };

  if (kind === 'zaincash') return `Wallet: ${s('wallet_number') || '—'}`;
  if (kind === 'qicard') return `Card: ${s('card_number') || '—'}`;
  if (kind === 'asiapay') return `Account: ${s('account') || s('wallet_number') || '—'}`;
  return '—';
}

async function fetchWithdrawals(status: string): Promise<WithdrawRow[]> {
  // Must be admin to view all withdrawals.
  const isAdmin = await getIsAdmin();
  if (!isAdmin) throw new Error('Not authorized');

  let q = supabase
    .from('wallet_withdraw_requests')
    .select(
      'id,user_id,amount_iqd,payout_kind,destination,status,note,payout_reference,created_at,approved_at,paid_at,cancelled_at,rejected_at,profiles(id,display_name,phone)'
    )
    .order('created_at', { ascending: false })
    .limit(250);

  if (status !== 'all') q = q.eq('status', status);

  const { data, error } = await q;
  if (error) throw error;

  return (data as unknown as WithdrawRow[]) ?? [];
}

type ModalMode = 'approve' | 'reject' | 'mark_paid';

function ActionModal({
  open,
  mode,
  row,
  onClose,
  onDone,
}: {
  open: boolean;
  mode: ModalMode;
  row: WithdrawRow | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const [note, setNote] = React.useState('');
  const [ref, setRef] = React.useState('');

  React.useEffect(() => {
    if (!open) return;
    setBusy(false);
    setErr(null);
    setNote('');
    setRef('');
  }, [open, mode]);

  if (!open || !row) return null;

  const title =
    mode === 'approve' ? 'Approve withdrawal' : mode === 'reject' ? 'Reject withdrawal' : 'Mark paid';

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      if (mode === 'approve') {
        const { error } = await supabase.rpc('admin_withdraw_approve', { p_request_id: row.id, p_note: note || null });
        if (error) throw error;
      } else if (mode === 'reject') {
        const { error } = await supabase.rpc('admin_withdraw_reject', { p_request_id: row.id, p_note: note || null });
        if (error) throw error;
      } else {
        if (!ref.trim()) throw new Error('Payout reference is required.');
        const { error } = await supabase.rpc('admin_withdraw_mark_paid', { p_request_id: row.id, p_payout_reference: ref.trim() });
        if (error) throw error;
      }

      onDone();
      onClose();
    } catch (e: unknown) {
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl border border-gray-200">
        <div className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-base font-semibold">{title}</div>
              <div className="mt-1 text-sm text-gray-600">
                {formatIQD(row.amount_iqd)} • {row.payout_kind} • {destinationSummary(row.payout_kind, row.destination)}
              </div>
              <div className="mt-1 text-xs text-gray-500">Request: {row.id}</div>
            </div>
            <button className="btn" onClick={onClose} disabled={busy}>Close</button>
          </div>

          {mode !== 'mark_paid' ? (
            <div className="mt-4">
              <label className="text-xs text-gray-600">Note (optional)</label>
              <textarea
                className="mt-1 w-full rounded-xl border border-gray-200 p-3 text-sm"
                rows={3}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={mode === 'approve' ? 'Approval note (optional)' : 'Reason for rejection (recommended)'}
              />
            </div>
          ) : (
            <div className="mt-4">
              <label className="text-xs text-gray-600">Payout reference (required)</label>
              <input
                className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
                value={ref}
                onChange={(e) => setRef(e.target.value)}
                placeholder="Provider reference / transaction id"
              />
              <div className="mt-2 text-xs text-gray-500">
                Best practice: store the provider transaction id so payouts can be reconciled and audited later.
              </div>
            </div>
          )}

          {err ? <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{err}</div> : null}

          <div className="mt-4 flex gap-2 justify-end">
            <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
            <button className="btn btn-primary" onClick={submit} disabled={busy}>
              {busy ? 'Working…' : mode === 'approve' ? 'Approve' : mode === 'reject' ? 'Reject' : 'Mark paid'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AdminWithdrawalsPage() {
  const [filter, setFilter] = React.useState<'requested' | 'approved' | 'paid' | 'rejected' | 'cancelled' | 'all'>('requested');
  const [selected, setSelected] = React.useState<WithdrawRow | null>(null);
  const [modal, setModal] = React.useState<{ open: boolean; mode: ModalMode }>({ open: false, mode: 'approve' });
  const [toast, setToast] = React.useState<string | null>(null);


const enqueuePayoutJob = async (row: WithdrawRow) => {
  setToast(null);
  try {
    const { data, error } = await supabase.functions.invoke('payout-job-create', {
      body: { withdraw_request_id: row.id, idempotency_key: `withdraw:${row.id}:payout_job` },
    });
    if (error) throw error;
    setToast(JSON.stringify(data, null, 2));
  } catch (e: unknown) {
    setToast(errorText(e));
  }
};


  const q = useQuery({
    queryKey: ['admin_withdrawals', filter],
    queryFn: () => fetchWithdrawals(filter),
  });

  const rows = q.data ?? [];

  const openModal = (mode: ModalMode, row: WithdrawRow) => {
    setSelected(row);
    setModal({ open: true, mode });
  };

  return (
    <div className="space-y-4">
      <AdminNav />

      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="text-sm font-semibold">Withdrawals</div>
            <div className="text-xs text-gray-500">Approve, reject, and mark paid. Funds are held until paid.</div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <select
              className="rounded-xl border border-gray-200 px-3 py-2 text-sm"
              value={filter}
              onChange={(e) => setFilter(e.target.value as typeof filter)}
            >
              <option value="requested">Requested</option>
              <option value="approved">Approved</option>
              <option value="paid">Paid</option>
              <option value="rejected">Rejected</option>
              <option value="cancelled">Cancelled</option>
              <option value="all">All</option>
            </select>
            <button className="btn" onClick={() => q.refetch()} disabled={q.isFetching}>Refresh</button>
          </div>
        </div>

        {q.isLoading ? <div className="mt-3 text-sm text-gray-600">Loading…</div> : null}
        {q.error ? <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{errorText(q.error)}</div> : null}
        {toast ? <div className="mt-3 rounded-xl border p-3 text-sm bg-white">{toast}</div> : null}

        <div className="mt-4 overflow-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-gray-500">
              <tr>
                <th className="py-2 pr-3">When</th>
                <th className="py-2 pr-3">User</th>
                <th className="py-2 pr-3">Amount</th>
                <th className="py-2 pr-3">Payout</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const userLabel =
                  r.profiles?.display_name
                    ? `${r.profiles.display_name}${r.profiles.phone ? ` • ${r.profiles.phone}` : ''}`
                    : `${r.user_id.slice(0, 8)}…`;

                return (
                  <tr key={r.id} className="border-t">
                    <td className="py-2 pr-3 whitespace-nowrap">{fmtWhen(r.created_at)}</td>
                    <td className="py-2 pr-3">
                      <div className="font-medium">{userLabel}</div>
                      <div className="text-xs text-gray-500">{destinationSummary(r.payout_kind, r.destination)}</div>
                    </td>
                    <td className="py-2 pr-3 whitespace-nowrap font-semibold">{formatIQD(r.amount_iqd)}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">{r.payout_kind}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">
                      <span className="inline-flex items-center rounded-xl border px-2 py-1 text-xs">
                        {r.status}
                      </span>
                      {r.status === 'paid' && r.payout_reference ? (
                        <div className="text-xs text-gray-500 mt-1">Ref: {r.payout_reference}</div>
                      ) : null}
                    </td>
                    <td className="py-2 pr-3 whitespace-nowrap">
                      <div className="flex gap-2 flex-wrap">
                        {r.status === 'requested' ? (
                          <>
                            <button className="btn btn-primary" onClick={() => openModal('approve', r)}>Approve</button>
                            <button className="btn" onClick={() => openModal('reject', r)}>Reject</button>
                          </>
                        ) : null}
                        {r.status === 'approved' ? (
                          <>
                            <button className="btn btn-primary" onClick={() => openModal('mark_paid', r)}>Mark paid</button>
                            <button className="btn" onClick={() => enqueuePayoutJob(r)}>Enqueue Payout</button>
                            <button className="btn" onClick={() => openModal('reject', r)}>Reject</button>
                          </>
                        ) : null}
                        <button
                          className="btn"
                          onClick={() => {
                            setSelected(r);
                            setToast(
                              `Request ${r.id}\n` +
                                `Status: ${r.status}\n` +
                                `Created: ${fmtWhen(r.created_at)}\n` +
                                `Approved: ${fmtWhen(r.approved_at)}\n` +
                                `Paid: ${fmtWhen(r.paid_at)}`
                            );
                          }}
                        >
                          Details
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && !q.isLoading ? (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-gray-500">
                    No withdrawals found.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <ActionModal
        open={modal.open}
        mode={modal.mode}
        row={selected}
        onClose={() => setModal((s) => ({ ...s, open: false }))}
        onDone={() => {
          setToast('Done.');
          void q.refetch();
        }}
      />
    </div>
  );
}
