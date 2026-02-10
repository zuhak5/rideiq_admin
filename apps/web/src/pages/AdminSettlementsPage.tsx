import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabaseClient';
import { getIsAdmin } from '../lib/admin';
import { errorText } from '../lib/errors';
import AdminNav from '../components/AdminNav';
import { formatIQD, formatSignedIQD, parseIQDInput } from '../lib/money';

type PartyType = 'driver' | 'merchant';

type AccountRow = {
  party_type: PartyType;
  party_id: string;
  balance_iqd: number | string;
  currency: string;
  updated_at: string;
  last_entry_at: string | null;
};

type EntryRow = {
  id: string;
  created_at: string;
  delta_iqd: number | string;
  reason: string;
  ref_type: string | null;
  ref_id: string | null;
};

type CashAgentRow = {
  id: string;
  code: string;
  name: string;
  location: string | null;
  is_active: boolean;
  created_at: string;
};

type RequestRow = {
  id: string;
  party_type: PartyType;
  party_id: string;
  amount_iqd: number | string;
  method: string;
  reference: string | null;
  status: string;
  requested_by: string;
  requested_at: string;
  processed_by: string | null;
  processed_at: string | null;
  admin_note: string | null;
};


function asNumber(v: number | string | null | undefined): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function fmtTime(ts: string | null | undefined): string {
  if (!ts) return '—';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString();
}

async function fetchAccounts(args: {
  partyType: PartyType | 'all';
  onlyNegative: boolean;
  minAbs: number;
}): Promise<AccountRow[]> {
  const { data, error } = await supabase.rpc('admin_settlement_list_accounts_v1', {
    p_party_type: args.partyType === 'all' ? null : args.partyType,
    p_only_negative: args.onlyNegative,
    p_min_abs_balance_iqd: args.minAbs,
    p_limit: 200,
    p_offset: 0,
  });
  if (error) throw error;
  return (Array.isArray(data) ? data : []) as AccountRow[];
}

async function fetchEntries(partyType: PartyType, partyId: string): Promise<EntryRow[]> {
  const { data, error } = await supabase.rpc('admin_settlement_list_entries_v1', {
    p_party_type: partyType,
    p_party_id: partyId,
    p_limit: 200,
    p_offset: 0,
  });
  if (error) throw error;
  return (Array.isArray(data) ? data : []) as EntryRow[];
}

type ReconciliationRow = {
  day: string;
  cash_ride_collections_iqd: number | string;
  cash_ride_platform_fees_iqd: number | string;
  cod_driver_due_iqd: number | string;
  cod_commission_iqd: number | string;
  receipts_iqd: number | string;
  payouts_iqd: number | string;
};

async function fetchReconciliation(days: number): Promise<ReconciliationRow[]> {
  const { data, error } = await supabase.rpc('admin_reconciliation_daily_v1', {
    p_days: days,
  });
  if (error) throw error;
  return (Array.isArray(data) ? data : []) as ReconciliationRow[];
}


async function fetchPaymentRequests(status: string = 'requested'): Promise<RequestRow[]> {
  const { data, error } = await supabase.rpc('admin_settlement_list_payment_requests_v1', {
    p_status: status,
    p_party_type: null,
    p_limit: 200,
    p_offset: 0,
  });
  if (error) throw error;
  return (Array.isArray(data) ? data : []) as RequestRow[];
}

async function fetchPayoutRequests(status: string = 'requested'): Promise<RequestRow[]> {
  const { data, error } = await supabase.rpc('admin_settlement_list_payout_requests_v1', {
    p_status: status,
    p_party_type: null,
    p_limit: 200,
    p_offset: 0,
  });
  if (error) throw error;
  return (Array.isArray(data) ? data : []) as RequestRow[];
}


async function fetchCashAgents(activeOnly: boolean = true): Promise<CashAgentRow[]> {
  const { data, error } = await supabase.rpc('admin_cash_agent_list_v1', {
    p_active_only: activeOnly,
  });
  if (error) throw error;
  return (Array.isArray(data) ? data : []) as CashAgentRow[];
}


type CashboxRow = {
  day: string;
  receipts_iqd: number | string;
  receipts_count: number | string;
  payouts_iqd: number | string;
  payouts_count: number | string;
  expected_net_iqd: number | string;
  counted_cash_iqd: number | string | null;
  variance_iqd: number | string | null;
  closed_at: string | null;
};

async function fetchCashbox(agentId: string, dateFrom: string, dateTo: string): Promise<CashboxRow[]> {
  const { data, error } = await supabase.rpc('admin_cashbox_reconciliation_v1', {
    p_agent_id: agentId,
    p_date_from: dateFrom,
    p_date_to: dateTo,
  });
  if (error) throw error;
  return (Array.isArray(data) ? data : []) as CashboxRow[];
}


