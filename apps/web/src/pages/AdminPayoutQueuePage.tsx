import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabaseClient';
import { getIsAdmin } from '../lib/admin';
import { errorText } from '../lib/errors';
import AdminNav from '../components/AdminNav';
import { formatIQD } from '../lib/money';

type JobRow = {
  id: string;
  withdraw_request_id: string;
  payout_kind: 'qicard' | 'asiapay' | 'zaincash';
  amount_iqd: number;
  status: string;
  provider_ref: string | null;
  last_error: string | null;
  attempt_count?: number | null;
  max_attempts?: number | null;
  next_attempt_at?: string | null;
  created_at: string;
  sent_at: string | null;
  confirmed_at: string | null;
  failed_at: string | null;
};

export default function AdminPayoutQueuePage() {
  const isAdminQ = useQuery({
    queryKey: ['admin', 'isAdmin'],
    queryFn: getIsAdmin,
  });

  const jobsQ = useQuery({
    queryKey: ['admin', 'payoutJobs'],
    enabled: !!isAdminQ.data,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('payout_provider_jobs')
        .select('id, withdraw_request_id, payout_kind, amount_iqd, status, provider_ref, last_error, attempt_count, max_attempts, next_attempt_at, created_at, sent_at, confirmed_at, failed_at')
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as JobRow[];
    },
    refetchInterval: 8_000,
  });

  const [busy, setBusy] = React.useState<string | null>(null);
  const [toast, setToast] = React.useState<string | null>(null);

  const sendJob = async (jobId: string) => {
    setBusy(jobId);
    setToast(null);
    try {
      const { data, error } = await supabase.functions.invoke('payout-job-send', { body: { job_id: jobId } });
      if (error) throw error;
      setToast(JSON.stringify(data, null, 2));
      await jobsQ.refetch();
    } catch (e: unknown) {
      setToast(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const doAction = async (jobId: string, action: 'cancel' | 'retry_now' | 'force_confirm') => {
    setBusy(jobId);
    setToast(null);
    try {
      const { data, error } = await supabase.functions.invoke('payout-job-action', { body: { job_id: jobId, action } });
      if (error) throw error;
      setToast(JSON.stringify(data, null, 2));
      await jobsQ.refetch();
    } catch (e: unknown) {
      setToast(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  if (isAdminQ.isLoading) {
    return (
      <div className="mx-auto max-w-5xl p-4">
        <AdminNav />
        <div className="mt-4 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">Loading…</div>
      </div>
    );
  }

  if (!isAdminQ.data) {
    return (
      <div className="mx-auto max-w-5xl p-4">
        <AdminNav />
        <div className="mt-4 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">Not authorized.</div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl p-4">
      <AdminNav />

      <div className="mt-4 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div className="text-sm font-semibold">Payout Queue</div>
            <div className="text-xs text-gray-500">Send payouts + track retries + confirm via webhooks</div>
          </div>
          <button className="btn" onClick={() => jobsQ.refetch()}>
            Refresh
          </button>
        </div>

        {jobsQ.isLoading ? <div className="mt-3 text-sm text-gray-600">Loading…</div> : null}
        {jobsQ.isError ? <div className="mt-3 text-sm text-red-600">{errorText(jobsQ.error)}</div> : null}

        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 border-b">
                <th className="py-2 pr-3">Created</th>
                <th className="py-2 pr-3">Withdraw</th>
                <th className="py-2 pr-3">Kind</th>
                <th className="py-2 pr-3">Amount</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3">Attempts</th>
                <th className="py-2 pr-3">Next</th>
                <th className="py-2 pr-3">Provider ref</th>
                <th className="py-2 pr-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {(jobsQ.data ?? []).map((j) => {
                const attempts = `${j.attempt_count ?? 0}/${j.max_attempts ?? 0}`;
                const next = j.next_attempt_at ? new Date(j.next_attempt_at).toLocaleString() : '—';
                const isQueued = j.status === 'queued';
                const isFailed = j.status === 'failed';
                const isSent = j.status === 'sent';
                const isConfirmed = j.status === 'confirmed';
                const canSend = isQueued || isFailed;
                return (
                  <tr key={j.id} className="border-b last:border-b-0">
                    <td className="py-2 pr-3 whitespace-nowrap">{new Date(j.created_at).toLocaleString()}</td>
                    <td className="py-2 pr-3 font-mono text-xs">{j.withdraw_request_id}</td>
                    <td className="py-2 pr-3">{j.payout_kind}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">{formatIQD(j.amount_iqd)}</td>
                    <td className="py-2 pr-3">
                      <span className="rounded-full border px-2 py-0.5 text-xs">{j.status}</span>
                      {j.last_error ? <div className="mt-1 text-xs text-red-600">{j.last_error}</div> : null}
                    </td>
                    <td className="py-2 pr-3 whitespace-nowrap">{attempts}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">{next}</td>
                    <td className="py-2 pr-3 font-mono text-xs">{j.provider_ref ?? '—'}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">
                      <div className="flex flex-wrap gap-2">
                        {canSend ? (
                          <button className="btn btn-primary" disabled={busy === j.id} onClick={() => sendJob(j.id)}>
                            {busy === j.id ? 'Sending…' : 'Send'}
                          </button>
                        ) : null}
                        {isFailed ? (
                          <button className="btn" disabled={busy === j.id} onClick={() => doAction(j.id, 'retry_now')}>
                            Retry now
                          </button>
                        ) : null}
                        {(isQueued || isFailed || isSent) ? (
                          <button className="btn" disabled={busy === j.id} onClick={() => doAction(j.id, 'cancel')}>
                            Cancel
                          </button>
                        ) : null}
                        {isSent && !isConfirmed ? (
                          <button className="btn" disabled={busy === j.id} onClick={() => doAction(j.id, 'force_confirm')}>
                            Force confirm
                          </button>
                        ) : null}
                        <button className="btn" onClick={() => setToast(JSON.stringify(j, null, 2))}>
                          Details
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {(jobsQ.data ?? []).length === 0 ? (
                <tr>
                  <td className="py-4 text-sm text-gray-500" colSpan={9}>
                    No payout jobs.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        {toast ? <pre className="mt-3 whitespace-pre-wrap rounded-xl border border-gray-200 bg-gray-50 p-3 text-xs">{toast}</pre> : null}
      </div>
    </div>
  );
}
