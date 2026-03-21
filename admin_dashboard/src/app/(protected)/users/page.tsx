import { redirect } from 'next/navigation';
import { getAdminContext } from '@/lib/auth/guards';
import { listUsers } from '@/lib/admin/users';

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
  const canManageNotifications = ctx.can('notifications.manage');

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
            className="rounded-md border bg-white px-3 py-2 text-sm"
          />
          <button className="rounded-md bg-neutral-900 px-3 py-2 text-sm text-white hover:bg-neutral-800">
            Search
          </button>
        </form>
      </div>

      <div className="overflow-hidden rounded-xl border bg-white">
        <table className="w-full text-sm">
          <thead className="border-b bg-neutral-50">
            <tr>
              <th className="px-4 py-2 text-left font-medium">Name</th>
              <th className="px-4 py-2 text-left font-medium">Phone</th>
              <th className="px-4 py-2 text-left font-medium">Role</th>
              <th className="px-4 py-2 text-left font-medium">Admin</th>
              <th className="px-4 py-2 text-left font-medium">Admin access</th>
              <th className="px-4 py-2 text-left font-medium">Actions</th>
              <th className="px-4 py-2 text-left font-medium">Created</th>
            </tr>
          </thead>
          <tbody>
            {res.users.map((u) => (
              <tr key={u.id} className="border-b last:border-b-0">
                <td className="px-4 py-2">{u.display_name ?? '-'}</td>
                <td className="px-4 py-2">{u.phone ?? '-'}</td>
                <td className="px-4 py-2">{u.active_role ?? '-'}</td>
                <td className="px-4 py-2">{u.is_admin ? 'Yes' : 'No'}</td>
                <td className="px-4 py-2">
                  <div className="space-y-2">
                    <div className="flex flex-wrap gap-1">
                      {u.role_keys.length ? (
                        u.role_keys.map((roleKey) => (
                          <span key={roleKey} className="rounded-md border bg-white px-2 py-0.5 text-xs">
                            {roleKey}
                          </span>
                        ))
                      ) : (
                        <span className="text-xs text-neutral-500">No admin roles assigned</span>
                      )}
                    </div>
                    {!canManageAccess ? (
                      <span className="text-xs text-neutral-500">Insufficient privileges</span>
                    ) : (
                      <a
                        className="inline-flex rounded-md border px-2 py-1 text-xs hover:bg-neutral-50"
                        href={`/admin-access?q=${encodeURIComponent(u.id)}`}
                      >
                        {u.is_admin ? 'Manage roles' : 'Grant roles'}
                      </a>
                    )}
                  </div>
                </td>
                <td className="px-4 py-2">
                  <div className="flex flex-wrap gap-2">
                    {canManageNotifications ? (
                      <a
                        className="rounded-md border px-2 py-1 text-xs hover:bg-neutral-50"
                        href={`/notifications?include_user_id=${encodeURIComponent(u.id)}`}
                      >
                        Send notification
                      </a>
                    ) : (
                      <span className="text-xs text-neutral-500">-</span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-2">{u.created_at ? new Date(u.created_at).toLocaleString() : '-'}</td>
              </tr>
            ))}
            {res.users.length === 0 && (
              <tr>
                <td className="px-4 py-6 text-sm text-neutral-500" colSpan={7}>
                  No users.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-xs text-neutral-500">
        <div>Showing {res.page.returned} users (offset {res.page.offset})</div>
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
