import React, { useEffect, useMemo, useState } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createMerchantProduct,
  deleteMerchantProduct,
  getMyMerchant,
  listMerchantProductsPaged,
  updateMerchantProduct,
  type MerchantProduct,
} from '../lib/merchant';
import { formatIQD, parseIQDInput } from '../lib/money';

const PAGE_SIZE = 20;

export default function MerchantProductsPage() {
  const qc = useQueryClient();
  const merchantQ = useQuery({ queryKey: ['merchant', 'mine'], queryFn: getMyMerchant });
  const merchantId = merchantQ.data?.id;

  const productsQ = useInfiniteQuery({
    queryKey: ['merchant-products', 'mine', merchantId],
    queryFn: ({ pageParam }) => listMerchantProductsPaged(merchantId!, true, (pageParam as number) ?? 0, PAGE_SIZE),
    initialPageParam: 0,
    getNextPageParam: (last, all) => (last.hasMore ? all.length : undefined),
    enabled: Boolean(merchantId),
  });

  const products = useMemo(() => (productsQ.data?.pages ?? []).flatMap((p) => p.rows), [productsQ.data?.pages]);

  const [name, setName] = useState('');
  const [price, setPrice] = useState('0');
  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');
  const [isFeatured, setIsFeatured] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const canCreate = useMemo(() => name.trim().length >= 2 && parseIQDInput(price) >= 0, [name, price]);

  async function onCreate() {
    if (!merchantId) return;
    setErr(null);
    setSaving(true);
    try {
      await createMerchantProduct({
        merchant_id: merchantId,
        name: name.trim(),
        description: description.trim() || null,
        category: category.trim() || null,
        price_iqd: parseIQDInput(price),
        compare_at_price_iqd: null,
        is_active: true,
        is_featured: isFeatured,
        stock_qty: null,
        images: [],
      });
      setName('');
      setPrice('0');
      setCategory('');
      setDescription('');
      setIsFeatured(false);
      await qc.invalidateQueries({ queryKey: ['merchant-products', 'mine', merchantId] });
    } catch (e: any) {
      setErr(e?.message ?? 'Failed to create product');
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(id: string, isActive: boolean) {
    await updateMerchantProduct(id, { is_active: !isActive });
    await qc.invalidateQueries({ queryKey: ['merchant-products', 'mine', merchantId] });
  }

  async function onDelete(id: string) {
    await deleteMerchantProduct(id);
    await qc.invalidateQueries({ queryKey: ['merchant-products', 'mine', merchantId] });
  }

  // ---- Edit modal ----
  const [editing, setEditing] = useState<MerchantProduct | null>(null);
  const [eName, setEName] = useState('');
  const [ePrice, setEPrice] = useState('0');
  const [eCompare, setECompare] = useState('');
  const [eCategory, setECategory] = useState('');
  const [eDescription, setEDescription] = useState('');
  const [eStock, setEStock] = useState('');
  const [eFeatured, setEFeatured] = useState(false);
  const [eSaving, setESaving] = useState(false);
  const [eErr, setEErr] = useState<string | null>(null);

  useEffect(() => {
    if (!editing) return;
    setEName(editing.name ?? '');
    setEPrice(String(editing.price_iqd ?? 0));
    setECompare(editing.compare_at_price_iqd != null ? String(editing.compare_at_price_iqd) : '');
    setECategory(editing.category ?? '');
    setEDescription(editing.description ?? '');
    setEStock(editing.stock_qty != null ? String(editing.stock_qty) : '');
    setEErr(null);
  }, [editing]);

  const canSaveEdit = useMemo(() => {
    if (!editing) return false;
    if (eName.trim().length < 2) return false;
    if (parseIQDInput(ePrice) < 0) return false;
    const cmp = eCompare.trim() ? parseIQDInput(eCompare) : null;
    if (cmp != null && cmp < 0) return false;
    const stock = eStock.trim() ? Number(eStock) : null;
    if (stock != null && (!Number.isFinite(stock) || stock < 0)) return false;
    return true;
  }, [editing, eName, ePrice, eCompare, eStock]);

  async function onSaveEdit() {
    if (!editing) return;
    setEErr(null);
    setESaving(true);
    try {
      const cmp = eCompare.trim() ? parseIQDInput(eCompare) : null;
      const stock = eStock.trim() ? Number(eStock) : null;

      await updateMerchantProduct(editing.id, {
        name: eName.trim(),
        price_iqd: parseIQDInput(ePrice),
        compare_at_price_iqd: cmp,
        category: eCategory.trim() || null,
        description: eDescription.trim() || null,
        stock_qty: stock != null ? Math.floor(stock) : null,
        is_featured: eFeatured,
      });

      setEditing(null);
      await qc.invalidateQueries({ queryKey: ['merchant-products', 'mine', merchantId] });
    } catch (e: any) {
      setEErr(e?.message ?? 'Failed to update product');
    } finally {
      setESaving(false);
    }
  }

  if (merchantQ.isLoading) return <div className="p-4 text-sm text-gray-500">Loading…</div>;
  if (merchantQ.error) return <div className="p-4 text-sm text-red-600">Failed to load business.</div>;
  if (!merchantQ.data) return <div className="p-4 text-sm text-gray-600">Create a business first in /merchant.</div>;

  return (
    <div className="max-w-3xl mx-auto p-4 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Products</h1>
          <div className="text-xs text-gray-500">Business: {merchantQ.data.business_name}</div>
        </div>
      </div>

      <div className="border rounded p-3 space-y-3">
        <div className="font-medium">Add product</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <input className="border rounded px-3 py-2" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
          <input className="border rounded px-3 py-2" placeholder="Price (IQD)" value={price} onChange={(e) => setPrice(e.target.value)} />
          <input className="border rounded px-3 py-2" placeholder="Category (optional)" value={category} onChange={(e) => setCategory(e.target.value)} />
          <input className="border rounded px-3 py-2" placeholder="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={isFeatured} onChange={(e) => setIsFeatured(e.target.checked)} />
            Featured
          </label>
        </div>
        {err && <div className="text-sm text-red-600">{err}</div>}
        <button disabled={!canCreate || saving} className="border rounded px-3 py-2 disabled:opacity-50" onClick={onCreate}>
          {saving ? 'Saving…' : 'Create'}
        </button>
      </div>

      <div className="border rounded p-3">
        <div className="font-medium mb-2">Your products</div>
        {productsQ.isLoading && <div className="text-sm text-gray-500">Loading…</div>}
        {productsQ.error && <div className="text-sm text-red-600">Failed to load products.</div>}

        <div className="grid gap-2">
          {products.map((p: any) => (
            <div key={p.id} className="border rounded p-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <div className="font-medium truncate">{p.name}</div>
                  {p.is_featured ? <span className="text-[11px] px-2 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200">Featured</span> : null}
                </div>
                <div className="text-sm text-gray-600">{formatIQD(p.price_iqd)}</div>
                {p.compare_at_price_iqd != null ? <div className="text-xs text-gray-500">Compare at: {formatIQD(p.compare_at_price_iqd)}</div> : null}
                {p.stock_qty != null ? <div className="text-xs text-gray-500">Stock: {p.stock_qty}</div> : null}
                <div className="text-xs text-gray-500 mt-1">{p.is_active ? 'Active' : 'Hidden'}</div>
              </div>
              <div className="flex gap-2 flex-wrap justify-end">
                <button className="border rounded px-3 py-1 hover:bg-gray-50" onClick={() => setEditing(p)}>
                  Edit
                </button>
                <button className="border rounded px-3 py-1 hover:bg-gray-50" onClick={() => toggleActive(p.id, p.is_active)}>
                  {p.is_active ? 'Hide' : 'Show'}
                </button>
                <button className="border rounded px-3 py-1 hover:bg-gray-50" onClick={() => onDelete(p.id)}>
                  Delete
                </button>
              </div>
            </div>
          ))}

          {products.length === 0 && !productsQ.isLoading ? <div className="text-sm text-gray-500">No products yet.</div> : null}
        </div>

        <div className="mt-3">
          {productsQ.hasNextPage ? (
            <button
              className="border rounded px-3 py-2 hover:bg-gray-50 disabled:opacity-50"
              disabled={productsQ.isFetchingNextPage}
              onClick={() => void productsQ.fetchNextPage()}
            >
              {productsQ.isFetchingNextPage ? 'Loading…' : 'Load more'}
            </button>
          ) : null}
        </div>
      </div>

      {editing ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onMouseDown={() => setEditing(null)}>
          <div className="w-full max-w-md rounded-2xl bg-white shadow-xl border border-gray-200" onMouseDown={(e) => e.stopPropagation()}>
            <div className="p-5 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-base font-semibold">Edit product</div>
                <button className="text-sm text-gray-600 hover:underline" onClick={() => setEditing(null)}>
                  Close
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <input className="border rounded px-3 py-2" placeholder="Name" value={eName} onChange={(e) => setEName(e.target.value)} />
                <input className="border rounded px-3 py-2" placeholder="Price (IQD)" value={ePrice} onChange={(e) => setEPrice(e.target.value)} />
                <input
                  className="border rounded px-3 py-2"
                  placeholder="Compare at price (optional)"
                  value={eCompare}
                  onChange={(e) => setECompare(e.target.value)}
                />
                <input className="border rounded px-3 py-2" placeholder="Stock qty (optional)" value={eStock} onChange={(e) => setEStock(e.target.value)} />
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={eFeatured} onChange={(e) => setEFeatured(e.target.checked)} />
                  Featured
                </label>
                <input className="border rounded px-3 py-2 md:col-span-2" placeholder="Category (optional)" value={eCategory} onChange={(e) => setECategory(e.target.value)} />
                <textarea
                  className="border rounded px-3 py-2 md:col-span-2"
                  placeholder="Description (optional)"
                  rows={3}
                  value={eDescription}
                  onChange={(e) => setEDescription(e.target.value)}
                />
              </div>

              {eErr ? <div className="text-sm text-red-600">{eErr}</div> : null}

              <div className="flex items-center justify-end gap-2">
                <button className="border rounded px-3 py-2 hover:bg-gray-50" onClick={() => setEditing(null)}>
                  Cancel
                </button>
                <button
                  disabled={!canSaveEdit || eSaving}
                  className="rounded-xl bg-gray-900 text-white px-3 py-2 text-sm disabled:opacity-50"
                  onClick={onSaveEdit}
                >
                  {eSaving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
