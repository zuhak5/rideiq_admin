import { redirect } from 'next/navigation';
import { getAdminContext } from '@/lib/auth/guards';
import { getDriverDetail } from '@/lib/admin/drivers';
import Link from 'next/link';
import { transitionDriverAction } from './actions';

function kv(label: string, value: any) {
  return (
    <div className="flex justify-between gap-4">
      <div className="text-xs text-neutral-500">{label}</div>
      <div className="text-xs text-neutral-900 text-right break-all">{value ?? '—'}</div>
    </div>
  );
}

export default async function DriverDetailPage({ params }: { params: { id: string } }) {
  const ctx = await getAdminContext();
  if (!ctx.can('drivers.read')) {
    redirect('/forbidden?permission=drivers.read');
  }

  const { driver, last_location, status_events, active_rides } = await getDriverDetail(ctx.supabase, params.id);
  const canSuspend = ctx.can('drivers.suspend') || ctx.can('drivers.manage');

  const isSuspended = driver.status === 'suspended';
  const nextStatus = isSuspended ? 'available' : 'suspended';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Driver</h1>
          <div className="text-xs text-neutral-500 break-all">{driver.id}</div>
        </div>
        <Link className="text-sm underline hover:no-underline" href="/drivers">
          Back
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="rounded-xl border bg-white p-4 space-y-2">
          <div className="text-sm font-medium">Profile</div>
          {kv('status', driver.status)}
          {kv('name', driver.profile?.display_name)}
          {kv('phone', driver.profile?.phone)}
          {kv('vehicle type', driver.vehicle_type)}
          {kv('trips', driver.trips_count)}
          {kv('rating avg', driver.rating_avg)}
          {kv('rating count', driver.rating_count)}
        </div>

        <div className="rounded-xl border bg-white p-4 space-y-2">
          <div className="text-sm font-medium">Cash</div>
          {kv('enabled', String(!!driver.cash_enabled))}
          {kv('exposure limit (IQD)', driver.cash_exposure_limit_iqd)}
          {kv('reserved (IQD)', driver.cash_reserved_amount_iqd)}
          {kv('pickup pin required', String(!!driver.require_pickup_pin))}
        </div>

        <div className="rounded-xl border bg-white p-4 space-y-2">
          <div className="text-sm font-medium">Last location</div>
          {kv('lat', last_location?.lat)}
          {kv('lng', last_location?.lng)}
          {kv('heading', last_location?.heading)}
          {kv('speed m/s', last_location?.speed_mps)}
          {kv('accuracy m', last_location?.accuracy_m)}
          {kv('updated', last_location?.updated_at ? new Date(last_location.updated_at).toLocaleString() : null)}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-xl border bg-white p-4">
          <div className="text-sm font-medium mb-2">Vehicles</div>
          <div className="space-y-2">
            {(driver.vehicles ?? []).map((v: any) => (
              <div key={v.id} className="border rounded-lg p-2">
                <div className="text-xs font-medium">
                  {v.make ?? ''} {v.model ?? ''} ({v.vehicle_type})
                </div>
                <div className="text-xs text-neutral-500">
                  {v.color ?? '—'} • {v.plate_number ?? '—'} • active: {String(!!v.is_active)}
                </div>
              </div>
            ))}
            {(!driver.vehicles || driver.vehicles.length === 0) && (
              <div className="text-xs text-neutral-500">No vehicles.</div>
            )}
          </div>
        </div>

        <div className="rounded-xl border bg-white p-4">
          <div className="text-sm font-medium mb-2">Active rides</div>
          <div className="space-y-2">
            {active_rides.map((r: any) => (
              <div key={r.id} className="border rounded-lg p-2">
                <div className="flex items-center justify-between text-xs">
                  <a className="underline hover:no-underline" href={`/rides/${r.id}`}>
                    {r.id.slice(0, 8)}…
                  </a>
                  <div className="text-neutral-500">{r.status}</div>
                </div>
                <div className="text-xs text-neutral-500 line-clamp-1">{r.request?.pickup_address ?? '—'}</div>
                <div className="text-xs text-neutral-500 line-clamp-1">{r.request?.dropoff_address ?? '—'}</div>
              </div>
            ))}
            {active_rides.length === 0 ? <div className="text-xs text-neutral-500">No active rides.</div> : null}
          </div>
        </div>
      </div>

      {canSuspend ? (
        <div className="rounded-xl border bg-white p-4 space-y-3">
          <div className="text-sm font-medium">Actions</div>
          <form action={transitionDriverAction} className="flex flex-col sm:flex-row sm:items-end gap-2">
            <input type="hidden" name="driverId" value={driver.id} />
            <input type="hidden" name="toStatus" value={nextStatus} />
            <div className="flex-1">
              <label className="text-xs text-neutral-500">Reason</label>
              <input
                name="reason"
                required
                minLength={3}
                maxLength={500}
                placeholder={isSuspended ? 'Unsuspend reason' : 'Suspend reason'}
                className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
              />
            </div>
            <label className="flex items-center gap-2 text-xs text-neutral-600">
              <input type="checkbox" name="confirm" required />
              confirm
            </label>
            <button className="rounded-md border px-3 py-2 text-sm hover:bg-neutral-50">
              {isSuspended ? 'Unsuspend' : 'Suspend'} driver
            </button>
          </form>
          <div className="text-xs text-neutral-500">Transitions are rate-limited and audited.</div>
        </div>
      ) : null}

      <div className="rounded-xl border bg-white p-4">
        <div className="text-sm font-medium mb-3">Status history</div>
        <div className="space-y-2">
          {status_events.map((e: any) => (
            <div key={e.id} className="border rounded-lg p-2">
              <div className="flex items-center justify-between text-xs">
                <div className="font-medium">
                  {e.from_status} → {e.to_status}
                </div>
                <div className="text-neutral-500">{e.created_at ? new Date(e.created_at).toLocaleString() : '—'}</div>
              </div>
              {e.reason ? <div className="text-xs text-neutral-500">{e.reason}</div> : null}
            </div>
          ))}
          {status_events.length === 0 ? <div className="text-xs text-neutral-500">No status events.</div> : null}
        </div>
      </div>
    </div>
  );
}
