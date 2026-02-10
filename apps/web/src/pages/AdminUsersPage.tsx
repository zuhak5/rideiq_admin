import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import AdminNav from '../components/AdminNav';
import { getIsAdmin } from '../lib/admin';
import { invokeEdge } from '../lib/edgeInvoke';
import { errorText } from '../lib/errors';
import { supabase } from '../lib/supabaseClient';

type UserRow = {
  id: string;
  display_name: string | null;
  phone: string | null;
  active_role: string | null;
  locale: string | null;
  created_at: string | null;
  is_admin: boolean;
};

type ListResp = {
  users: UserRow[];
  page: {
    limit: number;
    offset: number;
    returned: number;
  };
};

type AuditRow = {
  id: number;
  created_at: string;
  actor_id: string;
  action: 'grant_admin' | 'revoke_admin';
  target_user_id: string;
  note: string | null;
};

function Badge({ children }: { children: React.ReactNode }) {
  return <span className="inline-flex items-center rounded-xl bg-gray-900 px-2 py-1 text-xs text-white">{children}</span>;
}

export default function AdminUsersPage() {
  const qc = useQueryClient();
  const adminQ = useQuery({ queryKey: ['is_admin'], queryFn: getIsAdmin });

  const [q, setQ] = React.useState('');
  const [limit, setLimit] = React.useState(25);
  const [offset, setOffset] = React.useState(0);

  const listQ = useQuery({
    queryKey: ['admin_users_list', { q, limit, offset }],
    enabled: adminQ.data === true,
    queryFn: async () => {
      const { data } = await invokeEdge<ListResp>('admin-users-list', { q, limit, offset });
      return data;
    },
  });

  const auditQ = useQuery({
    queryKey: ['admin_audit_log'],
    enabled: adminQ.data === true,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('admin_audit_log')
        .select('id,created_at,actor_id,action,target_user_id,note')
        .order('id', { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as AuditRow[];
    },
    refetchInterval: 30000,
  });

  const grantM = useMutation({
    mutationFn: async (args: { userId: string; note?: string }) => {
      const { data, error } = await supabase.rpc('admin_grant_user_v1', { p_user: args.userId, p_note: args.note ?? null });
      if (error) throw error;
      const res = data as any;
      if (res?.ok === false) throw new Error(String(res.error ?? 'Failed to grant admin'));
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['admin_users_list'] }),
        qc.invalidateQueries({ queryKey: ['admin_audit_log'] }),
      ]);
    },
  });

  const revokeM = useMutation({
    mutationFn: async (args: { userId: string; note?: string }) => {
      const { data, error } = await supabase.rpc('admin_revoke_user_v1', { p_user: args.userId, p_note: args.note ?? null });
      if (error) throw error;
      const res = data as any;
      if (res?.ok === false) throw new Error(String(res.error ?? 'Failed to revoke admin'));
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['admin_users_list'] }),
        qc.invalidateQueries({ queryKey: ['admin_audit_log'] }),
      ]);
    },
  });

  const users = listQ.data?.users ?? [];
  const listErr = listQ.error ? errorText(listQ.error) : null;
  const auditErr = auditQ.error ? errorText(auditQ.error) : null;

  return (
    <div className="space-y-4">
      <AdminNav />

      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="text-lg font-semibold">Admin Users</div>
            <div className="text-xs text-gray-500">Grant or revoke admin access. All changes are audited.</div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <input
              className="w-64 rounded-xl border border-gray-200 px-3 py-2 text-sm"
              placeholder="Search name or phone…"
              value={q}
              onChange={(e) => {
                setOffset(0);
                setQ(e.target.value);
              }}
            />
            <label className="text-xs text-gray-600">
              Limit
              <input
                className="ml-2 w-20 rounded-xl border border-gray-200 px-2 py-1 text-sm"
                value={limit}
                onChange={(e) => setLimit(Math.max(5, Math.min(100, Number(e.target.value) || 25)))}
                type="number"
                min={5}
                max={100}
              />
            </label>
            <button
              className="rounded-xl bg-gray-900 px-3 py-2 text-sm text-white disabled:opacity-60"
              type="button"
              onClick={() => void listQ.refetch()}
              disabled={listQ.isFetching}
            >
              {listQ.isFetching ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        </div>

        {adminQ.isLoading ? <div className="mt-3 text-sm text-gray-600">Checking admin…</div> : null}
        {adminQ.data === false ? <div className="mt-3 text-sm text-red-700">Admin access required.</div> : null}
        {listErr ? <div className="mt-3 text-sm text-red-700">{listErr}</div> : null}

        <div className="mt-3 overflow-auto rounded-xl border border-gray-200">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-600">
              <tr>
                <th className="px-3 py-2 text-left font-medium">User</th>
                <th className="px-3 py-2 text-left font-medium">Phone</th>
                <th className="px-3 py-2 text-left font-medium">Role</th>
                <th className="px-3 py-2 text-left font-medium">Locale</th>
                <th className="px-3 py-2 text-left font-medium">Created</th>
                <th className="px-3 py-2 text-left font-medium">Access</th>
                <th className="px-3 py-2 text-right font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {users.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-sm text-gray-600">No users found.</td>
                </tr>
              ) : (
                users.map((u, idx) => (
                  <tr key={u.id} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className="px-3 py-2">
                      <div className="font-semibold">{u.display_name ?? '—'}</div>
                      <div className="text-xs text-gray-500 font-mono">{u.id}</div>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{u.phone ?? '—'}</td>
                    <td className="px-3 py-2">{u.active_role ?? '—'}</td>
                    <td className="px-3 py-2">{u.locale ?? '—'}</td>
                    <td className="px-3 py-2 text-xs text-gray-600">
                      {u.created_at ? new Date(u.created_at).toLocaleString() : '—'}
                    </td>
                    <td className="px-3 py-2">{u.is_admin ? <Badge>Admin</Badge> : <span className="text-gray-500">User</span>}</td>
                    <td className="px-3 py-2 text-right">
                      {u.is_admin ? (
                        <button
                          className="rounded-xl border border-gray-200 px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-60"
                          disabled={revokeM.isPending}
                          type="button"
                          onClick={() => {
                            const note = prompt('Optional note for audit log (revoke):') ?? undefined;
                            revokeM.mutate({ userId: u.id, note });
                          }}
                        >
                          {revokeM.isPending ? 'Working…' : 'Revoke'}
                        </button>
                      ) : (
                        <button
                          className="rounded-xl bg-gray-900 px-3 py-2 text-sm text-white disabled:opacity-60"
                          disabled={grantM.isPending}
                          type="button"
                          onClick={() => {
                            const note = prompt('Optional note for audit log (grant):') ?? undefined;
                            grantM.mutate({ userId: u.id, note });
                          }}
                        >
                          {grantM.isPending ? 'Working…' : 'Grant'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-3 flex items-center justify-between">
          <button
            type="button"
            className="btn"
            disabled={offset <= 0}
            onClick={() => setOffset(Math.max(0, offset - limit))}
          >
            Prev
          </button>
          <div className="text-xs text-gray-500">Offset: {offset}</div>
          <button
            type="button"
            className="btn"
            disabled={(listQ.data?.page.returned ?? 0) < limit}
            onClick={() => setOffset(offset + limit)}
          >
            Next
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="text-sm font-semibold">Recent admin changes</div>
            <div className="text-xs text-gray-500">Last 50 grant/revoke operations.</div>
          </div>
          <button
            type="button"
            className="rounded-xl border border-gray-200 px-3 py-2 text-sm hover:bg-gray-50"
            onClick={() => void auditQ.refetch()}
            disabled={auditQ.isFetching}
          >
            {auditQ.isFetching ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
        {auditErr ? <div className="mt-3 text-sm text-red-700">{auditErr}</div> : null}

        <div className="mt-3 overflow-auto rounded-xl border border-gray-200">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-600">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Time</th>
                <th className="px-3 py-2 text-left font-medium">Action</th>
                <th className="px-3 py-2 text-left font-medium">Actor</th>
                <th className="px-3 py-2 text-left font-medium">Target</th>
                <th className="px-3 py-2 text-left font-medium">Note</th>
              </tr>
            </thead>
            <tbody>
              {(auditQ.data ?? []).length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-sm text-gray-600">No audit entries yet.</td>
                </tr>
              ) : (
                (auditQ.data ?? []).map((a, idx) => (
                  <tr key={a.id} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className="px-3 py-2 text-xs text-gray-600 whitespace-nowrap">
                      {new Date(a.created_at).toLocaleString()}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{a.action}</td>
                    <td className="px-3 py-2 font-mono text-xs">{a.actor_id}</td>
                    <td className="px-3 py-2 font-mono text-xs">{a.target_user_id}</td>
                    <td className="px-3 py-2 text-xs">{a.note ?? '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
