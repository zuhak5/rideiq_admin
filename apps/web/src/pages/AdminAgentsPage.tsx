import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabaseClient';
import { getIsAdmin } from '../lib/admin';
import { errorText } from '../lib/errors';
import AdminNav from '../components/AdminNav';

type CashAgentRow = {
  id: string;
  code: string;
  name: string;
  location: string | null;
  is_active: boolean;
  created_at: string;
};

function fmtTime(ts: string | null | undefined): string {
  if (!ts) return '—';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString();
}

async function fetchAgents(activeOnly: boolean): Promise<CashAgentRow[]> {
  const { data, error } = await supabase.rpc('admin_cash_agent_list_v1', {
    p_active_only: activeOnly,
  });
  if (error) throw error;
  return (Array.isArray(data) ? data : []) as CashAgentRow[];
}

export default function AdminAgentsPage() {
  const qc = useQueryClient();

  const isAdminQ = useQuery<boolean, Error>({
    queryKey: ['admin_is_admin'],
    queryFn: () => getIsAdmin(),
    staleTime: 60_000,
  });

  const isAdmin = isAdminQ.data === true;

  const [activeOnly, setActiveOnly] = React.useState(true);

  const agentsQ = useQuery<CashAgentRow[], Error>({
    queryKey: ['admin_cash_agents', activeOnly],
    queryFn: () => fetchAgents(activeOnly),
    enabled: isAdmin,
    staleTime: 10_000,
  });

  const createMut = useMutation({
    mutationFn: async (args: { code: string; name: string; location: string }) => {
      const { error } = await supabase.rpc('admin_cash_agent_create_v1', {
        p_code: args.code,
        p_name: args.name,
        p_location: args.location || null,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['admin_cash_agents'] });
    },
  });

  const toggleMut = useMutation({
    mutationFn: async (args: { agentId: string; active: boolean }) => {
      const { error } = await supabase.rpc('admin_cash_agent_set_active_v1', {
        p_agent_id: args.agentId,
        p_is_active: args.active,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['admin_cash_agents'] });
    },
  });

  const [createOpen, setCreateOpen] = React.useState(false);
  const [code, setCode] = React.useState('');
  const [name, setName] = React.useState('');
  const [location, setLocation] = React.useState('');

  const resetCreate = () => {
    setCode('');
    setName('');
    setLocation('');
  };

  const submitCreate = async () => {
    await createMut.mutateAsync({ code: code.trim(), name: name.trim(), location: location.trim() });
    setCreateOpen(false);
    resetCreate();
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

  const agents = agentsQ.data ?? [];

  return (
    <div className="min-h-screen bg-gray-50">
      <AdminNav />
      <div className="max-w-5xl mx-auto p-6 space-y-6">
        <div className="bg-white rounded-xl shadow p-6">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <div className="text-xl font-semibold">Cash agents</div>
              <div className="text-sm text-gray-600 mt-2">
                Agents are cash collection / payout points. They produce sequential receipt numbers and daily cashbox reconciliation.
              </div>
            </div>
            <div className="flex gap-2">
              <button className="btn" type="button" onClick={() => setCreateOpen(true)}>New agent</button>
              <button className="btn" type="button" onClick={() => void agentsQ.refetch()}>Refresh</button>
            </div>
          </div>

          <div className="mt-4 flex items-center gap-2 text-sm">
            <input
              id="activeOnly"
              type="checkbox"
              checked={activeOnly}
              onChange={(e) => setActiveOnly(e.target.checked)}
            />
            <label htmlFor="activeOnly" className="text-gray-700">Show active only</label>
          </div>

          {agentsQ.isLoading ? <div className="mt-4 text-sm text-gray-500">Loading…</div> : null}
          {agentsQ.error ? <div className="mt-4 text-sm text-red-700">{errorText(agentsQ.error)}</div> : null}

          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500">
                  <th className="py-2 pr-4">Code</th>
                  <th className="py-2 pr-4">Name</th>
                  <th className="py-2 pr-4">Location</th>
                  <th className="py-2 pr-4">Active</th>
                  <th className="py-2 pr-4">Created</th>
                  <th className="py-2 pr-4">Actions</th>
                </tr>
              </thead>
              <tbody>
                {agents.map((a) => (
                  <tr key={a.id} className="border-t border-gray-100">
                    <td className="py-2 pr-4 font-semibold">{a.code}</td>
                    <td className="py-2 pr-4">{a.name}</td>
                    <td className="py-2 pr-4">{a.location || '—'}</td>
                    <td className="py-2 pr-4">{a.is_active ? 'Yes' : 'No'}</td>
                    <td className="py-2 pr-4">{fmtTime(a.created_at)}</td>
                    <td className="py-2 pr-4">
                      <button
                        className="btn"
                        type="button"
                        disabled={toggleMut.isPending}
                        onClick={() => toggleMut.mutate({ agentId: a.id, active: !a.is_active })}
                      >
                        {a.is_active ? 'Deactivate' : 'Activate'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {createOpen ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl border border-gray-200">
              <div className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-base font-semibold">Create agent</div>
                    <div className="mt-1 text-xs text-gray-500">Code should be short (2–10 chars), e.g. BAG1, BASRA.</div>
                  </div>
                  <button className="btn" type="button" onClick={() => { setCreateOpen(false); resetCreate(); }}>
                    Close
                  </button>
                </div>

                <div className="mt-4 grid grid-cols-1 gap-4">
                  <div>
                    <label className="text-xs text-gray-600">Code</label>
                    <input className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm" value={code} onChange={(e) => setCode(e.target.value)} placeholder="BAG1" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-600">Name</label>
                    <input className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm" value={name} onChange={(e) => setName(e.target.value)} placeholder="Baghdad office" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-600">Location (optional)</label>
                    <input className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Karrada" />
                  </div>
                </div>

                {createMut.error ? <div className="mt-3 text-sm text-red-700">{errorText(createMut.error)}</div> : null}

                <div className="mt-5 flex justify-end gap-2">
                  <button className="btn" type="button" onClick={() => { setCreateOpen(false); resetCreate(); }} disabled={createMut.isPending}>Cancel</button>
                  <button className="btn" type="button" onClick={submitCreate} disabled={createMut.isPending || !code.trim() || !name.trim()}>
                    {createMut.isPending ? 'Saving…' : 'Create'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