function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function ReceiptModal({
  open,
  row,
  agents,
  defaultAgentId,
  onClose,
  onDone,
}: {
  open: boolean;
  row: AccountRow;
  agents: CashAgentRow[];
  defaultAgentId?: string | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [amount, setAmount] = React.useState('');
  const [method, setMethod] = React.useState('cash');
  const [reference, setReference] = React.useState('');
  const [agentId, setAgentId] = React.useState<string>('');
  const [day, setDay] = React.useState<string>(() => new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const [docNo, setDocNo] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setAmount('');
    setMethod('cash');
    setReference('');
    setDay(new Date().toISOString().slice(0, 10));
    setBusy(false);
    setErr(null);
    setDocNo(null);
    const next = defaultAgentId || agents.find((a) => a.is_active)?.id || '';
    setAgentId(next);
  }, [open, agents, defaultAgentId]);

  if (!open) return null;

  const submit = async () => {
    setErr(null);
    const amt = parseIQDInput(amount);
    if (amt <= 0) {
      setErr('Amount is required.');
      return;
    }

    setBusy(true);
    try {
      const idem =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `receipt:${row.party_type}:${row.party_id}:${Date.now()}:${Math.random().toString(16).slice(2)}`;

      const { data, error } = await supabase.rpc('admin_settlement_record_receipt_v2', {
        p_party_type: row.party_type,
        p_party_id: row.party_id,
        p_amount_iqd: amt,
        p_method: method,
        p_reference: reference.trim() || null,
        p_agent_id: agentId || null,
        p_day: day,
        p_idempotency_key: idem,
      });
      if (error) throw error;

      const first = Array.isArray(data) ? data[0] : data;
      const no = (first as any)?.receipt_no || null;
      setDocNo(no);
      onDone();
    } catch (e: unknown) {
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const copy = async (txt: string) => {
    try {
      await navigator.clipboard.writeText(txt);
    } catch {
      // ignore
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl border border-gray-200">
        <div className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-base font-semibold">Record settlement receipt</div>
              <div className="mt-1 text-sm text-gray-600">
                {row.party_type} • {row.party_id}
              </div>
              <div className="mt-1 text-xs text-gray-500">Current balance: {formatSignedIQD(asNumber(row.balance_iqd))}</div>
            </div>
            <button className="btn" onClick={onClose} disabled={busy}>
              Close
            </button>
          </div>

          {docNo ? (
            <div className="mt-4 rounded-xl border border-green-200 bg-green-50 p-3 text-sm text-green-800">
              <div className="font-semibold">Receipt recorded</div>
              <div className="mt-1">Receipt No: <span className="font-mono">{docNo}</span></div>
              <div className="mt-2 flex gap-2">
                <button className="btn" type="button" onClick={() => void copy(docNo)}>Copy</button>
                <button className="btn btn-primary" type="button" onClick={onClose}>Done</button>
              </div>
            </div>
          ) : (
            <>
              <div className="mt-4 grid grid-cols-1 gap-4">
                <div>
                  <label className="text-xs text-gray-600">Agent (optional, enables receipt numbering)</label>
                  <select
                    className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
                    value={agentId}
                    onChange={(e) => setAgentId(e.target.value)}
                  >
                    <option value="">No agent</option>
                    {agents
                      .filter((a) => a.is_active)
                      .map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.code} — {a.name}{a.location ? ` (${a.location})` : ''}
                        </option>
                      ))}
                  </select>
                </div>

                <div>
                  <label className="text-xs text-gray-600">Day</label>
                  <input
                    className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
                    type="date"
                    value={day}
                    onChange={(e) => setDay(e.target.value)}
                  />
                </div>

                <div>
                  <label className="text-xs text-gray-600">Amount (IQD)</label>
                  <input
                    className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="e.g. 50,000"
                  />
                  <div className="mt-1 text-xs text-gray-500">Receipt increases the party balance (reduces what they owe).</div>
                </div>

                <div>
                  <label className="text-xs text-gray-600">Method</label>
                  <input
                    className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
                    value={method}
                    onChange={(e) => setMethod(e.target.value)}
                    placeholder="cash / transfer / agent / ..."
                  />
                </div>

                <div>
                  <label className="text-xs text-gray-600">Reference (optional)</label>
                  <input
                    className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                    placeholder="payer name / notes"
                  />
                </div>
              </div>

              {err ? <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{err}</div> : null}

              <div className="mt-4 flex gap-2 justify-end">
                <button className="btn" onClick={onClose} disabled={busy}>
                  Cancel
                </button>
                <button className="btn btn-primary" onClick={submit} disabled={busy}>
                  {busy ? 'Working…' : 'Record receipt'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function PayoutModal({
  open,
  row,
  agents,
  defaultAgentId,
  onClose,
  onDone,
}: {
  open: boolean;
  row: AccountRow;
  agents: CashAgentRow[];
  defaultAgentId?: string | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [amount, setAmount] = React.useState('');
  const [method, setMethod] = React.useState('cash');
  const [reference, setReference] = React.useState('');
  const [agentId, setAgentId] = React.useState<string>('');
  const [day, setDay] = React.useState<string>(() => new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const [docNo, setDocNo] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setAmount('');
    setMethod('cash');
    setReference('');
    setDay(new Date().toISOString().slice(0, 10));
    setBusy(false);
    setErr(null);
    setDocNo(null);
    const next = defaultAgentId || agents.find((a) => a.is_active)?.id || '';
    setAgentId(next);
  }, [open, agents, defaultAgentId]);

  if (!open) return null;

  const submit = async () => {
    setErr(null);
    const amt = parseIQDInput(amount);
    if (amt <= 0) {
      setErr('Amount is required.');
      return;
    }

    setBusy(true);
    try {
      const idem =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `payout:${row.party_type}:${row.party_id}:${Date.now()}:${Math.random().toString(16).slice(2)}`;

      const { data, error } = await supabase.rpc('admin_settlement_record_payout_v2', {
        p_party_type: row.party_type,
        p_party_id: row.party_id,
        p_amount_iqd: amt,
        p_method: method,
        p_reference: reference.trim() || null,
        p_agent_id: agentId || null,
        p_day: day,
        p_idempotency_key: idem,
      });
      if (error) throw error;

      const first = Array.isArray(data) ? data[0] : data;
      const no = (first as any)?.payout_no || null;
      setDocNo(no);
      onDone();
    } catch (e: unknown) {
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const copy = async (txt: string) => {
    try {
      await navigator.clipboard.writeText(txt);
    } catch {
      // ignore
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl border border-gray-200">
        <div className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-base font-semibold">Record payout</div>
              <div className="mt-1 text-sm text-gray-600">
                {row.party_type} • {row.party_id}
              </div>
              <div className="mt-1 text-xs text-gray-500">Current balance: {formatSignedIQD(asNumber(row.balance_iqd))}</div>
            </div>
            <button className="btn" onClick={onClose} disabled={busy}>
              Close
            </button>
          </div>

          {docNo ? (
            <div className="mt-4 rounded-xl border border-green-200 bg-green-50 p-3 text-sm text-green-800">
              <div className="font-semibold">Payout recorded</div>
              <div className="mt-1">Payout No: <span className="font-mono">{docNo}</span></div>
              <div className="mt-2 flex gap-2">
                <button className="btn" type="button" onClick={() => void copy(docNo)}>Copy</button>
                <button className="btn btn-primary" type="button" onClick={onClose}>Done</button>
              </div>
            </div>
          ) : (
            <>
              <div className="mt-4 grid grid-cols-1 gap-4">
                <div>
                  <label className="text-xs text-gray-600">Agent (optional, enables payout numbering)</label>
                  <select
                    className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
                    value={agentId}
                    onChange={(e) => setAgentId(e.target.value)}
                  >
                    <option value="">No agent</option>
                    {agents
                      .filter((a) => a.is_active)
                      .map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.code} — {a.name}{a.location ? ` (${a.location})` : ''}
                        </option>
                      ))}
                  </select>
                </div>

                <div>
                  <label className="text-xs text-gray-600">Day</label>
                  <input
                    className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
                    type="date"
                    value={day}
                    onChange={(e) => setDay(e.target.value)}
                  />
                </div>

                <div>
                  <label className="text-xs text-gray-600">Amount (IQD)</label>
                  <input
                    className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="e.g. 50,000"
                  />
                  <div className="mt-1 text-xs text-gray-500">Payout decreases the party balance (platform paid cash out).</div>
                </div>

                <div>
                  <label className="text-xs text-gray-600">Method</label>
                  <input
                    className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
                    value={method}
                    onChange={(e) => setMethod(e.target.value)}
                    placeholder="cash / transfer / agent / ..."
                  />
                </div>

                <div>
                  <label className="text-xs text-gray-600">Reference (optional)</label>
                  <input
                    className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                    placeholder="payee name / notes"
                  />
                </div>
              </div>

              {err ? <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{err}</div> : null}

              <div className="mt-4 flex gap-2 justify-end">
                <button className="btn" onClick={onClose} disabled={busy}>
                  Cancel
                </button>
                <button className="btn btn-primary" onClick={submit} disabled={busy}>
                  {busy ? 'Working…' : 'Record payout'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}


function CashboxCloseModal({
  open,
  agent,
  day,
  onClose,
  onDone,
}: {
  open: boolean;
  agent: CashAgentRow;
  day: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [counted, setCounted] = React.useState('');
  const [note, setNote] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setCounted('');
    setNote('');
    setBusy(false);
    setErr(null);
  }, [open, day]);

  if (!open) return null;

  const submit = async () => {
    setErr(null);
    const amt = parseIQDInput(counted);
    if (amt < 0) {
      setErr('Counted cash must be >= 0.');
      return;
    }

    setBusy(true);
    try {
      const idem =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `cashbox_close:${agent.id}:${day}:${Date.now()}:${Math.random().toString(16).slice(2)}`;

      const { error } = await supabase.rpc('admin_cashbox_close_day_v1', {
        p_agent_id: agent.id,
        p_day: day,
        p_counted_cash_iqd: amt,
        p_note: note.trim() || null,
        p_idempotency_key: idem,
      });
      if (error) throw error;
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
              <div className="text-base font-semibold">Close cashbox day</div>
              <div className="mt-1 text-sm text-gray-600">
                {agent.code} • {agent.name} • {day}
              </div>
              <div className="mt-1 text-xs text-gray-500">
                Enter the physically counted cash for this agent/day. The system will compute expected net from receipts and payouts.
              </div>
            </div>
            <button className="btn" onClick={onClose} disabled={busy}>
              Close
            </button>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4">
            <div>
              <label className="text-xs text-gray-600">Counted cash (IQD)</label>
              <input
                className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
                value={counted}
                onChange={(e) => setCounted(e.target.value)}
                placeholder="e.g. 250,000"
              />
            </div>
            <div>
              <label className="text-xs text-gray-600">Note (optional)</label>
              <input
                className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="short note / variance explanation"
              />
            </div>
          </div>

          {err ? <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{err}</div> : null}

          <div className="mt-4 flex gap-2 justify-end">
            <button className="btn" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={submit} disabled={busy}>
              {busy ? 'Working…' : 'Close day'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function RequestReviewModal({
  open,
  kind,
  row,
  onClose,
  onDone,
}: {
  open: boolean;
  kind: 'payment' | 'payout';
  row: RequestRow;
  onClose: () => void;
  onDone: () => void;
}) {
  const [adminNote, setAdminNote] = React.useState('');
  const [refOverride, setRefOverride] = React.useState('');

  const approveMut = useMutation({
    mutationFn: async () => {
      const args = {
        p_request_id: row.id,
        p_admin_note: adminNote.trim() ? adminNote.trim() : null,
        p_reference_override: refOverride.trim() ? refOverride.trim() : null,
      } as any;

      const rpc = kind === 'payment' ? 'admin_settlement_approve_payment_request_v1' : 'admin_settlement_approve_payout_request_v1';
      const { error } = await supabase.rpc(rpc, args);
      if (error) throw error;
    },
    onSuccess: () => {
      onDone();
      onClose();
    },
  });

  const rejectMut = useMutation({
    mutationFn: async () => {
      const args = {
        p_request_id: row.id,
        p_admin_note: adminNote.trim() ? adminNote.trim() : null,
      } as any;

      const rpc = kind === 'payment' ? 'admin_settlement_reject_payment_request_v1' : 'admin_settlement_reject_payout_request_v1';
      const { error } = await supabase.rpc(rpc, args);
      if (error) throw error;
    },
    onSuccess: () => {
      onDone();
      onClose();
    },
  });

  if (!open) return null;

  const busy = approveMut.isPending || rejectMut.isPending;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-xl rounded-2xl bg-white shadow-xl border border-gray-200">
        <div className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-base font-semibold">Review request</div>
              <div className="mt-1 text-sm text-gray-600">
                {kind === 'payment' ? 'Payment request' : 'Payout request'} • {row.party_type} • {row.party_id.slice(0, 8)}…
              </div>
              <div className="mt-2 text-sm">
                Amount: <span className="font-semibold">{formatIQD(asNumber(row.amount_iqd))}</span> • Method: <span className="font-semibold">{row.method}</span>
              </div>
              {row.reference ? <div className="mt-1 text-xs text-gray-500">Ref: {row.reference}</div> : null}
              <div className="mt-1 text-xs text-gray-500">Requested: {fmtTime(row.requested_at)}</div>
            </div>
            <button className="btn" onClick={onClose} disabled={busy}>
              Close
            </button>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3">
            <div>
              <div className="text-xs text-gray-600">Admin note (optional)</div>
              <textarea
                className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
                value={adminNote}
                onChange={(e) => setAdminNote(e.target.value)}
                rows={3}
                placeholder="note for audit trail"
              />
            </div>
            <div>
              <div className="text-xs text-gray-600">Reference override (optional)</div>
              <input
                className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
                value={refOverride}
                onChange={(e) => setRefOverride(e.target.value)}
                placeholder="receipt/transfer id"
              />
              <div className="mt-1 text-xs text-gray-500">If set, this will be stored on the receipt/payout record.</div>
            </div>
          </div>

          {(approveMut.error || rejectMut.error) ? (
            <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {errorText((approveMut.error || rejectMut.error) as any)}
            </div>
          ) : null}

          <div className="mt-4 flex gap-2 justify-end">
            <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
            <button className="btn" onClick={() => rejectMut.mutate()} disabled={busy}>
              {rejectMut.isPending ? 'Rejecting…' : 'Reject'}
            </button>
            <button className="btn btn-primary" onClick={() => approveMut.mutate()} disabled={busy}>
              {approveMut.isPending ? 'Approving…' : 'Approve'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function EntriesModal({
  open,
  row,
  onClose,
}: {
  open: boolean;
  row: AccountRow;
  onClose: () => void;
}) {
  const q = useQuery<EntryRow[], Error>({
    queryKey: ['admin_settlement_entries', row.party_type, row.party_id],
    queryFn: () => fetchEntries(row.party_type, row.party_id),
    enabled: open,
    staleTime: 5_000,
  });

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-3xl rounded-2xl bg-white shadow-xl border border-gray-200">
        <div className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-base font-semibold">Settlement entries</div>
              <div className="mt-1 text-sm text-gray-600">
                {row.party_type} • {row.party_id}
              </div>
              <div className="mt-1 text-xs text-gray-500">Current balance: {formatSignedIQD(asNumber(row.balance_iqd))}</div>
            </div>
            <button className="btn" onClick={onClose}>
              Close
            </button>
          </div>

          {q.isLoading ? <div className="mt-4 text-sm text-gray-500">Loading…</div> : null}
          {q.error ? <div className="mt-4 text-sm text-red-600">{errorText(q.error)}</div> : null}

          {q.data && q.data.length === 0 ? <div className="mt-4 text-sm text-gray-500">No entries.</div> : null}

          {q.data && q.data.length > 0 ? (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-500">
                    <th className="py-2">Time</th>
                    <th className="py-2">Delta</th>
                    <th className="py-2">Reason</th>
                    <th className="py-2">Ref</th>
                  </tr>
                </thead>
                <tbody>
                  {q.data.map((e) => {
                    const delta = asNumber(e.delta_iqd);
                    const neg = delta < 0;
                    return (
                      <tr key={e.id} className="border-t">
                        <td className="py-2 whitespace-nowrap">{fmtTime(e.created_at)}</td>
                        <td className={neg ? 'py-2 font-semibold text-red-700' : 'py-2 font-semibold text-green-700'}>
                          {formatSignedIQD(delta)}
                        </td>
                        <td className="py-2">{e.reason}</td>
                        <td className="py-2 text-xs text-gray-500">
                          {e.ref_type ? `${e.ref_type}${e.ref_id ? `:${String(e.ref_id).slice(0, 8)}…` : ''}` : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default function AdminSettlementsPage() {
  const isAdminQ = useQuery<boolean, Error>({
    queryKey: ['admin_is_admin'],
    queryFn: () => getIsAdmin(),
    staleTime: 60_000,
  });

  const isAdmin = isAdminQ.data === true;

  const agentsQ = useQuery<CashAgentRow[], Error>({
    queryKey: ['admin_cash_agents'],
    queryFn: () => fetchCashAgents(false),
    enabled: isAdmin,
    staleTime: 30_000,
  });


  const qc = useQueryClient();

  const [reqTab, setReqTab] = React.useState<'payment' | 'payout'>('payment');
  const [requestFor, setRequestFor] = React.useState<{ kind: 'payment' | 'payout'; row: RequestRow } | null>(null);

  const [partyType, setPartyType] = React.useState<PartyType | 'all'>('driver');
  const [onlyNegative, setOnlyNegative] = React.useState(true);
  const [minAbs, setMinAbs] = React.useState('0');
  const [entriesFor, setEntriesFor] = React.useState<AccountRow | null>(null);
  const [receiptFor, setReceiptFor] = React.useState<AccountRow | null>(null);
  const [payoutFor, setPayoutFor] = React.useState<AccountRow | null>(null);

  const [reconDays, setReconDays] = React.useState('14');

  const [cashboxAgentId, setCashboxAgentId] = React.useState<string>('');
  const [cashboxFrom, setCashboxFrom] = React.useState<string>(() => new Date(Date.now() - 13 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10));
  const [cashboxTo, setCashboxTo] = React.useState<string>(() => new Date().toISOString().slice(0, 10));
  const [cashboxCloseFor, setCashboxCloseFor] = React.useState<string | null>(null);

  const reconDaysNum = Math.max(1, Math.min(90, Number.parseInt(reconDays, 10) || 14));

  // default cashbox agent to first active agent
  React.useEffect(() => {
    if (cashboxAgentId) return;
    const list = agentsQ.data ?? [];
    if (list.length === 0) return;
    const preferred = list.find((a) => a.is_active) || list[0];
    setCashboxAgentId(preferred.id);
  }, [agentsQ.data, cashboxAgentId]);

  const minAbsNum = Math.max(0, parseIQDInput(minAbs));

  const accountsQ = useQuery<AccountRow[], Error>({
    queryKey: ['admin_settlement_accounts', partyType, onlyNegative, minAbsNum],
    queryFn: () => fetchAccounts({ partyType, onlyNegative, minAbs: minAbsNum }),
    enabled: isAdmin,
    staleTime: 10_000,
  });

  const reconQ = useQuery<ReconciliationRow[], Error>({
    queryKey: ['admin_reconciliation', reconDaysNum],
    queryFn: () => fetchReconciliation(reconDaysNum),
    enabled: isAdmin,
    staleTime: 15_000,
  });

  const cashboxQ = useQuery<CashboxRow[], Error>({
    queryKey: ['admin_cashbox', cashboxAgentId, cashboxFrom, cashboxTo],
    queryFn: () => fetchCashbox(cashboxAgentId, cashboxFrom, cashboxTo),
    enabled: isAdmin && !!cashboxAgentId,
    staleTime: 10_000,
  });



  const paymentRequestsQ = useQuery<RequestRow[], Error>({
    queryKey: ['admin_payment_requests', 'requested'],
    queryFn: () => fetchPaymentRequests('requested'),
    enabled: isAdmin,
    staleTime: 10_000,
  });

  const payoutRequestsQ = useQuery<RequestRow[], Error>({
    queryKey: ['admin_payout_requests', 'requested'],
    queryFn: () => fetchPayoutRequests('requested'),
    enabled: isAdmin,
    staleTime: 10_000,
  });

  const refresh = () => {
    void accountsQ.refetch();
    void reconQ.refetch();
            void cashboxQ.refetch();
    void paymentRequestsQ.refetch();
    void payoutRequestsQ.refetch();
  };

  if (isAdminQ.isLoading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <AdminNav />
        <div className="max-w-5xl mx-auto p-6">
          <div className="bg-white rounded-xl shadow p-6">
            <div className="text-lg font-semibold">Checking permissions…</div>
          </div>
        </div>
      </div>
    );
  }

  if (isAdminQ.error) {
    return (
      <div className="min-h-screen bg-gray-50">
        <AdminNav />
        <div className="max-w-5xl mx-auto p-6">
          <div className="bg-white rounded-xl shadow p-6">
            <div className="text-lg font-semibold">Failed to load</div>
            <div className="text-sm text-red-700 mt-2">{errorText(isAdminQ.error)}</div>
          </div>
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-gray-50">
        <AdminNav />
        <div className="max-w-5xl mx-auto p-6">
          <div className="bg-white rounded-xl shadow p-6">
            <div className="text-lg font-semibold">Admin only</div>
            <div className="text-sm text-gray-600 mt-2">You don&apos;t have permission to view this page.</div>
          </div>
        </div>
      </div>
    );
  }

  const selectedAgent = (agentsQ.data ?? []).find((a) => a.id === cashboxAgentId) ?? null;

  return (
    <div className="min-h-screen bg-gray-50">
      <AdminNav />
      <div className="max-w-5xl mx-auto p-6 space-y-6">
        <div className="bg-white rounded-xl shadow p-6">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <div className="text-xl font-semibold">Settlements</div>
              <div className="text-sm text-gray-600 mt-2">
                Negative balances mean the party owes the platform (drivers: cash rides fees or COD goods due; merchants: commission).
              </div>
            </div>
            <button className="btn" onClick={refresh} type="button">
              Refresh
            </button>
          </div>

          <div className="mt-4 grid grid-cols-1 md:grid-cols-4 gap-3">
            <div>
              <div className="text-xs text-gray-600">Party</div>
              <select
                className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
                value={partyType}
                onChange={(e) => setPartyType(e.target.value as PartyType | 'all')}
              >
                <option value="all">All</option>
                <option value="driver">Drivers</option>
                <option value="merchant">Merchants</option>
              </select>
            </div>

            <div>
              <div className="text-xs text-gray-600">Only negative</div>
              <button
                className={onlyNegative ? 'mt-1 w-full btn btn-primary' : 'mt-1 w-full btn'}
                type="button"
                onClick={() => setOnlyNegative((v) => !v)}
              >
                {onlyNegative ? 'On' : 'Off'}
              </button>
            </div>

            <div>
              <div className="text-xs text-gray-600">Min abs balance (IQD)</div>
              <input
                className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
                value={minAbs}
                onChange={(e) => setMinAbs(e.target.value)}
                placeholder="0"
              />
            </div>

            <div className="flex items-end">
              <button className="btn w-full" onClick={refresh} type="button">Apply</button>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow p-6">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <div className="text-base font-semibold">Reconciliation</div>
              <div className="text-sm text-gray-600 mt-1">Daily totals for cash collections, COD exposure, receipts, and payouts.</div>
            </div>
            <div className="flex gap-2 flex-wrap items-end">
              <div>
                <div className="text-xs text-gray-600">Days</div>
                <input
                  className="mt-1 w-24 rounded-xl border border-gray-200 px-3 py-2 text-sm"
                  value={reconDays}
                  onChange={(e) => setReconDays(e.target.value)}
                  placeholder="14"
                />
              </div>
              <button className="btn" onClick={() => void reconQ.refetch()} type="button">
                Refresh
              </button>
              <button
                className="btn"
                type="button"
                onClick={() => {
                  const rows = reconQ.data ?? [];
                  const header = ['day', 'cash_ride_collections_iqd', 'cash_ride_platform_fees_iqd', 'cod_driver_due_iqd', 'cod_commission_iqd', 'receipts_iqd', 'payouts_iqd'];
                  const lines = [header.join(',')].concat(
                    rows.map((r) => [
                      r.day,
                      asNumber(r.cash_ride_collections_iqd),
                      asNumber(r.cash_ride_platform_fees_iqd),
                      asNumber(r.cod_driver_due_iqd),
                      asNumber(r.cod_commission_iqd),
                      asNumber(r.receipts_iqd),
                      asNumber(r.payouts_iqd),
                    ].join(',')),
                  );
                  downloadCsv(`reconciliation_${new Date().toISOString().slice(0, 10)}.csv`, lines.join('\n'));
                }}
              >
                Export CSV
              </button>
            </div>
          </div>

          {reconQ.isLoading ? <div className="mt-4 text-sm text-gray-500">Loading…</div> : null}
          {reconQ.error ? <div className="mt-4 text-sm text-red-700">{errorText(reconQ.error)}</div> : null}

          {reconQ.data && reconQ.data.length === 0 ? (
            <div className="mt-4 text-sm text-gray-500">No reconciliation rows.</div>
          ) : null}

          {reconQ.data && reconQ.data.length > 0 ? (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-500">
                    <th className="py-2">Day</th>
                    <th className="py-2">Cash collected</th>
                    <th className="py-2">Platform fees</th>
                    <th className="py-2">COD driver due</th>
                    <th className="py-2">COD commission</th>
                    <th className="py-2">Receipts</th>
                    <th className="py-2">Payouts</th>
                  </tr>
                </thead>
                <tbody>
                  {reconQ.data.map((r) => (
                    <tr key={r.day} className="border-t">
                      <td className="py-2 whitespace-nowrap">{r.day}</td>
                      <td className="py-2 whitespace-nowrap">{formatIQD(asNumber(r.cash_ride_collections_iqd))}</td>
                      <td className="py-2 whitespace-nowrap">{formatIQD(asNumber(r.cash_ride_platform_fees_iqd))}</td>
                      <td className="py-2 whitespace-nowrap">{formatIQD(asNumber(r.cod_driver_due_iqd))}</td>
                      <td className="py-2 whitespace-nowrap">{formatIQD(asNumber(r.cod_commission_iqd))}</td>
                      <td className="py-2 whitespace-nowrap">{formatIQD(asNumber(r.receipts_iqd))}</td>
                      <td className="py-2 whitespace-nowrap">{formatIQD(asNumber(r.payouts_iqd))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>

        <div className="bg-white rounded-xl shadow p-6">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <div className="text-base font-semibold">Cashbox by agent</div>
              <div className="text-sm text-gray-600 mt-1">Per-agent receipts and payouts with daily closing variance (counted cash vs expected).</div>
            </div>
            <div className="flex gap-2 flex-wrap items-end">
              <button className="btn" onClick={() => void cashboxQ.refetch()} type="button" disabled={!cashboxAgentId}>
                Refresh
              </button>
              <button
                className="btn"
                type="button"
                disabled={!cashboxQ.data || cashboxQ.data.length === 0}
                onClick={() => {
                  const rows = cashboxQ.data ?? [];
                  const header = ['day', 'receipts_iqd', 'receipts_count', 'payouts_iqd', 'payouts_count', 'expected_net_iqd', 'counted_cash_iqd', 'variance_iqd', 'closed_at'];
                  const lines = [header.join(',')].concat(
                    rows.map((r) => [
                      r.day,
                      asNumber(r.receipts_iqd),
                      asNumber(r.receipts_count),
                      asNumber(r.payouts_iqd),
                      asNumber(r.payouts_count),
                      asNumber(r.expected_net_iqd),
                      r.counted_cash_iqd == null ? '' : asNumber(r.counted_cash_iqd),
                      r.variance_iqd == null ? '' : asNumber(r.variance_iqd),
                      r.closed_at ?? '',
                    ].join(',')),
                  );
                  downloadCsv(`cashbox_${cashboxAgentId}_${new Date().toISOString().slice(0, 10)}.csv`, lines.join('\n'));
                }}
              >
                Export CSV
              </button>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 md:grid-cols-4 gap-3">
            <div>
              <div className="text-xs text-gray-600">Agent</div>
              <select
                className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
                value={cashboxAgentId}
                onChange={(e) => setCashboxAgentId(e.target.value)}
              >
                <option value="">Select agent…</option>
                {(agentsQ.data ?? []).map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} — {a.name}{a.is_active ? '' : ' (inactive)'}
                  </option>
                ))}
              </select>
              <div className="mt-1 text-xs text-gray-500">Manage agents in Admin → Agents.</div>
            </div>

            <div>
              <div className="text-xs text-gray-600">From</div>
              <input
                className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
                type="date"
                value={cashboxFrom}
                onChange={(e) => setCashboxFrom(e.target.value)}
              />
            </div>

            <div>
              <div className="text-xs text-gray-600">To</div>
              <input
                className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
                type="date"
                value={cashboxTo}
                onChange={(e) => setCashboxTo(e.target.value)}
              />
            </div>

            <div className="flex items-end">
              <button className="btn w-full" onClick={() => void cashboxQ.refetch()} type="button" disabled={!cashboxAgentId}>
                Apply
              </button>
            </div>
          </div>

          {agentsQ.isLoading ? <div className="mt-4 text-sm text-gray-500">Loading agents…</div> : null}
          {agentsQ.error ? <div className="mt-4 text-sm text-red-700">{errorText(agentsQ.error)}</div> : null}

          {!agentsQ.isLoading && (agentsQ.data ?? []).length === 0 ? (
            <div className="mt-4 text-sm text-gray-600">
              No agents configured yet. Create at least one agent so cash receipts/payouts can be attributed and reconciled.
            </div>
          ) : null}

          {cashboxQ.isLoading ? <div className="mt-4 text-sm text-gray-500">Loading cashbox…</div> : null}
          {cashboxQ.error ? <div className="mt-4 text-sm text-red-700">{errorText(cashboxQ.error)}</div> : null}

          {cashboxQ.data && cashboxQ.data.length === 0 && cashboxAgentId ? (
            <div className="mt-4 text-sm text-gray-500">No cashbox rows in range.</div>
          ) : null}

          {cashboxQ.data && cashboxQ.data.length > 0 ? (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-500">
                    <th className="py-2">Day</th>
                    <th className="py-2">Receipts</th>
                    <th className="py-2">Payouts</th>
                    <th className="py-2">Expected net</th>
                    <th className="py-2">Counted</th>
                    <th className="py-2">Variance</th>
                    <th className="py-2">Closed</th>
                    <th className="py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {cashboxQ.data.map((r) => {
                    const variance = r.variance_iqd == null ? null : asNumber(r.variance_iqd);
                    return (
                      <tr key={r.day} className="border-t">
                        <td className="py-2 whitespace-nowrap">{r.day}</td>
                        <td className="py-2 whitespace-nowrap">{formatIQD(asNumber(r.receipts_iqd))} <span className="text-xs text-gray-500">({asNumber(r.receipts_count)})</span></td>
                        <td className="py-2 whitespace-nowrap">{formatIQD(asNumber(r.payouts_iqd))} <span className="text-xs text-gray-500">({asNumber(r.payouts_count)})</span></td>
                        <td className="py-2 whitespace-nowrap">{formatIQD(asNumber(r.expected_net_iqd))}</td>
                        <td className="py-2 whitespace-nowrap">{r.counted_cash_iqd == null ? '—' : formatIQD(asNumber(r.counted_cash_iqd))}</td>
                        <td className={variance == null ? 'py-2 whitespace-nowrap' : variance === 0 ? 'py-2 whitespace-nowrap text-green-700' : 'py-2 whitespace-nowrap text-red-700'}>
                          {variance == null ? '—' : formatSignedIQD(variance)}
                        </td>
                        <td className="py-2 whitespace-nowrap">{r.closed_at ? fmtTime(r.closed_at) : '—'}</td>
                        <td className="py-2 whitespace-nowrap text-right">
                          <button className="btn" type="button" onClick={() => setCashboxCloseFor(r.day)} disabled={!selectedAgent}>
                            Close / update
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>




        <div className="bg-white rounded-xl shadow p-6">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <div className="text-base font-semibold">Settlement requests</div>
              <div className="text-sm text-gray-600 mt-1">Party-submitted requests (claims) waiting for admin approval.</div>
            </div>
            <div className="flex gap-2 flex-wrap items-end">
              <button
                className={reqTab === 'payment' ? 'btn btn-primary' : 'btn'}
                type="button"
                onClick={() => setReqTab('payment')}
              >
                Payments
              </button>
              <button
                className={reqTab === 'payout' ? 'btn btn-primary' : 'btn'}
                type="button"
                onClick={() => setReqTab('payout')}
              >
                Payouts
              </button>
              <button className="btn" type="button" onClick={() => { void paymentRequestsQ.refetch(); void payoutRequestsQ.refetch(); }}>
                Refresh
              </button>
            </div>
          </div>

          {reqTab === 'payment' ? (
            <>
              {paymentRequestsQ.isLoading ? <div className="mt-4 text-sm text-gray-500">Loading…</div> : null}
              {paymentRequestsQ.error ? <div className="mt-4 text-sm text-red-700">{errorText(paymentRequestsQ.error)}</div> : null}
              {paymentRequestsQ.data && paymentRequestsQ.data.length === 0 ? <div className="mt-4 text-sm text-gray-500">No pending payment requests.</div> : null}
              {paymentRequestsQ.data && paymentRequestsQ.data.length > 0 ? (
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-gray-500">
                        <th className="py-2">Time</th>
                        <th className="py-2">Party</th>
                        <th className="py-2">Amount</th>
                        <th className="py-2">Method</th>
                        <th className="py-2">Ref</th>
                        <th className="py-2">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paymentRequestsQ.data.map((r) => (
                        <tr key={r.id} className="border-t">
                          <td className="py-2 whitespace-nowrap">{fmtTime(r.requested_at)}</td>
                          <td className="py-2 whitespace-nowrap">{r.party_type}</td>
                          <td className="py-2 whitespace-nowrap">{formatIQD(asNumber(r.amount_iqd))}</td>
                          <td className="py-2">{r.method}</td>
                          <td className="py-2 text-xs text-gray-600">{r.reference ?? '—'}</td>
                          <td className="py-2">
                            <button className="btn" type="button" onClick={() => setRequestFor({ kind: 'payment', row: r })}>
                              Review
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </>
          ) : (
            <>
              {payoutRequestsQ.isLoading ? <div className="mt-4 text-sm text-gray-500">Loading…</div> : null}
              {payoutRequestsQ.error ? <div className="mt-4 text-sm text-red-700">{errorText(payoutRequestsQ.error)}</div> : null}
              {payoutRequestsQ.data && payoutRequestsQ.data.length === 0 ? <div className="mt-4 text-sm text-gray-500">No pending payout requests.</div> : null}
              {payoutRequestsQ.data && payoutRequestsQ.data.length > 0 ? (
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-gray-500">
                        <th className="py-2">Time</th>
                        <th className="py-2">Party</th>
                        <th className="py-2">Amount</th>
                        <th className="py-2">Method</th>
                        <th className="py-2">Ref</th>
                        <th className="py-2">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {payoutRequestsQ.data.map((r) => (
                        <tr key={r.id} className="border-t">
                          <td className="py-2 whitespace-nowrap">{fmtTime(r.requested_at)}</td>
                          <td className="py-2 whitespace-nowrap">{r.party_type}</td>
                          <td className="py-2 whitespace-nowrap">{formatIQD(asNumber(r.amount_iqd))}</td>
                          <td className="py-2">{r.method}</td>
                          <td className="py-2 text-xs text-gray-600">{r.reference ?? '—'}</td>
                          <td className="py-2">
                            <button className="btn" type="button" onClick={() => setRequestFor({ kind: 'payout', row: r })}>
                              Review
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </>
          )}
        </div>
        <div className="bg-white rounded-xl shadow p-6">
          <div className="text-base font-semibold">Accounts</div>

          {accountsQ.isLoading ? <div className="mt-4 text-sm text-gray-500">Loading…</div> : null}
          {accountsQ.error ? <div className="mt-4 text-sm text-red-700">{errorText(accountsQ.error)}</div> : null}

          {accountsQ.data && accountsQ.data.length === 0 ? (
            <div className="mt-4 text-sm text-gray-500">No matching accounts.</div>
          ) : null}

          {accountsQ.data && accountsQ.data.length > 0 ? (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-500">
                    <th className="py-2">Party</th>
                    <th className="py-2">Party ID</th>
                    <th className="py-2">Balance</th>
                    <th className="py-2">Updated</th>
                    <th className="py-2">Last entry</th>
                    <th className="py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {accountsQ.data.map((r) => {
                    const bal = asNumber(r.balance_iqd);
                    const neg = bal < 0;
                    return (
                      <tr key={`${r.party_type}:${r.party_id}`} className="border-t">
                        <td className="py-2 whitespace-nowrap">{r.party_type}</td>
                        <td className="py-2 font-mono text-xs">{r.party_id}</td>
                        <td className={neg ? 'py-2 font-semibold text-red-700' : 'py-2 font-semibold text-green-700'}>
                          {formatSignedIQD(bal)}
                        </td>
                        <td className="py-2 whitespace-nowrap">{fmtTime(r.updated_at)}</td>
                        <td className="py-2 whitespace-nowrap">{fmtTime(r.last_entry_at)}</td>
                        <td className="py-2">
                          <div className="flex gap-2 flex-wrap">
                            <button className="btn" onClick={() => setEntriesFor(r)} type="button">Entries</button>
                            <button className="btn btn-primary" onClick={() => setReceiptFor(r)} type="button">Record receipt</button>
                            <button
                              className="btn"
                              onClick={() => setPayoutFor(r)}
                              type="button"
                              disabled={asNumber(r.balance_iqd) <= 0}
                            >
                              Record payout
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      </div>
      {cashboxCloseFor && selectedAgent ? (
        <CashboxCloseModal
          open={!!cashboxCloseFor}
          agent={selectedAgent}
          day={cashboxCloseFor}
          onClose={() => setCashboxCloseFor(null)}
          onDone={() => {
            void cashboxQ.refetch();
          }}
        />
      ) : null}
      {requestFor ? (
        <RequestReviewModal
          open={!!requestFor}
          kind={requestFor.kind}
          row={requestFor.row}
          onClose={() => setRequestFor(null)}
          onDone={() => {
            void accountsQ.refetch();
            void paymentRequestsQ.refetch();
            void payoutRequestsQ.refetch();
            void reconQ.refetch();
            void cashboxQ.refetch();
            void qc.invalidateQueries({ queryKey: ['admin_settlement_entries'] });
          }}
        />
      ) : null}
      {entriesFor ? <EntriesModal open={!!entriesFor} row={entriesFor} onClose={() => setEntriesFor(null)} /> : null}
      {receiptFor ? (
        <ReceiptModal
          open={!!receiptFor}
          row={receiptFor}
          agents={agentsQ.data ?? []}
          defaultAgentId={cashboxAgentId}
          onClose={() => setReceiptFor(null)}
          onDone={() => {
            void accountsQ.refetch();
            if (entriesFor && receiptFor && entriesFor.party_type === receiptFor.party_type && entriesFor.party_id === receiptFor.party_id) {
              // no-op; entries modal will refetch on open.
            }
          }}
        />
      ) : null}

      {payoutFor ? (
        <PayoutModal
          open={!!payoutFor}
          row={payoutFor}
          agents={agentsQ.data ?? []}
          defaultAgentId={cashboxAgentId}
          onClose={() => setPayoutFor(null)}
          onDone={() => {
            void accountsQ.refetch();
          }}
        />
      ) : null}
    </div>
  );
}
