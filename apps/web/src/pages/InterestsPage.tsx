import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabaseClient';

// Intentionally untyped against generated DB types (schema evolves via migrations).
type InterestKind = "merchant" | "product" | "category" | "keyword";

type InterestTarget = {
  id: string;
  user_id: string;
  kind: InterestKind;
  merchant_id: string | null;
  product_id: string | null;
  category: string | null;
  keyword: string | null;
  enabled: boolean;
  notify_push: boolean;
  notify_inapp: boolean;
  max_per_week: number;
  created_at: string;
  updated_at: string;
};

type MerchantRow = { id: string; business_name: string };
type ProductRow = { id: string; name: string; merchant_id: string };

function clampInt(v: unknown, min: number, max: number, fallback: number) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

export default function InterestsPage() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [targets, setTargets] = useState<InterestTarget[]>([]);
  const [merchants, setMerchants] = useState<Record<string, MerchantRow>>({});
  const [products, setProducts] = useState<Record<string, ProductRow>>({});

  const [newKeyword, setNewKeyword] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const summary = useMemo(() => {
    const total = targets.length;
    const enabled = targets.filter((x) => x.enabled).length;
    const push = targets.filter((x) => x.enabled && x.notify_push).length;
    const inapp = targets.filter((x) => x.enabled && x.notify_inapp).length;
    return { total, enabled, push, inapp };
  }, [targets]);

  async function load() {
    setLoading(true);
    setError(null);
    setInfo(null);
    try {
      const { data: userRes, error: userErr } = await supabase.auth.getUser();
      if (userErr) throw userErr;
      const uid = userRes.user?.id;
      if (!uid) {
        setTargets([]);
        setMerchants({});
        setProducts({});
        setLoading(false);
        return;
      }

      const { data, error: qErr } = await supabase
        .from("user_interest_targets")
        .select("*")
        .order("created_at", { ascending: false });
      if (qErr) throw qErr;

      const rows = (data ?? []) as any[];
      const normalized: InterestTarget[] = rows.map((r) => ({
        id: String(r.id),
        user_id: String(r.user_id),
        kind: r.kind as InterestKind,
        merchant_id: r.merchant_id ? String(r.merchant_id) : null,
        product_id: r.product_id ? String(r.product_id) : null,
        category: r.category ? String(r.category) : null,
        keyword: r.keyword ? String(r.keyword) : null,
        enabled: Boolean(r.enabled),
        notify_push: Boolean(r.notify_push),
        notify_inapp: Boolean(r.notify_inapp),
        max_per_week: clampInt(r.max_per_week, 0, 20, 2),
        created_at: String(r.created_at),
        updated_at: String(r.updated_at),
      }));

      setTargets(normalized);

      // Fetch display names for referenced merchants/products.
      const merchantIds = Array.from(new Set(normalized.map((x) => x.merchant_id).filter(Boolean))) as string[];
      const productIds = Array.from(new Set(normalized.map((x) => x.product_id).filter(Boolean))) as string[];

      if (merchantIds.length) {
        const { data: mRows, error: mErr } = await supabase
          .from("merchants")
          .select("id,business_name")
          .in("id", merchantIds);
        if (mErr) throw mErr;
        const map: Record<string, MerchantRow> = {};
        for (const m of (mRows ?? []) as any[]) map[String(m.id)] = { id: String(m.id), business_name: String(m.business_name) };
        setMerchants(map);
      } else {
        setMerchants({});
      }

      if (productIds.length) {
        const { data: pRows, error: pErr } = await supabase
          .from("merchant_products")
          .select("id,merchant_id,name")
          .in("id", productIds);
        if (pErr) throw pErr;
        const map: Record<string, ProductRow> = {};
        for (const p of (pRows ?? []) as any[]) map[String(p.id)] = { id: String(p.id), merchant_id: String(p.merchant_id), name: String(p.name) };
        setProducts(map);
      } else {
        setProducts({});
      }
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      void load();
    });
    return () => {
      sub.subscription.unsubscribe();
    };
  }, []);

  async function add(kind: InterestKind, payload: Partial<InterestTarget>) {
    setError(null);
    setInfo(null);
    const { data: userRes } = await supabase.auth.getUser();
    const uid = userRes.user?.id;
    if (!uid) {
      setError(t("interests.must_login"));
      return;
    }

    const base = {
      user_id: uid,
      kind,
      enabled: true,
      notify_push: true,
      notify_inapp: true,
      max_per_week: 2,
    };

    const { error: insErr } = await supabase
      .from("user_interest_targets")
      .insert({ ...base, ...payload });

    if (insErr) {
      setError(insErr.message);
      return;
    }

    // Event-driven seed: a DB webhook on user_interest_targets will call the interest-seed edge function.
    // We show a friendly hint to the user (webhook delivery is async).
    setInfo('تمام ✅ خلال كم ثانية راح يوصلك تنبيه بالخصومات الحالية حسب اهتمامك.');

    setNewKeyword("");
    setNewCategory("");
    await load();
  }

  async function update(id: string, patch: Partial<InterestTarget>) {
    setError(null);
    const { error: upErr } = await supabase
      .from("user_interest_targets")
      .update(patch)
      .eq("id", id);
    if (upErr) {
      setError(upErr.message);
      return;
    }
    await load();
  }

  async function remove(id: string) {
    setError(null);
    const { error: delErr } = await supabase
      .from("user_interest_targets")
      .delete()
      .eq("id", id);
    if (delErr) {
      setError(delErr.message);
      return;
    }
    await load();
  }

  function label(x: InterestTarget) {
    if (x.kind === "merchant") {
      const name = x.merchant_id ? merchants[x.merchant_id]?.business_name : null;
      return name ? `${t("interests.kind.merchant")}: ${name}` : `${t("interests.kind.merchant")}`;
    }
    if (x.kind === "product") {
      const p = x.product_id ? products[x.product_id] : null;
      return p ? `${t("interests.kind.product")}: ${p.name}` : `${t("interests.kind.product")}`;
    }
    if (x.kind === "category") return `${t("interests.kind.category")}: ${x.category ?? ""}`;
    return `${t("interests.kind.keyword")}: ${x.keyword ?? ""}`;
  }

  return (
    <div className="p-4 max-w-4xl mx-auto space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{t("interests.title")}</h1>
          <p className="text-sm text-gray-600">
            {t("interests.subtitle", { total: summary.total, enabled: summary.enabled, push: summary.push, inapp: summary.inapp })}
          </p>
        </div>
        <button
          onClick={() => void load()}
          className="px-3 py-2 rounded bg-gray-900 text-white text-sm hover:opacity-90"
        >
          {t("common.refresh")}
        </button>
      </div>

      {info ? (
        <div className="p-3 rounded border border-green-200 bg-green-50 text-sm text-green-800">{info}</div>
      ) : null}

      {error ? (
        <div className="p-3 rounded border border-red-200 bg-red-50 text-sm text-red-700">{error}</div>
      ) : null}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="p-3 rounded border bg-white space-y-3">
          <div className="text-sm font-medium">{t("interests.add_keyword")}</div>
          <div className="flex gap-2">
            <input
              value={newKeyword}
              onChange={(e) => setNewKeyword(e.target.value)}
              placeholder={t("interests.keyword_placeholder")}
              className="flex-1 border rounded px-3 py-2 text-sm"
            />
            <button
              onClick={() => void add("keyword", { keyword: newKeyword.trim() })}
              disabled={!newKeyword.trim()}
              className="px-3 py-2 rounded bg-blue-600 text-white text-sm disabled:opacity-50"
            >
              {t("common.add")}
            </button>
          </div>
          <div className="text-xs text-gray-500">{t("interests.keyword_hint")}</div>
        </div>

        <div className="p-3 rounded border bg-white space-y-3">
          <div className="text-sm font-medium">{t("interests.add_category")}</div>
          <div className="flex gap-2">
            <input
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
              placeholder={t("interests.category_placeholder")}
              className="flex-1 border rounded px-3 py-2 text-sm"
            />
            <button
              onClick={() => void add("category", { category: newCategory.trim() })}
              disabled={!newCategory.trim()}
              className="px-3 py-2 rounded bg-blue-600 text-white text-sm disabled:opacity-50"
            >
              {t("common.add")}
            </button>
          </div>
          <div className="text-xs text-gray-500">{t("interests.category_hint")}</div>
        </div>
      </div>

      <div className="p-3 rounded border bg-white">
        <div className="text-sm font-medium mb-3">{t("interests.list")}</div>

        {loading ? (
          <div className="text-sm text-gray-600">{t("common.loading")}</div>
        ) : targets.length === 0 ? (
          <div className="text-sm text-gray-600">{t("interests.empty")}</div>
        ) : (
          <div className="space-y-2">
            {targets.map((x) => (
              <div key={x.id} className="p-3 rounded border">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-medium">{label(x)}</div>
                    <div className="text-xs text-gray-500">{t("interests.created_at", { date: new Date(x.created_at).toLocaleString() })}</div>
                  </div>
                  <button
                    onClick={() => void remove(x.id)}
                    className="px-2 py-1 rounded border text-xs hover:bg-gray-50"
                  >
                    {t("common.delete")}
                  </button>
                </div>

                <div className="mt-3 grid grid-cols-1 md:grid-cols-4 gap-2">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={x.enabled}
                      onChange={(e) => void update(x.id, { enabled: e.target.checked })}
                    />
                    {t("interests.enabled")}
                  </label>

                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={x.notify_push}
                      onChange={(e) => void update(x.id, { notify_push: e.target.checked })}
                    />
                    {t("interests.push")}
                  </label>

                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={x.notify_inapp}
                      onChange={(e) => void update(x.id, { notify_inapp: e.target.checked })}
                    />
                    {t("interests.inapp")}
                  </label>

                  <label className="flex items-center gap-2 text-sm">
                    <span className="text-gray-600">{t("interests.max_per_week")}</span>
                    <input
                      type="number"
                      min={0}
                      max={20}
                      value={x.max_per_week}
                      onChange={(e) => void update(x.id, { max_per_week: clampInt(e.target.value, 0, 20, 2) })}
                      className="w-20 border rounded px-2 py-1 text-sm"
                    />
                  </label>
                </div>

                {!x.notify_push && !x.notify_inapp ? (
                  <div className="mt-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
                    {t("interests.no_channels_warning")}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="text-xs text-gray-500">
        {t("interests.footer_hint")}
      </div>
    </div>
  );
}
