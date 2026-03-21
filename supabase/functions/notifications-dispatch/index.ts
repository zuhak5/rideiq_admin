import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { errorJson, json } from "../_shared/json.ts";
import { createServiceClient } from "../_shared/supabase.ts";
import { requireCronSecret } from "../_shared/cronAuth.ts";
import { withRequestContext } from "../_shared/requestContext.ts";
import { sendFcmMessage } from "../_shared/firebaseMessaging.ts";

async function updateCampaignRecipientStatus(
  svc: ReturnType<typeof createServiceClient>,
  notificationId: string,
  status: 'sent' | 'failed' | 'skipped' | 'suppressed',
  reason?: string,
) {
  const { data } = await svc
    .from('notification_campaign_recipients')
    .select('id,campaign_id')
    .eq('user_notification_id', notificationId)
    .maybeSingle();
  if (!data) {
    return;
  }

  const patch: Record<string, unknown> = {
    push_status: status,
    push_reason: reason ?? null,
  };
  if (status === 'sent') {
    patch.push_sent_at = new Date().toISOString();
  }
  if (status === 'failed') {
    patch.push_failed_at = new Date().toISOString();
  }

  await svc
    .from('notification_campaign_recipients')
    .update(patch)
    .eq('id', (data as any).id);

  if (status === 'sent') {
    await svc
      .from('notification_campaigns')
      .update({ push_sent: (await currentNumericStat(svc, String((data as any).campaign_id), 'push_sent')) + 1 })
      .eq('id', String((data as any).campaign_id));
  } else if (status === 'failed') {
    await svc
      .from('notification_campaigns')
      .update({ push_failed: (await currentNumericStat(svc, String((data as any).campaign_id), 'push_failed')) + 1 })
      .eq('id', String((data as any).campaign_id));
  }
}

async function currentNumericStat(
  svc: ReturnType<typeof createServiceClient>,
  campaignId: string,
  field: 'push_sent' | 'push_failed',
) {
  const { data } = await svc
    .from('notification_campaigns')
    .select(field)
    .eq('id', campaignId)
    .maybeSingle();
  return Number((data as any)?.[field] ?? 0);
}

type Body = { limit?: number };

serve((req) =>
  withRequestContext('notifications-dispatch', req, async (_ctx) => {
  if (req.method !== "POST") return errorJson("Method not allowed", 405);

  const auth = requireCronSecret(req);
  if (auth) return auth;

  const body = (await req.json().catch(() => ({}))) as Body;
  const limit = Math.max(1, Math.min(200, Number(body.limit ?? 50)));

  const svc = createServiceClient();
  const lockId = crypto.randomUUID();

  const { data: outbox, error } = await svc.rpc("notification_outbox_claim", { p_limit: limit, p_lock_id: lockId });
  if (error) return errorJson(error.message, 400, "DB_ERROR");

  const items = (outbox ?? []) as any[];
  const tokenIds = Array.from(
    new Set(items.map((item) => Number(item.device_token_id)).filter((value) => Number.isFinite(value))),
  );
  const { data: tokenRows, error: tokenError } = tokenIds.length > 0
    ? await svc
        .from('device_tokens')
        .select('id,token,platform,enabled,disabled_at')
        .in('id', tokenIds)
    : { data: [], error: null as any };
  if (tokenError) return errorJson(tokenError.message, 400, "DB_ERROR");

  const tokensById = new Map((tokenRows ?? []).map((row: any) => [Number(row.id), row]));

  let sent = 0;
  let failed = 0;

  for (const item of items) {
    try {
      const tokenRow = tokensById.get(Number(item.device_token_id));
      if (!tokenRow || !tokenRow.enabled || tokenRow.disabled_at) {
        await svc.rpc("notification_outbox_mark", {
          p_outbox_id: item.id,
          p_status: "skipped",
          p_error: "device_token_disabled_or_missing",
        });
        await updateCampaignRecipientStatus(svc, String(item.notification_id), 'skipped', 'device_token_disabled_or_missing');
        continue;
      }

      const payloadData = item.payload?.data && typeof item.payload.data === 'object'
        ? { ...item.payload.data }
        : {};
      const resp = await sendFcmMessage({
        registrationToken: String(tokenRow.token),
        platform: String(tokenRow.platform) as 'android' | 'ios' | 'web',
        title: item.payload?.title ? String(item.payload.title) : null,
        body: item.payload?.body ? String(item.payload.body) : null,
        data: {
          ...payloadData,
          notification_id: String(item.notification_id),
          kind: item.payload?.type ? String(item.payload.type) : '',
        },
      });

      if (resp.ok) {
        await svc.rpc("notification_outbox_mark", { p_outbox_id: item.id, p_status: "sent" });
        await updateCampaignRecipientStatus(svc, String(item.notification_id), 'sent');
        sent++;
      } else {
        if (resp.disableToken) {
          await svc
            .from('device_tokens')
            .update({
              enabled: false,
              disabled_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq('id', Number(item.device_token_id));
        }
        if (resp.disableToken) {
          await svc.rpc("notification_outbox_mark", {
            p_outbox_id: item.id,
            p_status: "skipped",
            p_error: "invalid_registration_token",
          });
        } else {
          await svc.rpc("notification_outbox_mark", {
            p_outbox_id: item.id,
            p_status: "failed",
            p_error: `push_failed:${String(resp.errorText ?? '').slice(0, 400)}`,
            p_retry_seconds: 120,
          });
        }
        await updateCampaignRecipientStatus(
          svc,
          String(item.notification_id),
          resp.disableToken ? 'skipped' : 'failed',
          resp.disableToken ? 'invalid_registration_token' : String(resp.errorText ?? '').slice(0, 300),
        );
        if (!resp.disableToken) {
          failed++;
        }
      }
    } catch (e) {
      await svc.rpc("notification_outbox_mark", {
        p_outbox_id: item.id,
        p_status: "failed",
        p_error: `exception:${String(e).slice(0, 400)}`,
        p_retry_seconds: 120,
      });
      await updateCampaignRecipientStatus(
        svc,
        String(item.notification_id),
        'failed',
        `exception:${String(e).slice(0, 300)}`,
      );
      failed++;
    }
  }

  return json({ ok: true, claimed: items.length, sent, failed, lock_id: lockId });
  }),
);
