import React, { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import AdminNav from '../components/AdminNav';
import { getIsAdmin } from '../lib/admin';
import { supabase } from '../lib/supabaseClient';
import { errorText } from '../lib/errors';
import type { MerchantStatus } from '../lib/merchant';

type MerchantRow = {
  id: string;
  owner_profile_id: string;
  business_name: string;
  business_type: string;
  status: MerchantStatus | string;
  contact_phone: string | null;
  address_text: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type AuditRow = {
  id: string;
  created_at: string;
  from_status: string | null;
  to_status: string;
  note: string | null;
  actor_id: string | null;
};

type StatusFilter = 'pending' | 'approved' | 'suspended' | 'all';

const PAGE_SIZE = 25;

async function fetchMerchants(status: StatusFilter, q: string, page: number): Promise<{ rows: MerchantRow[]; hasMore: boolean }> {
  const from = page * PAGE_SIZE;
  const to = from + PAGE_SIZE; // inclusive => PAGE_SIZE+1 results

  let query = supabase
    .from('merchants')
    .select('id,owner_profile_id,business_name,business_type,status,contact_phone,address_text,created_at,updated_at')
    .order('created_at', { ascending: false })
    .range(from, to);

  if (status !== 'all') query = query.eq('status', status);

  const needle = q.trim();
  if (needle) {
    // OR search across business_name + business_type + contact_phone
    query = query.or(
      `business_name.ilike.%${needle}%,business_type.ilike.%${needle}%,contact_phone.ilike.%${needle}%`
    );
  }

  const { data, error } = await query;
  if (error) throw error;

  const rows = (data ?? []) as MerchantRow[];
  const hasMore = rows.length > PAGE_SIZE;
  return { rows: rows.slice(0, PAGE_SIZE), hasMore };
}

async function fetchAudit(merchantId: string): Promise<AuditRow[]> {
  const { data, error } = await supabase
    .from('merchant_status_audit_log')
    .select('id,created_at,from_status,to_status,note,actor_id')
    .eq('merchant_id', merchantId)
    .order('created_at', { ascending: false })
    .limit(15);

  if (error) throw error;
  return (data ?? []) as AuditRow[];
}

export default function AdminMerchantsPage() {
  const qc = useQueryClient();

  const isAdminQ = useQuery({ queryKey: ['is-admin'], queryFn: getIsAdmin });

  const [status, setStatus] = useState<StatusFilter>('pending');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);

  const merchantsQ = useQuery({
    queryKey: ['admin-merchants', status, q, page],
    queryFn: () => fetchMerchants(status, q, page),
    enabled: isAdminQ.data === true,
    staleTime: 10_000,
  });

  const rows = useMemo(() => merchantsQ.data?.rows ?? [], [merchantsQ.data?.rows]);
  const hasMore = !!merchantsQ.data?.hasMore;

  const [expanded, setExpanded] = useState<string | null>(null);
  const [note, setNote] = useState<Record<string, string>>({});
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);

  const auditQ = useQuery({
    queryKey: ['merchant-audit', expanded],
    queryFn: () => fetchAudit(expanded!),
    enabled: isAdminQ.data === true && !!expanded,
    staleTime: 5_000,
  });

  const statusCounts = useMemo(() => {
    const c = { pending: 0, approved: 0, suspended: 0 };
    for (const r of rows) {
      if (r.status === 'pending') c.pending++;
      if (r.status === 'approved') c.approved++;
      if (r.status === 'suspended') c.suspended++;
    }
    return c;
  }, [rows]);

  async function setMerchantStatus(merchantId: string, nextStatus: 'approved' | 'suspended' | 'pending') {
    setActionErr(null);
    setActing(merchantId);
    try {
      await supabase.rpc('admin_set_merchant_status', {
        p_merchant_id: merchantId,
        p_status: nextStatus,
        p_note: (note[merchantId] ?? '').trim() || null,
      });
      await qc.invalidateQueries({ queryKey: ['admin-merchants'] });
      await qc.invalidateQueries({ queryKey: ['merchant-audit', merchantId] });
    } catch (e: any) {
      setActionErr(errorText(e));
    } finally {
      setActing(null);
    }
  }

  return (
    <div className="space-y-4">
      <AdminNav />

      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="text-lg font-semibold">Merchants</div>
            <div className="text-sm text-gray-600">Approve or suspend businesses. Status changes are audited.</div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <FilterPill active={status === 'pending'} onClick={() => { setStatus('pending'); setPage(0); }}>Pending</FilterPill>
            <FilterPill active={status === 'approved'} onClick={() => { setStatus('approved'); setPage(0); }}>Approved</FilterPill>
            <FilterPill active={status === 'suspended'} onClick={() => { setStatus('suspended'); setPage(0); }}>Suspended</FilterPill>
            <FilterPill active={status === 'all'} onClick={() => { setStatus('all'); setPage(0); }}>All</FilterPill>
          </div>
        </div>

        <div className="mt-3 flex items-center justify-between gap-3 flex-wrap">
          <input
            className="w-full md:w-80 rounded-xl border border-gray-200 px-3 py-2 text-sm"
            placeholder="Search name / type / phone…"
            value={q}
            onChange={(e) => { setQ(e.target.value); setPage(0); }}
          />
          <div className="text-xs text-gray-500">
            Page {page + 1} • showing {rows.length} • (pending {statusCounts.pending}, approved {statusCounts.approved}, suspended {statusCounts.suspended})
          </div>
        </div>

        {isAdminQ.isLoading ? <div className="mt-4 text-sm text-gray-500">Checking admin…</div> : null}
        {isAdminQ.error ? <div className="mt-4 text-sm text-red-600">Admin check failed: {errorText(isAdminQ.error)}</div> : null}
        {isAdminQ.data === false ? <div className="mt-4 text-sm text-red-600">Not authorized.</div> : null}

        {merchantsQ.isLoading ? <div className="mt-4 text-sm text-gray-500">Loading merchants…</div> : null}
        {merchantsQ.error ? <div className="mt-4 text-sm text-red-600">Failed: {errorText(merchantsQ.error)}</div> : null}
        {actionErr ? <div className="mt-4 text-sm text-red-600">{actionErr}</div> : null}

        <div className="mt-4 grid gap-2">
          {rows.map((m) => {
            const isOpen = expanded === m.id;
            return (
              <div key={m.id} className="rounded-2xl border border-gray-200 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <div className="font-semibold truncate">{m.business_name}</div>
                      <span className="text-xs rounded-full border px-2 py-0.5">{m.status}</span>
                    </div>
                    <div className="text-sm text-gray-600">{m.business_type}</div>
                    <div className="text-xs text-gray-500 mt-1">
                      Owner: <span className="font-mono">{m.owner_profile_id}</span>
                      {m.contact_phone ? <> • Phone: {m.contact_phone}</> : null}
                    </div>
                    {m.address_text ? <div className="text-xs text-gray-500 mt-1">{m.address_text}</div> : null}
                  </div>

                  <div className="flex gap-2 flex-wrap justify-end">
                    <button
                      className="rounded-xl border border-gray-200 px-3 py-2 text-sm hover:bg-gray-50"
                      onClick={() => setExpanded(isOpen ? null : m.id)}
                    >
                      {isOpen ? 'Hide audit' : 'Audit'}
                    </button>

                    {m.status !== 'approved' ? (
                      <button
                        className="rounded-xl bg-gray-900 text-white px-3 py-2 text-sm disabled:opacity-50"
                        disabled={acting === m.id}
                        onClick={() => void setMerchantStatus(m.id, 'approved')}
                      >
                        Approve
                      </button>
                    ) : null}

                    {m.status !== 'suspended' ? (
                      <button
                        className="rounded-xl border border-gray-200 px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
                        disabled={acting === m.id}
                        onClick={() => void setMerchantStatus(m.id, 'suspended')}
                      >
                        Suspend
                      </button>
                    ) : (
                      <button
                        className="rounded-xl border border-gray-200 px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
                        disabled={acting === m.id}
                        onClick={() => void setMerchantStatus(m.id, 'approved')}
                      >
                        Re-approve
                      </button>
                    )}
                  </div>
                </div>

                <div className="mt-3">
                  <label className="block">
                    <div className="text-xs text-gray-600 mb-1">Audit note (optional)</div>
                    <input
                      className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
                      placeholder="Reason / ticket id / context…"
                      value={note[m.id] ?? ''}
                      onChange={(e) => setNote((s) => ({ ...s, [m.id]: e.target.value }))}
                    />
                  </label>
                </div>

                {isOpen ? (
                  <div className="mt-3 rounded-xl bg-gray-50 p-3 border border-gray-200">
                    <div className="text-sm font-semibold mb-2">Status audit</div>

                    {auditQ.isLoading ? <div className="text-sm text-gray-500">Loading audit…</div> : null}
                    {auditQ.error ? <div className="text-sm text-red-600">Audit failed: {errorText(auditQ.error)}</div> : null}

                    <div className="grid gap-2">
                      {(auditQ.data ?? []).map((a) => (
                        <div key={a.id} className="rounded-xl border border-gray-200 bg-white p-2">
                          <div className="text-xs text-gray-500">{a.created_at}</div>
                          <div className="text-sm">
                            {a.from_status ?? '—'} → <b>{a.to_status}</b>
                          </div>
                          <div className="text-xs text-gray-600">
                            Actor: <span className="font-mono">{a.actor_id ?? '—'}</span>
                          </div>
                          {a.note ? <div className="text-xs text-gray-700 mt-1">Note: {a.note}</div> : null}
                        </div>
                      ))}
                      {(auditQ.data ?? []).length === 0 && !auditQ.isLoading ? (
                        <div className="text-sm text-gray-500">No audit entries.</div>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}

          {rows.length === 0 && !merchantsQ.isLoading ? <div className="text-sm text-gray-500">No merchants.</div> : null}
        </div>

        <div className="mt-4 flex items-center justify-between">
          <button
            className="rounded-xl border border-gray-200 px-3 py-2 text-sm disabled:opacity-50 hover:bg-gray-50"
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            Prev
          </button>
          <button
            className="rounded-xl border border-gray-200 px-3 py-2 text-sm disabled:opacity-50 hover:bg-gray-50"
            disabled={!hasMore}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}

function FilterPill({ active, children, onClick }: { active: boolean; children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      className={
        active
          ? 'rounded-xl bg-gray-900 text-white px-3 py-2 text-sm'
          : 'rounded-xl border border-gray-200 px-3 py-2 text-sm hover:bg-gray-50'
      }
      onClick={onClick}
    >
      {children}
    </button>
  );
}
