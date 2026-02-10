import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

import { errorJson, json } from "../_shared/json.ts";
import { createAnonClient, requireUser } from "../_shared/supabase.ts";
import { withRequestContext } from "../_shared/requestContext.ts";

type Body = {
  ride_id?: string;
  last_read_at?: string | null; // ISO
  last_read_message_id?: string | null;
};

serve((req) =>
  withRequestContext('ride-chat-mark-read', req, async (_ctx) => {

  if (req.method !== "POST") return errorJson("Method not allowed", 405, "METHOD_NOT_ALLOWED");

  const { user, error } = await requireUser(req);
  if (error || !user) return errorJson("Unauthorized", 401, "UNAUTHORIZED");

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return errorJson("Invalid JSON", 400, "BAD_JSON");
  }

  const rideId = (body.ride_id ?? "").trim();
  if (!rideId) return errorJson("ride_id is required", 400, "VALIDATION_ERROR");

  const anon = createAnonClient(req);

  // Hot-path state update (unread counters / receipts) should be atomic in the DB.
  const { data, error: rpcErr } = await anon.rpc("ride_chat_mark_read", {
    p_ride_id: rideId,
    p_last_read_at: body.last_read_at ? new Date(body.last_read_at).toISOString() : null,
    p_last_read_message_id: body.last_read_message_id ?? null,
  });

  if (rpcErr) {
    const msg = rpcErr.message ?? 'DB_ERROR';
    const code = msg.includes('not_a_participant') ? 'NOT_A_PARTICIPANT' : msg.includes('invalid_last_read_message') ? 'VALIDATION_ERROR' : 'DB_ERROR';
    const status = msg.includes('not_a_participant') ? 403 : msg.includes('invalid_last_read_message') ? 400 : 400;
    return errorJson(msg, status, code);
  }

  return json({ ok: true, receipt: (data as any)?.receipt ?? null });
  }),
);
