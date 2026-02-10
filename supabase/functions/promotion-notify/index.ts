import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { corsHeaders} from "../_shared/cors.ts";
import { errorJson, json } from "../_shared/json.ts";
import { createServiceClient } from "../_shared/supabase.ts";
import { requireWebhookSecret } from "../_shared/webhookAuth.ts";
import { withRequestContext } from "../_shared/requestContext.ts";

/**
 * promotion-notify
 *
 * Triggered by a Supabase Database Webhook on:
 * - public.merchant_promotions (INSERT, UPDATE)
 *
 * It finds interested users (public.user_interest_targets) and creates
 * public.user_notifications (push + in-app) in Iraqi Arabic.
 *
 * IMPORTANT: configure a second database webhook on public.notification_outbox
 * (INSERT) to call notifications-dispatch, so delivery happens without cron.
 */

type WebhookPayload<T> =
  | { type: "INSERT" | "UPDATE" | "DELETE"; table: string; schema: string; record: T | null; old_record: T | null }
  | Record<string, unknown>;

type Promotion = {
  id: string;
  merchant_id: string;
  product_id: string | null;
  discount_type: "percent" | "fixed_iqd" | string;
  value: number;
  starts_at: string | null;
  ends_at: string | null;
  is_active: boolean;
  category: string | null;
  metadata: Record<string, unknown>;
};

function nowIso() {
  return new Date().toISOString();
}

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

