import React from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { getMerchant, isPromotionActive, listMerchantProductCategories, listMerchantProductsPaged, listMerchantPromotions, merchantChatGetOrCreateThread, type MerchantPromotion, type ProductSort } from '../lib/merchant';
import { formatIQD } from '../lib/money';
import { addToCart, cartCount } from '../lib/cart';
import { supabase } from '../lib/supabaseClient';

const PAGE_SIZE = 20;

export default function BusinessDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const merchantId = id as string;
  const nav = useNavigate();

  const [cartVersion, setCartVersion] = React.useState(0);
  const [q, setQ] = React.useState('');
  const [category, setCategory] = React.useState('');
  const [sort, setSort] = React.useState<ProductSort>('featured');
  const [featuredOnly, setFeaturedOnly] = React.useState(false);
  const [count, setCount] = React.useState(() => cartCount(merchantId));

  const [followLoading, setFollowLoading] = React.useState(false);
  const [interestId, setInterestId] = React.useState<string | null>(null);
  const [following, setFollowing] = React.useState(false);

  const loadFollowState = React.useCallback(async () => {
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user?.id || !merchantId) {
        setInterestId(null);
        setFollowing(false);
        return;
      }
      const { data, error } = await supabase
        .from('user_interest_targets')
        .select('id,enabled')
        .eq('kind', 'merchant')
        .eq('merchant_id', merchantId)
        .maybeSingle();
      if (error) {
        setInterestId(null);
        setFollowing(false);
        return;
      }
      if (data?.id) {
        setInterestId(String((data as any).id));
        setFollowing(Boolean((data as any).enabled));
      } else {
        setInterestId(null);
        setFollowing(false);
      }
    } catch {
      setInterestId(null);
      setFollowing(false);
    }
  }, [merchantId]);

  React.useEffect(() => {
    void loadFollowState();
  }, [loadFollowState]);

  async function toggleFollow(next: boolean) {
    setFollowLoading(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      const uid = u.user?.id;
      if (!uid) return;

      if (interestId) {
        const { error } = await supabase
          .from('user_interest_targets')
          .update({ enabled: next })
          .eq('id', interestId);
        if (error) throw error;
      } else if (next) {
        const { error } = await supabase
          .from('user_interest_targets')
          .insert({
            user_id: uid,
            kind: 'merchant',
            merchant_id: merchantId,
            enabled: true,
            notify_push: true,
            notify_inapp: true,
            max_per_week: 2,
          });
        if (error) {
          // If it already exists (unique constraint), refresh state and update.
          const msg = String((error as any)?.message ?? '');
          if (msg.toLowerCase().includes('duplicate') || msg.includes('23505')) {
            const { data: existing } = await supabase
              .from('user_interest_targets')
              .select('id')
              .eq('kind', 'merchant')
              .eq('merchant_id', merchantId)
              .maybeSingle();
            if ((existing as any)?.id) {
              await supabase.from('user_interest_targets').update({ enabled: true }).eq('id', String((existing as any).id));
            }
          } else {
            throw error;
          }
        }
      }

      await loadFollowState();
    } finally {
      setFollowLoading(false);
    }
  }

  React.useEffect(() => {
    setCount(cartCount(merchantId));
  }, [merchantId, cartVersion]);

  const merchantQ = useQuery({
    queryKey: ['merchant', merchantId],
    queryFn: () => getMerchant(merchantId),
    enabled: Boolean(merchantId),
  });

  const categoriesQ = useQuery({
    queryKey: ['merchant-categories', merchantId],
    queryFn: () => listMerchantProductCategories(merchantId, false),
    enabled: Boolean(merchantId),
  });

  const productsQ = useInfiniteQuery({
    queryKey: ['merchant-products', merchantId, q, category, sort, featuredOnly],
    queryFn: ({ pageParam }) =>
      listMerchantProductsPaged(merchantId, false, (pageParam as number) ?? 0, PAGE_SIZE, {
        q,
        category: category || null,
        featuredOnly,
        sort,
      }),
    initialPageParam: 0,
    getNextPageParam: (last, all) => (last.hasMore ? all.length : undefined),
    enabled: Boolean(merchantId),
  });


  const promosQ = useQuery({
    queryKey: ['merchant-promotions', merchantId],
    queryFn: () => listMerchantPromotions(merchantId, false),
    enabled: Boolean(merchantId),
  });

  const products = React.useMemo(() => (productsQ.data?.pages ?? []).flatMap((p) => p.rows), [productsQ.data?.pages]);


  const activePromos = React.useMemo(() => {
    const now = new Date();
    return (promosQ.data ?? []).filter((p: MerchantPromotion) => isPromotionActive(p, now));
  }, [promosQ.data]);

  const promoBuckets = React.useMemo(() => {
    const byProduct = new Map<string, MerchantPromotion[]>();
    const byCategory = new Map<string, MerchantPromotion[]>();
    const merchantWide: MerchantPromotion[] = [];
    for (const p of activePromos) {
      if (p.product_id) {
        const arr = byProduct.get(p.product_id) ?? [];
        arr.push(p);
        byProduct.set(p.product_id, arr);
      } else if ((p as any).category) {
        const c = ((p as any).category ?? '').toString().trim();
        if (c) {
          const key = c.toLowerCase();
          const arr = byCategory.get(key) ?? [];
          arr.push(p);
          byCategory.set(key, arr);
        } else {
          merchantWide.push(p);
        }
      } else {
        merchantWide.push(p);
      }
    }
    return { byProduct, byCategory, merchantWide };
  }, [activePromos]);

  function computeEffectivePrice(price: number, promo: MerchantPromotion | null): { final: number; label: string | null } {
    if (!promo) return { final: price, label: null };
    if (promo.discount_type === 'percent') {
      const pct = Number(promo.value);
      const off = Math.floor((price * pct) / 100);
      const final = Math.max(price - off, 0);
      return { final, label: `خصم ${pct}%` };
    }
    // fixed_iqd
    const off = Math.floor(Number(promo.value));
    const final = Math.max(price - off, 0);
    return { final, label: `خصم ${off} د.ع` };
  }

  function pickBestPromo(productId: string, price: number, productCategory?: string | null): MerchantPromotion | null {
    const catKey = (productCategory ?? '').toString().trim().toLowerCase();
    const candidates = [
      ...(promoBuckets.byProduct.get(productId) ?? []),
      ...(catKey ? (promoBuckets.byCategory.get(catKey) ?? []) : []),
      ...promoBuckets.merchantWide,
    ];
    if (candidates.length === 0) return null;
    // Choose the promo that yields the maximum savings
    let best: MerchantPromotion | null = null;
    let bestSavings = -1;
    for (const p of candidates) {
      const { final } = computeEffectivePrice(price, p);
      const savings = price - final;
      if (savings > bestSavings) {
        bestSavings = savings;
        best = p;
      }
    }
    return best;
  }

  async function onChat() {
    const threadId = await merchantChatGetOrCreateThread(merchantId);
    nav(`/merchant-chat/${threadId}`);
  }

  if (merchantQ.isLoading) return <div className="p-4 text-sm text-gray-500">Loading…</div>;
  if (merchantQ.error || !merchantQ.data) return <div className="p-4 text-sm text-red-600">Business not found.</div>;

  const m = merchantQ.data;

  return (
    <div className="max-w-3xl mx-auto p-4 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{m.business_name}</h1>
          <div className="text-sm text-gray-600">{m.business_type}</div>
          {m.address_text && <div className="text-sm text-gray-500 mt-1">{m.address_text}</div>}
        </div>

        <div className="flex items-center gap-2">
          <button
            className="border rounded px-3 py-2 hover:bg-gray-50 disabled:opacity-50"
            disabled={followLoading}
            onClick={() => void toggleFollow(!following)}
            title={t('business.manage_interests')}
          >
            {following ? t('business.unfollow_discounts') : t('business.follow_discounts')}
          </button>

          <button className="border rounded px-3 py-2 hover:bg-gray-50" onClick={() => nav('/interests')}>
            {t('business.manage_interests')}
          </button>

          <button className="border rounded px-3 py-2 hover:bg-gray-50" onClick={onChat}>
            Chat
          </button>
        </div>
      </div>

      {count > 0 ? (
        <div className="card p-4 flex items-center justify-between gap-3">
          <div className="text-sm text-gray-600">Cart: <span className="font-semibold">{count}</span> item(s)</div>
          <button className="btn btn-primary" onClick={() => nav(`/checkout/${merchantId}`)}>
            Checkout
          </button>
        </div>
      ) : null}

      <div className="border rounded p-3">
        <div className="font-medium mb-2">Products</div>
        <div className="grid gap-2 md:grid-cols-4 mb-3">
          <input
            className="border rounded px-3 py-2 md:col-span-2"
            placeholder="Search…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <select className="border rounded px-3 py-2" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">All categories</option>
            {(categoriesQ.data ?? []).map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <select className="border rounded px-3 py-2" value={sort} onChange={(e) => setSort(e.target.value as ProductSort)}>
            <option value="featured">Featured</option>
            <option value="newest">Newest</option>
            <option value="price_asc">Price ↑</option>
            <option value="price_desc">Price ↓</option>
          </select>
          <label className="flex items-center gap-2 text-sm md:col-span-4">
            <input type="checkbox" checked={featuredOnly} onChange={(e) => setFeaturedOnly(e.target.checked)} />
            Featured only
          </label>
        </div>

        {productsQ.isLoading && <div className="text-sm text-gray-500">Loading products…</div>}
        {productsQ.error && <div className="text-sm text-red-600">Failed to load products.</div>}

        <div className="grid gap-2">
          {products.map((p: any) => (
            <div key={p.id} className="border rounded p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="font-medium">{p.name}</div>
                {(() => {
                  const promo = pickBestPromo(p.id, p.price_iqd, p.category);
                  const { final, label } = computeEffectivePrice(p.price_iqd, promo);
                  const isDiscounted = final < p.price_iqd;
                  return (
                    <div className="text-sm flex items-center gap-2">
                      {isDiscounted ? (
                        <>
                          <span className="line-through text-gray-500">{formatIQD(p.price_iqd)}</span>
                          <span className="font-semibold">{formatIQD(final)}</span>
                          {label ? <span className="text-xs px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">{label}</span> : null}
                        </>
                      ) : (
                        <span>{formatIQD(p.price_iqd)}</span>
                      )}
                    </div>
                  );
                })()}
              </div>
              {p.compare_at_price_iqd != null ? <div className="text-xs text-gray-500 mt-1">Compare at: {formatIQD(p.compare_at_price_iqd)}</div> : null}
              {p.description && <div className="text-sm text-gray-600 mt-1">{p.description}</div>}
              {p.category && <div className="text-xs text-gray-500 mt-1">Category: {p.category}</div>}

              <div className="mt-3 flex items-center justify-end">
                <button
                  className="btn btn-primary"
                  onClick={() => {
                    addToCart(merchantId, p.id, 1);
                    setCartVersion((v) => v + 1);
                  }}
                >
                  Add to cart
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
    </div>
  );
}
