import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { errorJson, json } from "../_shared/json.ts";
import { createServiceClient } from "../_shared/supabase.ts";
import { requireWebhookSecret } from "../_shared/webhookAuth.ts";
import { withRequestContext } from "../_shared/requestContext.ts";

/**
 * Outbox dispatcher (event-driven)
 *
 * Trigger this function using a Supabase Database Webhook on:
 * - public.notification_outbox (INSERT)
 *
 * Design constraints:
 * - No cron jobs for this pipeline.
 * - Use a shared secret header (x-webhook-secret) with verify_jwt=false.
 *
 * Env vars:
 * - DISPATCH_WEBHOOK_SECRET (required)
 * - PUSH_WEBHOOK_URL (optional; if unset, outbox rows will be marked failed)
 * - PUSH_WEBHOOK_TOKEN (optional)
 */

async function postJson(url: string, payload: unknown, token?: string) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, text };
}

type Body = { limit?: number };

serve((req) =>
  withRequestContext('notifications-dispatch', req, async (_ctx) => {
  if (req.method !== "POST") return errorJson("Method not allowed", 405);

  const auth = requireWebhookSecret(req, "DISPATCH_WEBHOOK_SECRET", "x-webhook-secret");
  if (auth) return auth;

  const body = (await req.json().catch(() => ({}))) as Body;
  const limit = Math.max(1, Math.min(200, Number(body.limit ?? 50)));

  const svc = createServiceClient();
  const lockId = crypto.randomUUID();

  const { data: outbox, error } = await svc.rpc("notification_outbox_claim", { p_limit: limit, p_lock_id: lockId });
  if (error) return errorJson(error.message, 400, "DB_ERROR");

  const items = (outbox ?? []) as any[];
  const pushUrl = (Deno.env.get("PUSH_WEBHOOK_URL") ?? "").trim();
  const pushToken = (Deno.env.get("PUSH_WEBHOOK_TOKEN") ?? "").trim();

  let sent = 0;
  let failed = 0;

  for (const item of items) {
    try {
      if (!pushUrl) {
        await svc.rpc("notification_outbox_mark", {
          p_outbox_id: item.id,
          p_status: "failed",
          p_error: "PUSH_WEBHOOK_URL not configured",
          p_retry_seconds: 300,
        });
        failed++;
        continue;
      }

      const payload = {
        device_token_id: item.device_token_id,
        user_id: item.user_id,
        notification_id: item.notification_id,
        payload: item.payload,
      };

      const resp = await postJson(pushUrl, payload, pushToken || undefined);
      if (resp.ok) {
        await svc.rpc("notification_outbox_mark", { p_outbox_id: item.id, p_status: "sent" });
        sent++;
      } else {
        await svc.rpc("notification_outbox_mark", {
          p_outbox_id: item.id,
          p_status: "failed",
          p_error: `push_failed:${resp.status}:${resp.text.slice(0, 400)}`,
          p_retry_seconds: 120,
        });
        failed++;
      }
    } catch (e) {
      await svc.rpc("notification_outbox_mark", {
        p_outbox_id: item.id,
        p_status: "failed",
        p_error: `exception:${String(e).slice(0, 400)}`,
        p_retry_seconds: 120,
      });
      failed++;
    }
  }

  return json({ ok: true, claimed: items.length, sent, failed, lock_id: lockId });
  }),
);
