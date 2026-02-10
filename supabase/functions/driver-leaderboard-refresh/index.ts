import { errorJson, json } from "../_shared/json.ts";
import { createServiceClient } from "../_shared/supabase.ts";
import { requireCronSecret } from '../_shared/cronAuth.ts';
import { withRequestContext } from "../_shared/requestContext.ts";

type Body = { day?: string | null };

Deno.serve((req) =>
  withRequestContext('driver-leaderboard-refresh', req, async (_ctx) => {
  // Cron-protected endpoint
  const cronAuth = requireCronSecret(req);
  if (cronAuth) return cronAuth;

  if (req.method !== "POST") return errorJson("Method not allowed", 405, "METHOD_NOT_ALLOWED");

  let body: Body = {};
  try {
    body = (await req.json()) as Body;
  } catch {
    // allow empty
  }

  const day = body.day ? body.day : null;

  const svc = createServiceClient();
  const { error: dbErr } = await svc.rpc("driver_leaderboard_refresh_day", { p_day: day });
  if (dbErr) return errorJson(dbErr.message, 400, "DB_ERROR");

  return json({ ok: true });
  }),
);
