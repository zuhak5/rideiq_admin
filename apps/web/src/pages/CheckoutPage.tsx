import React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getMerchant, getMerchantProductsByIds } from '../lib/merchant';
import { cartCount, clearCart, getCart, updateQty } from '../lib/cart';
import { createOrder, listMyAddresses, upsertAddress } from '../lib/orders';
import { formatIQD } from '../lib/money';
import { errorText } from '../lib/errors';
import FeeBreakdown from '../components/FeeBreakdown';

type AddressForm = {
  label: string;
  recipient_name: string;
  phone: string;
  city: string;
  area: string;
  address_line1: string;
  address_line2: string;
  notes: string;
  is_default: boolean;
};

const emptyForm: AddressForm = {
  label: '',
  recipient_name: '',
  phone: '',
  city: 'Baghdad',
  area: '',
  address_line1: '',
  address_line2: '',
  notes: '',
  is_default: false,
};

export default function CheckoutPage() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const { merchantId } = useParams();
  const mId = merchantId ?? '';
  const [note, setNote] = React.useState('');
  const [selectedAddressId, setSelectedAddressId] = React.useState<string | null>(null);
  const [showAdd, setShowAdd] = React.useState(false);
  const [form, setForm] = React.useState<AddressForm>(emptyForm);
  const items = React.useMemo(() => getCart(mId), [mId]);
  const ids = React.useMemo(() => items.map((i) => i.product_id), [items]);

  const merchantQ = useQuery({
    queryKey: ['merchant', mId],
    queryFn: () => getMerchant(mId),
    enabled: Boolean(mId),
  });

  const productsQ = useQuery({
    queryKey: ['merchant_products_by_ids', ids.join(',')],
    queryFn: () => getMerchantProductsByIds(ids),
    enabled: ids.length > 0,
  });

  const addressesQ = useQuery({
    queryKey: ['customer_addresses'],
    queryFn: listMyAddresses,
  });

  React.useEffect(() => {
    const defaults = (addressesQ.data ?? []).find((a) => a.is_default);
    if (!selectedAddressId && defaults?.id) setSelectedAddressId(defaults.id);
  }, [addressesQ.data, selectedAddressId]);

  const placeM = useMutation({
    mutationFn: async () => {
      if (!mId) throw new Error('Missing merchant');
      if (items.length === 0) throw new Error('Cart is empty');
      const orderId = await createOrder({
        merchantId: mId,
        addressId: selectedAddressId,
        customerNote: note,
        items: items.map((i) => ({ product_id: i.product_id, qty: i.qty })),
      });
      clearCart(mId);
      await qc.invalidateQueries({ queryKey: ['merchant_orders'] });
      await qc.invalidateQueries({ queryKey: ['user_notifications'] });
      nav(`/orders/${orderId}`);
    },
  });

  const saveAddressM = useMutation({
    mutationFn: async () => {
      const addr = await upsertAddress({
        label: form.label || null,
        recipient_name: form.recipient_name || null,
        phone: form.phone || null,
        city: form.city,
        area: form.area || null,
        address_line1: form.address_line1,
        address_line2: form.address_line2 || null,
        notes: form.notes || null,
        is_default: form.is_default,
      } as any);
      setSelectedAddressId(addr.id);
      setShowAdd(false);
      setForm(emptyForm);
      await qc.invalidateQueries({ queryKey: ['customer_addresses'] });
    },
  });

  const rows = (productsQ.data ?? []).map((p) => {
    const q = items.find((i) => i.product_id === p.id)?.qty ?? 0;
    const line = q * (p.price_iqd ?? 0);
    return { p, q, line };
  });
  const subtotal = rows.reduce((acc, r) => acc + r.line, 0);

  if (!mId) return <div className="p-6">Missing merchant.</div>;
  if (items.length === 0) {
    return (
      <div className="p-6 space-y-4">
        <div className="text-xl font-semibold">Checkout</div>
        <div className="card p-5">
          <div className="text-sm text-gray-600">Your cart is empty.</div>
          <button className="btn btn-primary mt-3" onClick={() => nav(`/business/${mId}`)}>
            Browse products
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="text-xl font-semibold">Checkout</div>
          <div className="text-xs text-gray-500">
            {merchantQ.data?.business_name ? `Merchant: ${merchantQ.data.business_name}` : 'Loading merchant…'}
          </div>
        </div>
        <button className="btn" onClick={() => nav(`/business/${mId}`)}>
          Back to shop
        </button>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="card p-5 space-y-3">
          <div className="font-semibold">Items ({cartCount(mId)})</div>
          {productsQ.isLoading ? <div className="text-sm text-gray-500">Loading products…</div> : null}
          {productsQ.error ? <div className="text-sm text-red-700">{errorText(productsQ.error)}</div> : null}

          <div className="divide-y">
            {rows.map(({ p, q, line }) => (
              <div key={p.id} className="py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium truncate">{p.name}</div>
                  <div className="text-xs text-gray-500">{formatIQD(p.price_iqd)} each</div>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    className="input w-20"
                    type="number"
                    min={1}
                    max={99}
                    value={q}
                    onChange={(e) => {
                      const v = Number(e.target.value || 0);
                      updateQty(mId, p.id, v);
                      // localStorage-only; refresh by navigating to same page
                      nav(0);
                    }}
                  />
                  <div className="text-sm font-medium w-24 text-right">{formatIQD(line)}</div>
                </div>
              </div>
            ))}
          </div>

          <div className="pt-2 border-t border-gray-100 mt-2">
            <FeeBreakdown
              subtotal={subtotal}
              deliveryFee={2500} // Hardcoded for MVP as per session plan, real logic would fetch from edge
              serviceFee={500}
            />
          </div>
          <div className="text-xs text-gray-500 mt-2">Final total calculated at order placement.</div>

          <div className="pt-2">
            <div className="label mb-1">Note to merchant (optional)</div>
            <textarea className="input" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>

        <div className="card p-5 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="font-semibold">Shipping address</div>
            <button className="btn" onClick={() => setShowAdd((s) => !s)}>
              {showAdd ? 'Close' : 'Add address'}
            </button>
          </div>

          {addressesQ.isLoading ? <div className="text-sm text-gray-500">Loading addresses…</div> : null}
          {addressesQ.error ? <div className="text-sm text-red-700">{errorText(addressesQ.error)}</div> : null}

          {(addressesQ.data ?? []).length === 0 && !addressesQ.isLoading ? (
            <div className="text-sm text-gray-600">No saved addresses yet. Add one to continue.</div>
          ) : null}

          <div className="space-y-2">
            {(addressesQ.data ?? []).map((a) => (
              <label key={a.id} className="block rounded-2xl border border-gray-200 p-3 hover:bg-gray-50 cursor-pointer">
                <div className="flex items-start gap-3">
                  <input type="radio" checked={selectedAddressId === a.id} onChange={() => setSelectedAddressId(a.id)} />
                  <div className="min-w-0">
                    <div className="text-sm font-medium">
                      {a.label ? `${a.label} • ` : ''}{a.city}{a.area ? ` / ${a.area}` : ''}{a.is_default ? ' • default' : ''}
                    </div>
                    <div className="text-xs text-gray-600 mt-1">
                      {a.address_line1}{a.address_line2 ? `, ${a.address_line2}` : ''}
                      {a.phone ? ` • ${a.phone}` : ''}
                    </div>
                  </div>
                </div>
              </label>
            ))}
          </div>

          {showAdd ? (
            <div className="mt-3 rounded-2xl border border-gray-200 bg-gray-50 p-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="label mb-1">Label</div>
                  <input className="input" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="Home" />
                </div>
                <div>
                  <div className="label mb-1">Phone</div>
                  <input className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="07xxxxxxxxx" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="label mb-1">City</div>
                  <input className="input" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
                </div>
                <div>
                  <div className="label mb-1">Area</div>
                  <input className="input" value={form.area} onChange={(e) => setForm({ ...form, area: e.target.value })} />
                </div>
              </div>
              <div>
                <div className="label mb-1">Address line 1</div>
                <input className="input" value={form.address_line1} onChange={(e) => setForm({ ...form, address_line1: e.target.value })} />
              </div>
              <div>
                <div className="label mb-1">Address line 2</div>
                <input className="input" value={form.address_line2} onChange={(e) => setForm({ ...form, address_line2: e.target.value })} />
              </div>
              <div>
                <div className="label mb-1">Notes</div>
                <input className="input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.is_default} onChange={(e) => setForm({ ...form, is_default: e.target.checked })} />
                Make default
              </label>

              {saveAddressM.error ? <div className="text-sm text-red-700">{errorText(saveAddressM.error)}</div> : null}
              <button
                className="btn btn-primary"
                disabled={saveAddressM.isPending || !form.city || !form.address_line1}
                onClick={() => saveAddressM.mutate()}
              >
                {saveAddressM.isPending ? 'Saving…' : 'Save address'}
              </button>
            </div>
          ) : null}

          {placeM.error ? <div className="text-sm text-red-700">{errorText(placeM.error)}</div> : null}

          <button
            className="btn btn-primary w-full"
            disabled={placeM.isPending || !selectedAddressId}
            onClick={() => placeM.mutate()}
          >
            {placeM.isPending ? 'Placing order…' : 'Place order'}
          </button>
          {!selectedAddressId ? <div className="text-xs text-gray-500">Select or add an address to continue.</div> : null}
        </div>
      </div>
    </div>
  );
}
