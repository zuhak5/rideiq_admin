import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createMyMerchant, getMyMerchant } from '../lib/merchant';

export default function MerchantDashboardPage() {
  const qc = useQueryClient();
  const mineQ = useQuery({
    queryKey: ['merchant', 'mine'],
    queryFn: getMyMerchant,
  });

  const [businessName, setBusinessName] = useState('');
  const [businessType, setBusinessType] = useState('restaurant');
  const [contactPhone, setContactPhone] = useState('');
  const [addressText, setAddressText] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const canCreate = useMemo(() => businessName.trim().length >= 2 && businessType.trim().length >= 2, [businessName, businessType]);

  async function onCreate() {
    setErr(null);
    setSaving(true);
    try {
      await createMyMerchant({
        business_name: businessName.trim(),
        business_type: businessType.trim(),
        contact_phone: contactPhone.trim() || undefined,
        address_text: addressText.trim() || undefined,
      });
      await qc.invalidateQueries({ queryKey: ['merchant', 'mine'] });
    } catch (e: any) {
      setErr(e?.message ?? 'Failed to create business');
    } finally {
      setSaving(false);
    }
  }

  if (mineQ.isLoading) return <div className="p-4 text-sm text-gray-500">Loading…</div>;
  if (mineQ.error) return <div className="p-4 text-sm text-red-600">Failed to load merchant profile.</div>;

  const m = mineQ.data;

  if (!m) {
    return (
      <div className="max-w-xl mx-auto p-4 space-y-4">
        <h1 className="text-xl font-semibold">Create your business</h1>
        <div className="text-sm text-gray-600">
          You can use the app as a Rider anytime. Business activation requires admin approval.
        </div>

        <div className="border rounded p-3 space-y-3">
          <label className="block">
            <div className="text-sm font-medium">Business name</div>
            <input className="border rounded px-3 py-2 w-full" value={businessName} onChange={(e) => setBusinessName(e.target.value)} />
          </label>

          <label className="block">
            <div className="text-sm font-medium">Business type</div>
            <select className="border rounded px-3 py-2 w-full" value={businessType} onChange={(e) => setBusinessType(e.target.value)}>
              <option value="restaurant">Restaurant</option>
              <option value="grocery">Grocery</option>
              <option value="pharmacy">Pharmacy</option>
              <option value="services">Services</option>
              <option value="other">Other</option>
            </select>
          </label>

          <label className="block">
            <div className="text-sm font-medium">Contact phone (optional)</div>
            <input className="border rounded px-3 py-2 w-full" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} />
          </label>

          <label className="block">
            <div className="text-sm font-medium">Address (optional)</div>
            <input className="border rounded px-3 py-2 w-full" value={addressText} onChange={(e) => setAddressText(e.target.value)} />
          </label>

          {err && <div className="text-sm text-red-600">{err}</div>}

          <button disabled={!canCreate || saving} className="border rounded px-3 py-2 disabled:opacity-50" onClick={onCreate}>
            {saving ? 'Creating…' : 'Create business'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto p-4 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{m.business_name}</h1>
          <div className="text-sm text-gray-600">{m.business_type}</div>
          <div className="text-xs text-gray-500 mt-1">Status: {m.status}</div>
        </div>
        <div className="flex gap-2">
          <Link className="border rounded px-3 py-2 hover:bg-gray-50" to="/merchant/products">Products</Link>
          <Link className="border rounded px-3 py-2 hover:bg-gray-50" to="/merchant/promotions">Promotions</Link>
          <Link className="border rounded px-3 py-2 hover:bg-gray-50" to="/merchant/chats">Chats</Link>
          <Link className="border rounded px-3 py-2 hover:bg-gray-50" to="/merchant/settlement">Settlement</Link>
        </div>
      </div>

      {m.status !== 'approved' && (
        <div className="border rounded p-3 text-sm text-amber-700 bg-amber-50">
          Your business is <b>{m.status}</b>. Admin approval is required before it becomes public.
        </div>
      )}

      <div className="border rounded p-3 text-sm text-gray-700">
        Next: add products, then wait for admin approval. Customers can chat with you once you are approved.
      </div>
    </div>
  );
}
