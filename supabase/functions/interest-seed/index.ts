import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { corsHeaders} from "../_shared/cors.ts";
import { errorJson, json } from "../_shared/json.ts";
import { createServiceClient } from "../_shared/supabase.ts";
import { requireWebhookSecret } from "../_shared/webhookAuth.ts";
import { withRequestContext } from "../_shared/requestContext.ts";

/**
 * interest-seed
 *
 * Triggered by a Supabase Database Webhook on:
 * - public.user_interest_targets (INSERT)
 * - public.user_interest_targets (UPDATE when enabled flips false -> true)
 *
 * Purpose:
 * When a user adds/enables an interest target, we "seed" them with the
 * currently-active promotions that match that interest, by creating ONE
 * summary notification (Iraqi Arabic) + receipts to prevent duplicates.
 *
 * IMPORTANT:
 * This function creates a row in public.user_notifications which triggers
 * public.notification_outbox via DB trigger. Delivery must be event-driven:
 * configure a database webhook on public.notification_outbox (INSERT)
 * that calls notifications-dispatch.
 */

type WebhookPayload<T> =
  | { type: "INSERT" | "UPDATE" | "DELETE"; table: string; schema: string; record: T | null; old_record: T | null }
  | Record<string, unknown>;

type InterestTarget = {
  id: string;
  user_id: string;
  kind: "merchant" | "product" | "category" | "keyword" | string;
  merchant_id: string | null;
  product_id: string | null;
  category: string | null;
  keyword: string | null;
  enabled: boolean;
  notify_push: boolean;
  notify_inapp: boolean;
};

type Promotion = {
  id: string;
  merchant_id: string;
  product_id: string | null;
  discount_type: string;
  value: number;
  starts_at: string | null;
  ends_at: string | null;
  is_active: boolean;
  category: string | null;
  created_at?: string | null;
};

function isWithinWindow(p: Promotion): boolean {
  const now = Date.now();
  if (!p.is_active) return false;
  if (p.starts_at) {
    const s = Date.parse(p.starts_at);
    if (!Number.isNaN(s) && now < s) return false;
  }
  if (p.ends_at) {
    const e = Date.parse(p.ends_at);
    if (!Number.isNaN(e) && now > e) return false;
  }
  return true;
}

function fmtDiscount(p: Promotion): string {
  if (p.discount_type === "percent") return `${p.value}%`;
  if (p.discount_type === "fixed_iqd") return `${p.value} د.ع`;
  return String(p.value);
}

function compactTitle(kind: string): string {
  if (kind === "merchant") return "خصومات موجودة هسه";
  if (kind === "product") return "خصم على منتج تتابعه";
  if (kind === "category") return "خصومات حسب اهتماماتك";
  if (kind === "keyword") return "خصومات حسب كلماتك";
  return "خصومات";
}

