import { redirect } from 'next/navigation';
import { getAdminContext } from '@/lib/auth/guards';
import { getRideDetail } from '@/lib/admin/rides';
import Link from 'next/link';
import { cancelRideAction } from './actions';

function kv(label: string, value: any) {
  return (
    <div className="flex justify-between gap-4">
      <div className="text-xs text-neutral-500">{label}</div>
      <div className="text-xs text-neutral-900 text-right break-all">{value ?? '—'}</div>
    </div>
  );
}

export default async function RideDetailPage({ params }: { params: { id: string } }) {
  const ctx = await getAdminContext();
  if (!ctx.can('rides.read')) {
    redirect('/forbidden?permission=rides.read');
  }

  const { ride, ride_events, app_events } = await getRideDetail(ctx.supabase, params.id);
  const canCancel = ctx.can('rides.cancel');

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-xl font-semibold">Ride</h1>
          <Link className="text-sm underline hover:no-underline" href="/rides">
            Back
          </Link>
        </div>
        <div className="text-xs text-neutral-500 break-all">{ride.id}</div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="rounded-xl border bg-white p-4 space-y-2">
          <div className="text-sm font-medium">Status</div>
          {kv('status', ride.status)}
          {kv('version', ride.version)}
          {kv('created', ride.created_at ? new Date(ride.created_at).toLocaleString() : null)}
          {kv('updated', ride.updated_at ? new Date(ride.updated_at).toLocaleString() : null)}
          {kv('started', ride.started_at ? new Date(ride.started_at).toLocaleString() : null)}
          {kv('completed', ride.completed_at ? new Date(ride.completed_at).toLocaleString() : null)}
        </div>

        <div className="rounded-xl border bg-white p-4 space-y-2">
          <div className="text-sm font-medium">Trip</div>
          {kv('pickup', ride.request?.pickup_address)}
          {kv('dropoff', ride.request?.dropoff_address)}
          {kv('product', ride.product_code ?? ride.request?.product_code)}
          {kv('pickup pin required', String(!!ride.pickup_pin_required))}
          {kv('pickup pin verified', ride.pickup_pin_verified_at ? new Date(ride.pickup_pin_verified_at).toLocaleString() : null)}
        </div>

        <div className="rounded-xl border bg-white p-4 space-y-2">
          <div className="text-sm font-medium">Payment</div>
          {kv('payment method', ride.payment_method ?? ride.request?.payment_method)}
          {kv('payment status', ride.payment_status ?? ride.request?.payment_status)}
          {kv('fare (IQD)', ride.fare_amount_iqd)}
          {kv('platform fee (IQD)', ride.platform_fee_iqd)}
          {kv('cash expected (IQD)', ride.cash_expected_amount_iqd)}
          {kv('cash collected (IQD)', ride.cash_collected_amount_iqd)}
          {kv('cash change (IQD)', ride.cash_change_given_iqd)}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-xl border bg-white p-4 space-y-2">
          <div className="text-sm font-medium">Rider</div>
          {kv('name', ride.rider?.display_name)}
          {kv('phone', ride.rider?.phone)}
          {kv('id', ride.rider?.id)}
        </div>
        <div className="rounded-xl border bg-white p-4 space-y-2">
          <div className="text-sm font-medium">Driver</div>
          {kv('name', ride.driver?.profile?.display_name)}
          {kv('phone', ride.driver?.profile?.phone)}
          {kv('driver id', ride.driver?.id)}
          {ride.driver?.id ? (
            <div className="text-xs">
              <a className="underline hover:no-underline" href={`/drivers/${ride.driver.id}`}>
                Open driver
              </a>
            </div>
          ) : null}
        </div>
      </div>

      {canCancel ? (
        <div className="rounded-xl border bg-white p-4 space-y-3">
          <div className="text-sm font-medium">Actions</div>
          <form action={cancelRideAction} className="flex flex-col sm:flex-row sm:items-end gap-2">
            <input type="hidden" name="rideId" value={ride.id} />
            <input type="hidden" name="expectedVersion" value={String(ride.version)} />
            <div className="flex-1">
              <label className="text-xs text-neutral-500">Cancel reason</label>
              <input
                name="reason"
                required
                minLength={3}
                maxLength={500}
                placeholder="Reason"
                className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
              />
            </div>
            <label className="flex items-center gap-2 text-xs text-neutral-600">
              <input type="checkbox" name="confirm" required />
              confirm cancel
            </label>
            <button className="rounded-md border px-3 py-2 text-sm hover:bg-neutral-50">Cancel ride</button>
          </form>
          <div className="text-xs text-neutral-500">
            Cancels are rate-limited and audited.
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-xl border bg-white p-4">
          <div className="text-sm font-medium mb-3">Ride events</div>
          <div className="space-y-2">
            {ride_events.map((e: any) => (
              <div key={e.id} className="border rounded-lg p-2">
                <div className="flex items-center justify-between text-xs">
                  <div className="font-medium">{e.event_type}</div>
                  <div className="text-neutral-500">{e.created_at ? new Date(e.created_at).toLocaleString() : '—'}</div>
                </div>
                <div className="text-xs text-neutral-500 break-all">actor: {e.actor_type} {e.actor_id ?? '—'}</div>
              </div>
            ))}
            {ride_events.length === 0 ? <div className="text-xs text-neutral-500">No ride events.</div> : null}
          </div>
        </div>

        <div className="rounded-xl border bg-white p-4">
          <div className="text-sm font-medium mb-3">App events</div>
          <div className="space-y-2">
            {app_events.map((e: any) => (
              <div key={e.id} className="border rounded-lg p-2">
                <div className="flex items-center justify-between text-xs">
                  <div className="font-medium">{e.event_type}</div>
                  <div className="text-neutral-500">{e.created_at ? new Date(e.created_at).toLocaleString() : '—'}</div>
                </div>
                <div className="text-xs text-neutral-500">level: {e.level}</div>
              </div>
            ))}
            {app_events.length === 0 ? <div className="text-xs text-neutral-500">No app events.</div> : null}
          </div>
        </div>
      </div>
    </div>
  );
}
