import React, { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createMerchantPromotion,
  deleteMerchantPromotion,
  getMyMerchant,
  isPromotionActive,
  listMerchantProducts,
  listMerchantPromotions,
  updateMerchantPromotion,
  type MerchantPromotion,
} from '../lib/merchant';

function toIsoOrNull(v: string): string | null {
  const t = v.trim();
  if (!t) return null;
  // datetime-local => local time; convert to ISO
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function formatPromoLabel(p: MerchantPromotion) {
  if (p.discount_type === 'percent') return `خصم ${p.value}%`;
  return `خصم ${p.value} د.ع`;
}

export default function MerchantPromotionsPage() {
  const qc = useQueryClient();
  const merchantQ = useQuery({ queryKey: ['merchant', 'mine'], queryFn: getMyMerchant });

  const merchantId = merchantQ.data?.id;

  const productsQ = useQuery({
    queryKey: ['merchant-products-all', merchantId],
    queryFn: () => listMerchantProducts(merchantId!, true),
    enabled: Boolean(merchantId),
  });

  const promosQ = useQuery({
    queryKey: ['merchant-promotions', merchantId],
    queryFn: () => listMerchantPromotions(merchantId!, true),
    enabled: Boolean(merchantId),
  });

  const productMap = useMemo(() => {
    const m = new Map<string, any>();
    for (const p of productsQ.data ?? []) m.set(p.id, p);
    return m;
  }, [productsQ.data]);

  const categories = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const p of productsQ.data ?? []) {
      const c = (p as any)?.category?.toString().trim();
      if (!c) continue;
      const k = c.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(c);
    }
    return out;
  }, [productsQ.data]);

  const [scope, setScope] = useState<'all' | 'product' | 'category'>('all');
  const [productId, setProductId] = useState<string>('');
  const [category, setCategory] = useState<string>('');
  const [discountType, setDiscountType] = useState<'percent' | 'fixed_iqd'>('percent');
  const [value, setValue] = useState<string>('10');
  const [startsAt, setStartsAt] = useState<string>('');
  const [endsAt, setEndsAt] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onCreate() {
    if (!merchantId) return;
    setErr(null);
    const v = Number(value);
    if (!Number.isFinite(v) || v <= 0) {
      setErr('قيمة الخصم غير صحيحة');
      return;
    }
    setSaving(true);
    try {
      await createMerchantPromotion({
        merchant_id: merchantId,
        product_id: scope === 'product' ? productId || null : null,
        category: scope === 'category' ? (category.trim() || null) : null,
        discount_type: discountType,
        value: v,
        starts_at: toIsoOrNull(startsAt),
        ends_at: toIsoOrNull(endsAt),
        is_active: true,
      });
      setCategory('');
      setStartsAt('');
      setEndsAt('');
      await qc.invalidateQueries({ queryKey: ['merchant-promotions', merchantId] });
    } catch (e: any) {
      setErr(e?.message ?? 'فشل إنشاء الخصم');
    } finally {
      setSaving(false);
    }
  }

  async function onToggleActive(p: MerchantPromotion) {
    if (!merchantId) return;
    try {
      await updateMerchantPromotion(p.id, { is_active: !p.is_active });
      await qc.invalidateQueries({ queryKey: ['merchant-promotions', merchantId] });
    } catch (e: any) {
      setErr(e?.message ?? 'فشل تحديث الخصم');
    }
  }

  async function onDelete(p: MerchantPromotion) {
    if (!merchantId) return;
    if (!confirm('Delete this promotion?')) return;
    try {
      await deleteMerchantPromotion(p.id);
      await qc.invalidateQueries({ queryKey: ['merchant-promotions', merchantId] });
    } catch (e: any) {
      setErr(e?.message ?? 'Failed to delete');
    }
  }

  if (merchantQ.isLoading) return <div className="p-4 text-sm text-gray-500">Loading…</div>;
  if (merchantQ.error) return <div className="p-4 text-sm text-red-600">Failed to load business.</div>;
  if (!merchantQ.data) return <div className="p-4 text-sm text-gray-600">Create a business first in /merchant.</div>;

  const now = new Date();
  const promos = (promosQ.data ?? []) as MerchantPromotion[];

  return (
    <div className="max-w-3xl mx-auto p-4 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Promotions</h1>
          <div className="text-sm text-gray-600">Manage discounts for your business.</div>
        </div>
        <div className="text-xs text-gray-500">Status: {merchantQ.data.status}</div>
      </div>

      <div className="border rounded p-3 space-y-3">
        <div className="font-medium">Create promotion</div>

        <div className="grid gap-3 md:grid-cols-2">
          <label className="block">
            <div className="text-sm font-medium">Scope</div>
            <select className="border rounded px-3 py-2 w-full" value={scope} onChange={(e) => setScope(e.target.value as any)}>
              <option value="all">All products</option>
              <option value="product">Specific product</option>
              <option value="category">Category</option>
            </select>
          </label>

          {scope === 'product' ? (
            <label className="block">
              <div className="text-sm font-medium">Product</div>
              <select className="border rounded px-3 py-2 w-full" value={productId} onChange={(e) => setProductId(e.target.value)}>
                <option value="">Choose…</option>
                {(productsQ.data ?? []).map((p: any) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          ) : scope === 'category' ? (
            <label className="block">
              <div className="text-sm font-medium">Category</div>
              <select className="border rounded px-3 py-2 w-full" value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="">Choose…</option>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <div />
          )}

          <label className="block">
            <div className="text-sm font-medium">Discount type</div>
            <select className="border rounded px-3 py-2 w-full" value={discountType} onChange={(e) => setDiscountType(e.target.value as any)}>
              <option value="percent">Percent</option>
              <option value="fixed_iqd">Fixed IQD</option>
            </select>
          </label>

          <label className="block">
            <div className="text-sm font-medium">Value</div>
            <input className="border rounded px-3 py-2 w-full" value={value} onChange={(e) => setValue(e.target.value)} />
          </label>

          <label className="block">
            <div className="text-sm font-medium">Starts at (optional)</div>
            <input type="datetime-local" className="border rounded px-3 py-2 w-full" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
          </label>

          <label className="block">
            <div className="text-sm font-medium">Ends at (optional)</div>
            <input type="datetime-local" className="border rounded px-3 py-2 w-full" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
          </label>
        </div>

        {err ? <div className="text-sm text-red-600">{err}</div> : null}

        <button className="border rounded px-3 py-2 disabled:opacity-50" disabled={saving || (scope === 'product' && !productId) || (scope === 'category' && !category)} onClick={() => void onCreate()}>
          {saving ? 'Creating…' : 'Create'}
        </button>
      </div>

      <div className="border rounded p-3">
        <div className="font-medium mb-2">Existing promotions</div>
        {promosQ.isLoading && <div className="text-sm text-gray-500">Loading…</div>}
        {promosQ.error && <div className="text-sm text-red-600">Failed to load promotions.</div>}

        <div className="grid gap-2">
          {promos.map((p) => {
            const active = isPromotionActive(p, now);
            const product = p.product_id ? productMap.get(p.product_id) : null;
            return (
              <div key={p.id} className="border rounded p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-medium">{formatPromoLabel(p)}</div>
                    <div className="text-xs text-gray-600 mt-1">
                      Scope: {product ? product.name : (p.category ? `Category: ${p.category}` : 'All products')}
                      {' · '}
                      Active now: {active ? 'Yes' : 'No'}
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      {p.starts_at ? `Starts: ${new Date(p.starts_at).toLocaleString()}` : 'Starts: —'}
                      {' · '}
                      {p.ends_at ? `Ends: ${new Date(p.ends_at).toLocaleString()}` : 'Ends: —'}
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <button className="border rounded px-3 py-2 hover:bg-gray-50" onClick={() => void onToggleActive(p)}>
                      {p.is_active ? 'Disable' : 'Enable'}
                    </button>
                    <button className="border rounded px-3 py-2 hover:bg-gray-50 text-red-700" onClick={() => void onDelete(p)}>
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
          {promos.length === 0 && !promosQ.isLoading ? <div className="text-sm text-gray-500">No promotions yet.</div> : null}
        </div>
      </div>
    </div>
  );
}