serve((req) =>
  withRequestContext('interest-seed', req, async (_ctx) => {
  if (req.method !== "POST") return errorJson("Method not allowed", 405);

  // Shared-secret auth (best practice for webhook endpoints; verify_jwt=false)
  const auth = requireWebhookSecret(req, "INTEREST_WEBHOOK_SECRET", "x-webhook-secret");
  if (auth) return auth;

  const payload = (await req.json().catch(() => ({}))) as WebhookPayload<InterestTarget>;
  const type = (payload as any)?.type;
  const record = (payload as any)?.record ?? null;
  const oldRecord = (payload as any)?.old_record ?? null;

  if (!record || typeof record !== "object") return errorJson("Missing interest record", 400, "BAD_REQUEST");

  const t = record as InterestTarget;
  if (!t.id || !t.user_id || !t.kind) return errorJson("Invalid record", 400, "BAD_REQUEST");

  if (type === "DELETE") return json({ ok: true, ignored: true, reason: "DELETE" }, 200, corsHeaders);

  // Only seed when enabled is true and either:
  // - INSERT
  // - UPDATE where enabled flips false -> true
  if (!t.enabled) return json({ ok: true, ignored: true, reason: "disabled" }, 200, corsHeaders);
  if (type === "UPDATE") {
    const prevEnabled = Boolean((oldRecord as any)?.enabled);
    if (prevEnabled) return json({ ok: true, ignored: true, reason: "already_enabled" }, 200, corsHeaders);
  }

  const svc = createServiceClient();

  // Resolve target label (best-effort)
  let targetLabel = "";
  if (t.kind === "merchant" && t.merchant_id) {
    const { data: m } = await svc.from("merchants").select("business_name").eq("id", t.merchant_id).maybeSingle();
    targetLabel = (m as any)?.business_name ? `من ${(m as any).business_name}` : "من متجر";
  } else if (t.kind === "product" && t.product_id) {
    const { data: p } = await svc.from("merchant_products").select("name").eq("id", t.product_id).maybeSingle();
    targetLabel = (p as any)?.name ? `على ${(p as any).name}` : "على منتج";
  } else if (t.kind === "category" && t.category) {
    targetLabel = `ضمن ${t.category}`;
  } else if (t.kind === "keyword" && t.keyword) {
    targetLabel = `بخصوص "${t.keyword}"`;
  }

  // Fetch candidate promotions (limited)
  let promos: Promotion[] = [];

  const baseSelect = "id,merchant_id,product_id,discount_type,value,starts_at,ends_at,is_active,category,created_at";

  if (t.kind === "merchant" && t.merchant_id) {
    const { data, error } = await svc
      .from("merchant_promotions")
      .select(baseSelect)
      .eq("merchant_id", t.merchant_id)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(40);
    if (error) return errorJson(error.message, 400, "DB_ERROR");
    promos = (data ?? []) as any;
  } else if (t.kind === "product" && t.product_id) {
    const { data, error } = await svc
      .from("merchant_promotions")
      .select(baseSelect)
      .eq("product_id", t.product_id)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(40);
    if (error) return errorJson(error.message, 400, "DB_ERROR");
    promos = (data ?? []) as any;
  } else if (t.kind === "category" && t.category) {
    const { data, error } = await svc
      .from("merchant_promotions")
      .select(baseSelect)
      .eq("category", t.category)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) return errorJson(error.message, 400, "DB_ERROR");
    promos = (data ?? []) as any;
  } else if (t.kind === "keyword" && t.keyword) {
    // Best-effort keyword scan: pull a small window of active promos and filter in-memory.
    const kw = String(t.keyword).toLowerCase().trim();
    const { data, error } = await svc
      .from("merchant_promotions")
      .select(baseSelect)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(80);
    if (error) return errorJson(error.message, 400, "DB_ERROR");
    const raw = (data ?? []) as any as Promotion[];

    const merchantIds = Array.from(new Set(raw.map((p) => p.merchant_id).filter(Boolean)));
    const productIds = Array.from(new Set(raw.map((p) => p.product_id).filter(Boolean))) as string[];

    const [{ data: merchRows }, { data: prodRows }] = await Promise.all([
      merchantIds.length
        ? svc.from("merchants").select("id,business_name").in("id", merchantIds).limit(200)
        : Promise.resolve({ data: [] as any[] }),
      productIds.length
        ? svc.from("merchant_products").select("id,name,category").in("id", productIds).limit(200)
        : Promise.resolve({ data: [] as any[] }),
    ]);

    const merchMap = new Map<string, string>();
    for (const r of merchRows ?? []) merchMap.set(String((r as any).id), String((r as any).business_name ?? ""));
    const prodMap = new Map<string, { name: string; category: string }>();
    for (const r of prodRows ?? []) {
      prodMap.set(String((r as any).id), {
        name: String((r as any).name ?? ""),
        category: String((r as any).category ?? ""),
      });
    }

    promos = raw.filter((p) => {
      const m = merchMap.get(String(p.merchant_id)) ?? "";
      const prod = p.product_id ? prodMap.get(String(p.product_id)) : null;
      const hay = `${m} ${prod?.name ?? ""} ${p.category ?? ""} ${prod?.category ?? ""}`.toLowerCase();
      return hay.includes(kw);
    });
  } else {
    return json({ ok: true, ignored: true, reason: "unsupported_kind_or_missing_target" }, 200, corsHeaders);
  }

  promos = promos.filter(isWithinWindow);
  if (promos.length === 0) {
    return json({ ok: true, seeded: 0, reason: "no_active_promos" }, 200, corsHeaders);
  }

  // Deduplicate + cap list (we will include a short list inside the notification data)
  const uniq = new Map<string, Promotion>();
  for (const p of promos) uniq.set(String(p.id), p);
  const top = Array.from(uniq.values()).slice(0, 8);

  // Compute delivery channels for the seed notification.
  // Policy: seed is primarily in-app; only push if user disabled in-app.
  const inapp = Boolean(t.notify_inapp);
  const push = Boolean(t.notify_push) && !inapp;
  if (!inapp && !push) {
    return json({ ok: true, seeded: 0, reason: "channels_disabled" }, 200, corsHeaders);
  }

  const title = compactTitle(t.kind);
  const body = `لقيت ${top.length} خصم/خصومات ${targetLabel || "حسب اهتمامك"}. افتح التنبيهات حتى تشوف التفاصيل.`;

  const { data: inserted, error: insErr } = await svc
    .from("user_notifications")
    .insert({
      user_id: t.user_id,
      kind: "promo_seed",
      title,
      body,
      data: {
        push,
        inapp,
        type: "promo_seed",
        target: {
          id: t.id,
          kind: t.kind,
          merchant_id: t.merchant_id,
          product_id: t.product_id,
          category: t.category,
          keyword: t.keyword,
        },
        promotions: top.map((p) => ({
          id: p.id,
          merchant_id: p.merchant_id,
          product_id: p.product_id,
          category: p.category,
          discount_type: p.discount_type,
          value: p.value,
          discount_label: fmtDiscount(p),
        })),
      },
    })
    .select("id")
    .single();

  if (insErr) return errorJson(insErr.message, 400, "DB_ERROR");

  // Insert receipts to prevent duplicates if those promos later trigger promotion-notify.
  const notificationId = (inserted as any)?.id ?? null;
  const receiptRows = top.map((p) => ({ promotion_id: p.id, user_id: t.user_id, notification_id: notificationId }));
  const { error: recErr } = await svc
    .from("promotion_notification_receipts")
    .upsert(receiptRows as any, { onConflict: "promotion_id,user_id", ignoreDuplicates: true });
  if (recErr) {
    // Non-fatal: notification already created.
    return json({ ok: true, seeded: top.length, warning: recErr.message }, 200, corsHeaders);
  }

  return json({ ok: true, seeded: top.length, notification_id: notificationId }, 200, corsHeaders);
  }),
);
