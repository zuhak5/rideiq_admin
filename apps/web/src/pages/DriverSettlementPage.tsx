import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabaseClient';
import { errorText } from '../lib/errors';
import { formatIQD, formatSignedIQD, parseIQDInput } from '../lib/money';

type AccountRow = {
  balance_iqd: number | string;
  currency: string;
  updated_at: string;
};

type EntryRow = {
  id: string;
  created_at: string;
  delta_iqd: number | string;
  reason: string;
  ref_type: string | null;
  ref_id: string | null;
};

type RequestRow = {
  id: string;
  status: string;
  amount_iqd: number;
  method: string;
  reference: string | null;
  requested_at: string;
  processed_at: string | null;
  admin_note: string | null;
};

type StatementSummaryRow = {
  opening_balance_iqd: number | string;
  closing_balance_iqd: number | string;
  credits_iqd: number | string;
  debits_iqd: number | string;
  entry_count: number | string;
};

type StatementEntryRow = {
  id: string;
  created_at: string;
  delta_iqd: number | string;
  reason: string;
  ref_type: string | null;
  ref_id: string | null;
  running_balance_iqd: number | string;
};

function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function isoStart(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`);
  return d.toISOString();
}

function isoEndExclusive(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + 1);
  return d.toISOString();
}

async function fetchMyStatementSummary(dateFrom: string, dateTo: string): Promise<StatementSummaryRow> {
  const { data, error } = await supabase.rpc('driver_settlement_statement_summary_v1', {
    p_start: isoStart(dateFrom),
    p_end: isoEndExclusive(dateTo),
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return (row ?? { opening_balance_iqd: 0, closing_balance_iqd: 0, credits_iqd: 0, debits_iqd: 0, entry_count: 0 }) as StatementSummaryRow;
}

async function fetchMyStatementEntries(dateFrom: string, dateTo: string): Promise<StatementEntryRow[]> {
  const { data, error } = await supabase.rpc('driver_settlement_statement_entries_v1', {
    p_start: isoStart(dateFrom),
    p_end: isoEndExclusive(dateTo),
    p_limit: 1000,
    p_offset: 0,
  });
  if (error) throw error;
  return (Array.isArray(data) ? data : []) as StatementEntryRow[];
}

function asNumber(v: number | string | null | undefined): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function genIdempotency(prefix: string): string {
  const c: any = typeof crypto !== 'undefined' ? crypto : null;
  if (c && typeof c.randomUUID === 'function') return `${prefix}:${c.randomUUID()}`;
  return `${prefix}:${Date.now()}:${Math.random().toString(16).slice(2)}`;
}

async function fetchMyAccount(): Promise<AccountRow> {
  const { data, error } = await supabase.rpc('driver_settlement_get_my_account_v1');
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return { balance_iqd: 0, currency: 'IQD', updated_at: new Date().toISOString() };
  return row as AccountRow;
}

async function fetchMyEntries(): Promise<EntryRow[]> {
  const { data, error } = await supabase.rpc('driver_settlement_list_entries_v1', { p_limit: 100, p_offset: 0 });
  if (error) throw error;
  return (Array.isArray(data) ? data : []) as EntryRow[];
}

async function fetchMyPaymentRequests(): Promise<RequestRow[]> {
  const { data, error } = await supabase.rpc('driver_settlement_list_payment_requests_v1', { p_limit: 25, p_offset: 0 });
  if (error) throw error;
  return (Array.isArray(data) ? data : []) as RequestRow[];
}

async function fetchMyPayoutRequests(): Promise<RequestRow[]> {
  const { data, error } = await supabase.rpc('driver_settlement_list_payout_requests_v1', { p_limit: 25, p_offset: 0 });
  if (error) throw error;
  return (Array.isArray(data) ? data : []) as RequestRow[];
}

function fmtTime(ts: string | null | undefined): string {
  if (!ts) return '—';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString();
}

function StatusPill({ status }: { status: string }) {
  const s = (status || '').toLowerCase();
  const cls =
    s === 'approved'
      ? 'bg-green-50 text-green-700 border-green-200'
      : s === 'rejected'
        ? 'bg-red-50 text-red-700 border-red-200'
        : s === 'cancelled'
          ? 'bg-gray-50 text-gray-700 border-gray-200'
          : 'bg-yellow-50 text-yellow-700 border-yellow-200';
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${cls}`}>{status}</span>;
}

