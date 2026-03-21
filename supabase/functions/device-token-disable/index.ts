import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { errorJson, json } from '../_shared/json.ts';
import { createAnonClient, requireUser } from '../_shared/supabase.ts';
import { withRequestContext } from '../_shared/requestContext.ts';

type Payload = {
  device_id?: string | null;
  token?: string | null;
};

serve((req) =>
  withRequestContext('device-token-disable', req, async (_ctx) => {
    if (req.method !== 'POST') return errorJson('Method not allowed', 405, 'METHOD_NOT_ALLOWED');

    const { user, error } = await requireUser(req);
    if (!user) return errorJson(error ?? 'Unauthorized', 401, 'UNAUTHORIZED');

    const body = (await req.json().catch(() => ({}))) as Payload;
    const deviceId = String(body.device_id ?? '').trim();
    const token = String(body.token ?? '').trim();
    if (!deviceId && !token) {
      return errorJson('Missing device_id or token', 400, 'INVALID_PAYLOAD');
    }

    const anon = createAnonClient(req);
    let query = anon
      .from('device_tokens')
      .update({
        enabled: false,
        disabled_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', user.id);

    if (deviceId) {
      query = query.eq('device_id', deviceId);
    } else {
      query = query.eq('token', token);
    }

    const { data, error: dbErr } = await query.select('id,device_id,token').maybeSingle();
    if (dbErr) return errorJson(dbErr.message, 400, 'DB_ERROR');

    return json({ ok: true, device_token: data ?? null });
  }),
);
