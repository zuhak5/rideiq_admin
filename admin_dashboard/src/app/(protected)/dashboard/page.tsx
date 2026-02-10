import { requirePermission } from '@/lib/auth/guards';
import { getAdminDashboardSummary } from '@/lib/admin/summary';
import { StatCard } from '@/components/ui/StatCard';

export default async function DashboardPage() {
  const { user, supabase } = await requirePermission('dashboard.view');

  const summary = await (async () => {
    try {
      return await getAdminDashboardSummary(supabase);
    } catch {
      return null;
    }
  })();

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Dashboard</h1>
      <div className="rounded-xl border bg-white p-4">
        <div className="text-sm text-neutral-600">Signed in as</div>
        <div className="mt-1 text-sm font-medium">{user.email}</div>
      </div>

      {summary ? (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <StatCard label="Users" value={summary.counts.users_total} href="/users" />
            <StatCard label="Admins" value={summary.counts.admins_total} href="/users?q=" />
            <StatCard
              label="Active rides"
              value={summary.counts.rides_active}
              subtitle={`Rides last 24h: ${summary.counts.rides_last_24h}`}
              href="/rides"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <StatCard
              label="Open fraud cases"
              value={summary.counts.fraud_cases_open}
              href="/fraud?tab=cases&status=open"
              tone={summary.counts.fraud_cases_open > 0 ? 'warn' : 'default'}
            />
            <StatCard
              label="Active fraud actions"
              value={summary.counts.fraud_actions_active}
              href="/fraud?tab=actions&status=active"
              tone={summary.counts.fraud_actions_active > 0 ? 'warn' : 'default'}
            />
            <StatCard
              label="Active ops alerts"
              value={summary.counts.ops_alerts_active}
              href="/ops"
              tone={summary.counts.ops_alerts_active > 0 ? 'danger' : 'default'}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <StatCard
              label="Payout jobs queued"
              value={summary.counts.payout_jobs_queued}
              href="/ops"
              tone={summary.counts.payout_jobs_queued > 0 ? 'warn' : 'default'}
            />
            <StatCard
              label="Payout jobs failed"
              value={summary.counts.payout_jobs_failed}
              href="/ops"
              tone={summary.counts.payout_jobs_failed > 0 ? 'danger' : 'default'}
            />
          </div>

          <div className="text-xs text-neutral-500">
            Summary generated {new Date(summary.generated_at).toLocaleString()}.
          </div>
        </>
      ) : (
        <div className="rounded-xl border bg-white p-4">
          <div className="text-sm font-medium">Summary unavailable</div>
          <div className="mt-1 text-sm text-neutral-600">
            Deploy the <code className="rounded bg-neutral-100 px-1">admin-dashboard-summary</code> Edge Function,
            then refresh.
          </div>
        </div>
      )}
    </div>
  );
}
