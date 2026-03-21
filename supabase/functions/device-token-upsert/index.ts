import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { errorJson, json } from "../_shared/json.ts";
import { createServiceClient, requireUser } from "../_shared/supabase.ts";
import { withRequestContext } from "../_shared/requestContext.ts";

type Payload = {
  token: string;
  platform: "android" | "ios" | "web";
  device_id: string;
  app_version?: string | null;
};

serve((req) =>
  withRequestContext('device-token-upsert', req, async (_ctx) => {
  if (req.method !== "POST") return errorJson("Method not allowed", 405);

  const { user, error } = await requireUser(req);
  if (!user) return errorJson(error ?? "Unauthorized", 401, "UNAUTHORIZED");

  const body = (await req.json().catch(() => ({}))) as Partial<Payload>;
  const token = (body.token ?? "").trim();
  const platform = body.platform as Payload["platform"];
  const deviceId = (body.device_id ?? '').trim();

  if (!token || !platform || !deviceId) return errorJson("Missing token, platform, or device_id", 400, "INVALID_PAYLOAD");
  if (!["android", "ios", "web"].includes(platform)) return errorJson("Invalid platform", 400, "INVALID_PLATFORM");

  const svc = createServiceClient();

  await svc
    .from('device_tokens')
    .update({
      enabled: false,
      disabled_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('token', token)
    .eq('platform', platform)
    .neq('device_id', deviceId);

  const upsertRow = {
    user_id: user.id,
    token,
    platform,
    device_id: deviceId,
    app_version: body.app_version ?? null,
    enabled: true,
    disabled_at: null,
    last_seen_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const { data, error: dbErr } = await svc
    .from("device_tokens")
    .upsert(upsertRow, { onConflict: "device_id" })
    .select("id,user_id,platform,device_id,app_version,enabled,last_seen_at,updated_at")
    .single();

  if (dbErr) return errorJson(dbErr.message, 400, "DB_ERROR");

  return json({ ok: true, device_token: data });
  }),
);
