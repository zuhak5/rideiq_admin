import { redirect } from 'next/navigation';
import { getAdminContext } from '@/lib/auth/guards';
import { getPaymentDetail } from '@/lib/admin/payments';
import Link from 'next/link';
import { refundPaymentAction } from './actions';

function kv(label: string, value: any) {
  return (
    <div className="flex justify-between gap-4">
      <div className="text-xs text-neutral-500">{label}</div>
      <div className="text-xs text-neutral-900 text-right break-all">{value ?? '—'}</div>
    </div>
  );
}

export default async function PaymentDetailPage({ params }: { params: { id: string } }) {
  const ctx = await getAdminContext();
  if (!ctx.can('payments.read')) {
    redirect('/forbidden?permission=payments.read');
  }

  const { payment, ride, receipt, payment_intent } = await getPaymentDetail(ctx.supabase, params.id);
  const canRefund = ctx.can('payments.refund');

  const currentRefunded = Number(payment?.refund_amount_iqd ?? 0) || 0;
  const totalAmount = Number(payment?.amount_iqd ?? 0) || 0;
  const remaining = Math.max(0, totalAmount - currentRefunded);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-xl font-semibold">Payment</h1>
          <Link className="text-sm underline hover:no-underline" href="/payments">
            Back
          </Link>
        </div>
        <div className="text-xs text-neutral-500 break-all">{payment?.id}</div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="rounded-xl border bg-white p-4 space-y-2">
          <div className="text-sm font-medium">Payment</div>
          {kv('status', payment?.status)}
          {kv('provider', payment?.provider)}
          {kv('method', payment?.method)}
          {kv('amount (IQD)', payment?.amount_iqd)}
          {kv('currency', payment?.currency)}
          {kv('refunded (IQD)', payment?.refund_amount_iqd)}
          {kv('refunded at', payment?.refunded_at ? new Date(payment.refunded_at).toLocaleString() : null)}
          {kv('provider_ref', payment?.provider_ref)}
          {kv('provider_charge_id', payment?.provider_charge_id)}
          {kv('provider_refund_id', payment?.provider_refund_id)}
          {kv('created', payment?.created_at ? new Date(payment.created_at).toLocaleString() : null)}
          {kv('updated', payment?.updated_at ? new Date(payment.updated_at).toLocaleString() : null)}
          {payment?.failure_code ? (
            <div className="text-xs text-red-700">{payment.failure_code}: {payment.failure_message ?? ''}</div>
          ) : null}
        </div>

        <div className="rounded-xl border bg-white p-4 space-y-2">
          <div className="text-sm font-medium">Ride</div>
          {kv('ride id', ride?.id)}
          {kv('status', ride?.status)}
          {kv('payment method', ride?.payment_method)}
          {kv('payment status', ride?.payment_status)}
          {kv('fare (IQD)', ride?.fare_amount_iqd)}
          {kv('created', ride?.created_at ? new Date(ride.created_at).toLocaleString() : null)}
          {ride?.request ? (
            <>
              <div className="pt-2 text-xs font-medium">Trip</div>
              {kv('pickup', ride.request.pickup_address)}
              {kv('dropoff', ride.request.dropoff_address)}
              {kv('product', ride.request.product_code)}
            </>
          ) : null}
          {ride?.rider ? (
            <>
              <div className="pt-2 text-xs font-medium">Rider</div>
              {kv('name', ride.rider.display_name)}
              {kv('phone', ride.rider.phone)}
              {kv('id', ride.rider.id)}
            </>
          ) : null}
          {ride?.id ? (
            <div className="text-xs">
              <a className="underline hover:no-underline" href={`/rides/${ride.id}`}>
                Open ride
              </a>
            </div>
          ) : null}
        </div>

        <div className="rounded-xl border bg-white p-4 space-y-2">
          <div className="text-sm font-medium">Receipt</div>
          {kv('receipt status', receipt?.status)}
          {kv('total (IQD)', receipt?.total_iqd)}
          {kv('refunded (IQD)', receipt?.refunded_iqd)}
          {kv('created', receipt?.created_at ? new Date(receipt.created_at).toLocaleString() : null)}
          {kv('updated', receipt?.updated_at ? new Date(receipt.updated_at).toLocaleString() : null)}
          {receipt?.status ? (
            <div className="text-xs text-neutral-500">Receipt reflects refunds; payment row may lag provider state.</div>
          ) : null}
        </div>
      </div>

      {payment_intent ? (
        <div className="rounded-xl border bg-white p-4 space-y-2">
          <div className="text-sm font-medium">Payment Intent</div>
          {kv('id', payment_intent.id)}
          {kv('status', payment_intent.status)}
          {kv('provider', payment_intent.provider)}
          {kv('amount (IQD)', payment_intent.amount_iqd)}
          {kv('created', payment_intent.created_at ? new Date(payment_intent.created_at).toLocaleString() : null)}
        </div>
      ) : null}

      {canRefund ? (
        <div className="rounded-xl border bg-white p-4 space-y-3">
          <div className="text-sm font-medium">Refund</div>
          <div className="text-xs text-neutral-500">
            Remaining refundable amount: <span className="font-medium text-neutral-900">{remaining}</span> IQD
          </div>
          <form action={refundPaymentAction} className="flex flex-col gap-2">
            <input type="hidden" name="paymentId" value={payment?.id ?? ''} />
            <input type="hidden" name="rideId" value={payment?.ride_id ?? ride?.id ?? ''} />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-neutral-500">Refund amount (IQD, optional)</label>
                <input
                  name="refundAmountIqd"
                  placeholder={`Leave empty for full (${remaining})`}
                  className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="text-xs text-neutral-500">Reason</label>
                <input
                  name="reason"
                  required
                  minLength={3}
                  maxLength={500}
                  placeholder="Reason"
                  className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
                />
              </div>
            </div>
            <label className="flex items-center gap-2 text-xs text-neutral-600">
              <input type="checkbox" name="confirm" required />
              confirm refund
            </label>
            <button className="rounded-md border px-3 py-2 text-sm hover:bg-neutral-50">
              Refund payment
            </button>
          </form>
          <div className="text-xs text-neutral-500">Refunds are rate-limited, idempotent, and audited.</div>
        </div>
      ) : null}
    </div>
  );
}