export default function DriverSettlementPage() {
  const qc = useQueryClient();

  const acctQ = useQuery<AccountRow, Error>({
    queryKey: ['driver_settlement_account'],
    queryFn: fetchMyAccount,
    staleTime: 15_000,
  });

  const entriesQ = useQuery<EntryRow[], Error>({
    queryKey: ['driver_settlement_entries'],
    queryFn: fetchMyEntries,
    staleTime: 10_000,
  });

  const paymentReqQ = useQuery<RequestRow[], Error>({
    queryKey: ['driver_settlement_payment_requests'],
    queryFn: fetchMyPaymentRequests,
    staleTime: 10_000,
  });

  const payoutReqQ = useQuery<RequestRow[], Error>({
    queryKey: ['driver_settlement_payout_requests'],
    queryFn: fetchMyPayoutRequests,
    staleTime: 10_000,
  });

  const balance = asNumber(acctQ.data?.balance_iqd);
  const owes = balance < 0;
  const absBal = Math.abs(Math.trunc(balance));

  const [payAmount, setPayAmount] = React.useState('');
  const [payMethod, setPayMethod] = React.useState('cash');
  const [payRef, setPayRef] = React.useState('');

  const [payoutAmount, setPayoutAmount] = React.useState('');
  const [payoutMethod, setPayoutMethod] = React.useState('cash');
  const [payoutRef, setPayoutRef] = React.useState('');


  const [stmtFrom, setStmtFrom] = React.useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  });
  const [stmtTo, setStmtTo] = React.useState(() => new Date().toISOString().slice(0, 10));
  const [stmtBusy, setStmtBusy] = React.useState(false);
  const [stmtErr, setStmtErr] = React.useState<string | null>(null);

  const stmtSummaryQ = useQuery<StatementSummaryRow, Error>({
    queryKey: ['driver_settlement_statement_summary', stmtFrom, stmtTo],
    queryFn: () => fetchMyStatementSummary(stmtFrom, stmtTo),
    enabled: Boolean(stmtFrom && stmtTo),
    staleTime: 10_000,
  });

  const paymentMut = useMutation({
    mutationFn: async () => {
      const amt = parseIQDInput(payAmount);
      if (amt <= 0) throw new Error('Amount is required.');
      const { error } = await supabase.rpc('driver_settlement_request_payment_v1', {
        p_amount_iqd: amt,
        p_method: payMethod,
        p_reference: payRef.trim() || null,
        p_idempotency_key: genIdempotency('driver_payment_request'),
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      setPayAmount('');
      setPayRef('');
      await qc.invalidateQueries({ queryKey: ['driver_settlement_payment_requests'] });
    },
  });

  const payoutMut = useMutation({
    mutationFn: async () => {
      const amt = parseIQDInput(payoutAmount);
      if (amt <= 0) throw new Error('Amount is required.');
      const { error } = await supabase.rpc('driver_settlement_request_payout_v1', {
        p_amount_iqd: amt,
        p_method: payoutMethod,
        p_reference: payoutRef.trim() || null,
        p_idempotency_key: genIdempotency('driver_payout_request'),
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      setPayoutAmount('');
      setPayoutRef('');
      await qc.invalidateQueries({ queryKey: ['driver_settlement_payout_requests'] });
    },
  });

  const refresh = () => {
    void acctQ.refetch();
    void entriesQ.refetch();
    void paymentReqQ.refetch();
    void payoutReqQ.refetch();
  };

  return (
    <div className="space-y-6">
      <div className="card p-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="text-base font-semibold">Settlement</div>
            <div className="text-sm text-gray-500 mt-1">
              Cash rides are paid to you directly. The platform fee is tracked here as a balance.
            </div>
          </div>
          <button className="btn" onClick={refresh} type="button">
            Refresh
          </button>
        </div>

        {acctQ.isLoading ? <div className="mt-4 text-sm text-gray-500">Loading…</div> : null}
        {acctQ.error ? <div className="mt-4 text-sm text-red-600">{errorText(acctQ.error)}</div> : null}

        {acctQ.data ? (
          <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="rounded-xl border p-4">
              <div className="text-xs text-gray-500">Status</div>
              <div className="mt-1 font-semibold">{owes ? 'You owe the platform' : 'Platform owes you'}</div>
            </div>
            <div className="rounded-xl border p-4">
              <div className="text-xs text-gray-500">Balance</div>
              <div className={owes ? 'mt-1 font-semibold text-red-700' : 'mt-1 font-semibold text-green-700'}>
                {owes ? `−${formatIQD(absBal)}` : `+${formatIQD(absBal)}`}
              </div>
              <div className="text-xs text-gray-400 mt-1">Currency: {acctQ.data.currency}</div>
            </div>
            <div className="rounded-xl border p-4">
              <div className="text-xs text-gray-500">Last updated</div>
              <div className="mt-1 font-semibold">{fmtTime(acctQ.data.updated_at)}</div>
            </div>
          </div>
        ) : null}
      </div>

      <div className="card p-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="text-base font-semibold">Statement</div>
            <div className="text-sm text-gray-500 mt-1">
              Export a CSV statement and review opening/closing balances for a date range.
            </div>
          </div>
          <button
            className="btn"
            type="button"
            disabled={stmtBusy}
            onClick={async () => {
              setStmtErr(null);
              setStmtBusy(true);
              try {
                const entries = await fetchMyStatementEntries(stmtFrom, stmtTo);
                const header = ['created_at', 'delta_iqd', 'reason', 'ref_type', 'ref_id', 'running_balance_iqd'];
                const lines = [header.join(',')].concat(
                  entries.map((e) => [
                    new Date(e.created_at).toISOString(),
                    asNumber(e.delta_iqd),
                    (e.reason || '').replaceAll(',', ' '),
                    (e.ref_type ?? '').replaceAll(',', ' '),
                    e.ref_id ?? '',
                    asNumber(e.running_balance_iqd),
                  ].join(','))
                );
                downloadCsv(`driver_statement_${stmtFrom}_${stmtTo}.csv`, lines.join('\n'));
              } catch (err: any) {
                setStmtErr(errorText(err));
              } finally {
                setStmtBusy(false);
              }
            }}
          >
            {stmtBusy ? 'Exporting…' : 'Export CSV'}
          </button>
        </div>

        <div className="mt-4 grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <div className="text-xs text-gray-600">From</div>
            <input
              className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
              type="date"
              value={stmtFrom}
              onChange={(e) => setStmtFrom(e.target.value)}
            />
          </div>
          <div>
            <div className="text-xs text-gray-600">To</div>
            <input
              className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
              type="date"
              value={stmtTo}
              onChange={(e) => setStmtTo(e.target.value)}
            />
          </div>

          <div className="rounded-xl border p-3">
            <div className="text-xs text-gray-500">Opening</div>
            <div className="mt-1 font-semibold">{formatIQD(asNumber(stmtSummaryQ.data?.opening_balance_iqd))}</div>
          </div>
          <div className="rounded-xl border p-3">
            <div className="text-xs text-gray-500">Closing</div>
            <div className="mt-1 font-semibold">{formatIQD(asNumber(stmtSummaryQ.data?.closing_balance_iqd))}</div>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="rounded-xl border p-3">
            <div className="text-xs text-gray-500">Credits</div>
            <div className="mt-1 font-semibold text-green-700">+{formatIQD(asNumber(stmtSummaryQ.data?.credits_iqd))}</div>
          </div>
          <div className="rounded-xl border p-3">
            <div className="text-xs text-gray-500">Debits</div>
            <div className="mt-1 font-semibold text-red-700">−{formatIQD(asNumber(stmtSummaryQ.data?.debits_iqd))}</div>
          </div>
          <div className="rounded-xl border p-3">
            <div className="text-xs text-gray-500">Entries</div>
            <div className="mt-1 font-semibold">{asNumber(stmtSummaryQ.data?.entry_count)}</div>
          </div>
        </div>

        {stmtSummaryQ.isLoading ? <div className="mt-3 text-sm text-gray-500">Loading statement summary…</div> : null}
        {stmtSummaryQ.error ? <div className="mt-3 text-sm text-red-700">{errorText(stmtSummaryQ.error)}</div> : null}
        {stmtErr ? <div className="mt-3 text-sm text-red-700">{stmtErr}</div> : null}
      </div>

      <div className="card p-5">
        <div className="text-base font-semibold">Requests</div>
        <div className="mt-1 text-sm text-gray-500">
          Use requests when you pay cash to the office/agent (to reduce a negative balance) or when you want the platform to pay out your positive balance.
        </div>

        <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="rounded-xl border p-4">
            <div className="font-semibold">Report a payment to the platform</div>
            <div className="text-xs text-gray-500 mt-1">Admin will verify and then credit your settlement balance.</div>
            <div className="mt-3 grid grid-cols-1 gap-3">
              <div>
                <div className="text-xs text-gray-600">Amount (IQD)</div>
                <input
                  className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                  placeholder={owes ? String(absBal) : 'e.g. 25,000'}
                />
              </div>
              <div>
                <div className="text-xs text-gray-600">Method</div>
                <input
                  className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
                  value={payMethod}
                  onChange={(e) => setPayMethod(e.target.value)}
                  placeholder="cash / office / agent / transfer"
                />
              </div>
              <div>
                <div className="text-xs text-gray-600">Reference (optional)</div>
                <input
                  className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
                  value={payRef}
                  onChange={(e) => setPayRef(e.target.value)}
                  placeholder="receipt number / transfer ref"
                />
              </div>
              {paymentMut.error ? (
                <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{errorText(paymentMut.error)}</div>
              ) : null}
              <button className="btn btn-primary" type="button" onClick={() => paymentMut.mutate()} disabled={paymentMut.isPending}>
                {paymentMut.isPending ? 'Submitting…' : 'Submit payment request'}
              </button>
            </div>
          </div>

          <div className="rounded-xl border p-4">
            <div className="font-semibold">Request a payout</div>
            <div className="text-xs text-gray-500 mt-1">Only available if your balance is positive.</div>
            <div className="mt-3 grid grid-cols-1 gap-3">
              <div>
                <div className="text-xs text-gray-600">Amount (IQD)</div>
                <input
                  className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
                  value={payoutAmount}
                  onChange={(e) => setPayoutAmount(e.target.value)}
                  placeholder={balance > 0 ? String(absBal) : '0'}
                />
              </div>
              <div>
                <div className="text-xs text-gray-600">Method</div>
                <input
                  className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
                  value={payoutMethod}
                  onChange={(e) => setPayoutMethod(e.target.value)}
                  placeholder="cash / transfer / agent"
                />
              </div>
              <div>
                <div className="text-xs text-gray-600">Reference (optional)</div>
                <input
                  className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
                  value={payoutRef}
                  onChange={(e) => setPayoutRef(e.target.value)}
                  placeholder="preferred payout details"
                />
              </div>
              {payoutMut.error ? (
                <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{errorText(payoutMut.error)}</div>
              ) : null}
              <button
                className="btn btn-primary"
                type="button"
                onClick={() => payoutMut.mutate()}
                disabled={payoutMut.isPending || balance <= 0}
              >
                {payoutMut.isPending ? 'Submitting…' : 'Submit payout request'}
              </button>
              {balance <= 0 ? <div className="text-xs text-gray-500">Current balance must be positive to request a payout.</div> : null}
            </div>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="rounded-xl border p-4">
            <div className="font-semibold">My payment requests</div>
            {paymentReqQ.isLoading ? <div className="mt-3 text-sm text-gray-500">Loading…</div> : null}
            {paymentReqQ.error ? <div className="mt-3 text-sm text-red-600">{errorText(paymentReqQ.error)}</div> : null}
            {paymentReqQ.data && paymentReqQ.data.length === 0 ? <div className="mt-3 text-sm text-gray-500">No requests.</div> : null}
            {paymentReqQ.data && paymentReqQ.data.length > 0 ? (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-500">
                      <th className="py-2">Time</th>
                      <th className="py-2">Amount</th>
                      <th className="py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paymentReqQ.data.slice(0, 10).map((r) => (
                      <tr key={r.id} className="border-t">
                        <td className="py-2 whitespace-nowrap">{fmtTime(r.requested_at)}</td>
                        <td className="py-2 whitespace-nowrap">{formatIQD(asNumber(r.amount_iqd))}</td>
                        <td className="py-2">
                          <StatusPill status={r.status} />
                          {r.admin_note ? <div className="text-xs text-gray-500 mt-1">{r.admin_note}</div> : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>

          <div className="rounded-xl border p-4">
            <div className="font-semibold">My payout requests</div>
            {payoutReqQ.isLoading ? <div className="mt-3 text-sm text-gray-500">Loading…</div> : null}
            {payoutReqQ.error ? <div className="mt-3 text-sm text-red-600">{errorText(payoutReqQ.error)}</div> : null}
            {payoutReqQ.data && payoutReqQ.data.length === 0 ? <div className="mt-3 text-sm text-gray-500">No requests.</div> : null}
            {payoutReqQ.data && payoutReqQ.data.length > 0 ? (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-500">
                      <th className="py-2">Time</th>
                      <th className="py-2">Amount</th>
                      <th className="py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payoutReqQ.data.slice(0, 10).map((r) => (
                      <tr key={r.id} className="border-t">
                        <td className="py-2 whitespace-nowrap">{fmtTime(r.requested_at)}</td>
                        <td className="py-2 whitespace-nowrap">{formatIQD(asNumber(r.amount_iqd))}</td>
                        <td className="py-2">
                          <StatusPill status={r.status} />
                          {r.admin_note ? <div className="text-xs text-gray-500 mt-1">{r.admin_note}</div> : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="card p-5">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <div className="text-base font-semibold">Recent entries</div>
            <div className="text-sm text-gray-500 mt-1">Most recent first.</div>
          </div>
          <button className="btn" onClick={() => { void acctQ.refetch(); void entriesQ.refetch(); }} type="button">
            Refresh
          </button>
        </div>

        {entriesQ.isLoading ? <div className="mt-4 text-sm text-gray-500">Loading…</div> : null}
        {entriesQ.error ? <div className="mt-4 text-sm text-red-600">{errorText(entriesQ.error)}</div> : null}

        {entriesQ.data && entriesQ.data.length === 0 ? (
          <div className="mt-4 text-sm text-gray-500">No settlement entries yet.</div>
        ) : null}

        {entriesQ.data && entriesQ.data.length > 0 ? (
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
                {entriesQ.data.map((e) => {
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
  );
}
