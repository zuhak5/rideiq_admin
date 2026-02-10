import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

import { errorJson, json } from "../_shared/json.ts";
import { createAnonClient, requireUser } from "../_shared/supabase.ts";
import { withRequestContext } from "../_shared/requestContext.ts";

type Body = { code?: string };

serve((req) =>
  withRequestContext('referral-claim', req, async (_ctx) => {

  if (req.method !== "POST") return errorJson("Method not allowed", 405, "METHOD_NOT_ALLOWED");

  const { user, error } = await requireUser(req);
  if (error || !user) return errorJson("Unauthorized", 401, "UNAUTHORIZED");

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return errorJson("Invalid JSON", 400, "BAD_JSON");
  }

  const code = (body.code ?? "").trim().toUpperCase();
  if (!code) return errorJson("code is required", 400, "VALIDATION_ERROR");

  const anon = createAnonClient(req);

  const { data, error: dbErr } = await anon.rpc("referral_claim", { p_code: code });
  if (dbErr) return errorJson(dbErr.message, 400, "DB_ERROR");

  return json({ ok: true, result: data });
  }),
);
