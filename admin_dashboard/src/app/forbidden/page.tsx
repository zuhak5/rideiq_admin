export default function ForbiddenPage({
  searchParams,
}: {
  searchParams?: { permission?: string };
}) {
  const permission = (searchParams?.permission ?? '').trim();

  return (
    <main className="min-h-screen flex items-center justify-center bg-neutral-50 p-6">
      <div className="max-w-md w-full rounded-xl border bg-white p-6">
        <h1 className="text-lg font-semibold">403 — Forbidden</h1>
        <p className="mt-2 text-sm text-neutral-600">
          Your account is authenticated but does not have sufficient privileges.
        </p>
        {permission ? (
          <p className="mt-3 text-sm">
            Required permission: <code className="rounded bg-neutral-100 px-1">{permission}</code>
          </p>
        ) : (
          <p className="mt-3 text-sm">
            This area requires admin access.
          </p>
        )}
        <p className="mt-4 text-xs text-neutral-500">
          If this is unexpected, grant the appropriate admin role (or add the user to <code>admin_users</code> as a
          fallback).
        </p>
      </div>
    </main>
  );
}
