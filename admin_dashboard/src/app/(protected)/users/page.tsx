import { redirect } from 'next/navigation';
import { getAdminContext } from '@/lib/auth/guards';
import { listUsers } from '@/lib/admin/users';
import { grantAdminAction, revokeAdminAction } from './actions';

export default async function UsersPage({
  searchParams,
}: {
  searchParams?: { q?: string; offset?: string };
}) {
  const ctx = await getAdminContext();
  if (!ctx.can('users.read')) {
    redirect('/forbidden?permission=users.read');
  }

  const q = (searchParams?.q ?? '').trim();
  const offset = Math.max(0, Number(searchParams?.offset ?? 0) || 0);
  const canManageAccess = ctx.can('admin_access.manage');

  const res = await listUsers(ctx.supabase, { q, offset, limit: 25 });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold">Users</h1>
        <form className="flex gap-2" action="/users" method="get">
          <input
            name="q"
            defaultValue={q}
            placeholder="Search name / phone"
            className="rounded-md border px-3 py-2 text-sm bg-white"
          />
          <button className="rounded-md bg-neutral-900 text-white px-3 py-2 text-sm hover:bg-neutral-800">
            Search
          </button>
        </form>
      </div>

      <div className="rounded-xl border bg-white overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 border-b">
            <tr>
              <th className="text-left px-4 py-2 font-medium">Name</th>
              <th className="text-left px-4 py-2 font-medium">Phone</th>
              <th className="text-left px-4 py-2 font-medium">Role</th>
              <th className="text-left px-4 py-2 font-medium">Admin</th>
              <th className="text-left px-4 py-2 font-medium">Admin access</th>
              <th className="text-left px-4 py-2 font-medium">Created</th>
            </tr>
          </thead>
          <tbody>
            {res.users.map((u) => (
              <tr key={u.id} className="border-b last:border-b-0">
                <td className="px-4 py-2">{u.display_name ?? '—'}</td>
                <td className="px-4 py-2">{u.phone ?? '—'}</td>
                <td className="px-4 py-2">{u.active_role ?? '—'}</td>
                <td className="px-4 py-2">{u.is_admin ? 'Yes' : 'No'}</td>
                <td className="px-4 py-2">
                  {!canManageAccess ? (
                    <span className="text-xs text-neutral-500">Insufficient privileges</span>
                  ) : u.is_admin ? (
                    <form action={revokeAdminAction} className="flex items-center gap-2">
                      <input type="hidden" name="userId" value={u.id} />
                      <input
                        name="note"
                        placeholder="reason"
                        required
                        minLength={3}
                        maxLength={500}
                        className="rounded-md border px-2 py-1 text-xs"
                      />
                      <label className="flex items-center gap-1 text-xs text-neutral-600">
                        <input type="checkbox" name="confirm" required />
                        confirm
                      </label>
                      <button className="rounded-md border px-2 py-1 text-xs hover:bg-neutral-50">
                        Revoke
                      </button>
                    </form>
                  ) : (
                    <form action={grantAdminAction} className="flex items-center gap-2">
                      <input type="hidden" name="userId" value={u.id} />
                      <input
                        name="note"
                        placeholder="reason"
                        required
                        minLength={3}
                        maxLength={500}
                        className="rounded-md border px-2 py-1 text-xs"
                      />
                      <label className="flex items-center gap-1 text-xs text-neutral-600">
                        <input type="checkbox" name="confirm" required />
                        confirm
                      </label>
                      <button className="rounded-md border px-2 py-1 text-xs hover:bg-neutral-50">
                        Grant
                      </button>
                    </form>
                  )}
                </td>
                <td className="px-4 py-2">
                  {u.created_at ? new Date(u.created_at).toLocaleString() : '—'}
                </td>
              </tr>
            ))}
            {res.users.length === 0 && (
              <tr>
                <td className="px-4 py-6 text-sm text-neutral-500" colSpan={6}>
                  No users.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-xs text-neutral-500">
        <div>
          Showing {res.page.returned} users (offset {res.page.offset})
        </div>
        <div className="flex gap-2">
          <a
            className="rounded-md border bg-white px-2 py-1 hover:bg-neutral-50"
            href={`/users?q=${encodeURIComponent(q)}&offset=${Math.max(0, offset - 25)}`}
          >
            Prev
          </a>
          <a
            className="rounded-md border bg-white px-2 py-1 hover:bg-neutral-50"
            href={`/users?q=${encodeURIComponent(q)}&offset=${offset + 25}`}
          >
            Next
          </a>
        </div>
      </div>
    </div>
  );
}