serve((req) =>
  withRequestContext('promotion-notify', req, async (_ctx) => {
  if (req.method !== "POST") return errorJson("Method not allowed", 405);

  // Shared-secret auth (best practice for webhook endpoints; verify_jwt=false)
  const auth = requireWebhookSecret(req, "PROMOTION_WEBHOOK_SECRET", "x-webhook-secret");
  if (auth) return auth;

  const payload = (await req.json().catch(() => ({}))) as WebhookPayload<Promotion>;

  const type = (payload as any)?.type;
  const record = (payload as any)?.record ?? (payload as any)?.promotion ?? null;
  if (!record || typeof record !== "object") {
    return errorJson("Missing promotion record", 400, "BAD_REQUEST");
  }

  const promo = record as Promotion;
  if (!promo.id || !promo.merchant_id) return errorJson("Invalid record", 400, "BAD_REQUEST");

  if (type === "DELETE") return json({ ok: true, ignored: true, reason: "DELETE" }, 200, corsHeaders);
  if (!isWithinWindow(promo)) return json({ ok: true, ignored: true, reason: "inactive_or_out_of_window" }, 200, corsHeaders);

  const svc = createServiceClient();

  const [{ data: merchant }, { data: product }] = await Promise.all([
    svc.from("merchants").select("id,business_name").eq("id", promo.merchant_id).maybeSingle(),
    promo.product_id ? svc.from("merchant_products").select("id,name,category").eq("id", promo.product_id).maybeSingle() : Promise.resolve({ data: null as any }),
  ]);

  const merchantName = (merchant as any)?.business_name ?? "المتجر";
  const productName = (product as any)?.name ?? null;
  const category = promo.category ?? (product as any)?.category ?? null;

  const queries = [];

  queries.push(
    svc
      .from("user_interest_targets")
      .select("user_id,kind,merchant_id,product_id,category,keyword,notify_push,notify_inapp,max_per_week")
      .eq("enabled", true)
      .eq("kind", "merchant")
      .eq("merchant_id", promo.merchant_id),
  );

  if (promo.product_id) {
    queries.push(
      svc
        .from("user_interest_targets")
        .select("user_id,kind,merchant_id,product_id,category,keyword,notify_push,notify_inapp,max_per_week")
        .eq("enabled", true)
        .eq("kind", "product")
        .eq("product_id", promo.product_id),
    );
  }

  if (category) {
    queries.push(
      svc
        .from("user_interest_targets")
        .select("user_id,kind,merchant_id,product_id,category,keyword,notify_push,notify_inapp,max_per_week")
        .eq("enabled", true)
        .eq("kind", "category")
        .eq("category", category),
    );
  }

  const results = await Promise.all(queries);
  const allTargets: any[] = [];
  for (const r of results) {
    if (r.error) return errorJson(r.error.message, 400, "DB_ERROR");
    allTargets.push(...(r.data ?? []));
  }

  // Keyword targets (best-effort): filter in-memory to avoid slow ILIKE in DB for v1.
  const { data: keywordTargets, error: kwErr } = await svc
    .from("user_interest_targets")
    .select("user_id,kind,keyword,notify_push,notify_inapp,max_per_week")
    .eq("enabled", true)
    .eq("kind", "keyword");
  if (kwErr) return errorJson(kwErr.message, 400, "DB_ERROR");

  const hay = `${merchantName} ${(productName ?? "")} ${(category ?? "")}`.toLowerCase();
  for (const t of keywordTargets ?? []) {
    const kw = String((t as any).keyword ?? "").trim().toLowerCase();
    if (kw && hay.includes(kw)) allTargets.push(t as any);
  }

  // Build per-user effective preferences across matching targets.
  // Policy:
  // - push: enabled if ANY matching target has notify_push=true
  // - inapp: enabled if ANY matching target has notify_inapp=true
  // - weekly cap: minimum max_per_week across matching targets (default 2)
  const prefsByUser = new Map<string, { push: boolean; inapp: boolean; maxPerWeek: number }>();
  for (const t of allTargets) {
    const uid = String((t as any).user_id ?? '').trim();
    if (!uid) continue;
    const cur = prefsByUser.get(uid) ?? { push: false, inapp: false, maxPerWeek: 2 };
    const np = Boolean((t as any).notify_push);
    const ni = Boolean((t as any).notify_inapp);
    const mwRaw = (t as any).max_per_week;
    const mw = Number.isFinite(Number(mwRaw)) ? Math.max(0, Math.floor(Number(mwRaw))) : 2;
    cur.push = cur.push || np;
    cur.inapp = cur.inapp || ni;
    cur.maxPerWeek = Math.min(cur.maxPerWeek, mw);
    prefsByUser.set(uid, cur);
  }

  const userIds = Array.from(prefsByUser.keys());
  if (userIds.length === 0) return json({ ok: true, notified: 0, reason: "no_matching_targets" }, 200, corsHeaders);

  const discount = fmtDiscount(promo);
  const itemLabel = productName ? `على ${productName}` : category ? `على ${category}` : "على هواية مواد";
  const bodyText = `🔥 خصم جديد من ${merchantName}: ${discount} ${itemLabel}. شوف التفاصيل هسه.`;

  let created = 0;
  let skipped = 0;

  const weekAgoIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  for (const uid of userIds) {
    const prefs = prefsByUser.get(uid) ?? { push: false, inapp: false, maxPerWeek: 2 };

    const { error: rErr } = await svc
      .from("promotion_notification_receipts")
      .insert({ promotion_id: promo.id, user_id: uid })
      .select()
      .maybeSingle();

    if (rErr) {
      const msg = String(rErr.message ?? "");
      if (msg.toLowerCase().includes("duplicate") || msg.includes("23505")) {
        skipped++;
        continue;
      }
      return errorJson(rErr.message, 400, "DB_ERROR");
    }

    // If user disabled both channels for this match, record receipt but don't create notification.
    if (!prefs.push && !prefs.inapp) {
      skipped++;
      continue;
    }

    // Weekly cap enforcement (best-effort).
    if (prefs.maxPerWeek === 0) {
      skipped++;
      continue;
    }
    const { count: recentCount, error: cntErr } = await svc
      .from('user_notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', uid)
      .eq('kind', 'promo')
      .gte('created_at', weekAgoIso);
    if (cntErr) return errorJson(cntErr.message, 400, 'DB_ERROR');
    if ((recentCount ?? 0) >= prefs.maxPerWeek) {
      skipped++;
      continue;
    }

    const readAt = prefs.inapp ? null : nowIso();

    const { data: notif, error: nErr } = await svc
      .from('user_notifications')
      .insert({
        user_id: uid,
        kind: 'promo',
        title: 'خصم جديد',
        body: bodyText,
        data: {
          promotion_id: promo.id,
          merchant_id: promo.merchant_id,
          merchant_name: merchantName,
          product_id: promo.product_id,
          product_name: productName,
          category,
          discount_type: promo.discount_type,
          value: promo.value,
          push: prefs.push,
          inapp: prefs.inapp,
          created_at: nowIso(),
        },
        read_at: readAt,
      })
      .select('id')
      .single();

    if (nErr) return errorJson(nErr.message, 400, 'DB_ERROR');

    await svc
      .from('promotion_notification_receipts')
      .update({ notification_id: notif.id })
      .eq('promotion_id', promo.id)
      .eq('user_id', uid);

    created++;
  }

  return json({ ok: true, promotion_id: promo.id, candidates: userIds.length, created, skipped }, 200, corsHeaders);
  }),
);
