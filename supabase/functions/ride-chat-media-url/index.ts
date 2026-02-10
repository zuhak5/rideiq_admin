import { errorJson, json } from '../_shared/json.ts';
import { createServiceClient, createUserClient, requireUser } from '../_shared/supabase.ts';
import { withRequestContext } from '../_shared/requestContext.ts';

type Body = {
  action?: 'upload' | 'download';
  ride_id?: string;
  filename?: string | null;
  object_key?: string | null;
  expires_in?: number | null; // seconds
};

function safeExt(name: string) {
  const m = name.toLowerCase().match(/\.([a-z0-9]{1,8})$/);
  return m ? m[1] : 'bin';
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

export default Deno.serve((req) =>
  withRequestContext('ride-chat-media-url', req, async (ctx) => {
    if (req.method !== 'POST') return errorJson('Method not allowed', 405, 'METHOD_NOT_ALLOWED', undefined, ctx.headers);

    const { user, error } = await requireUser(req, ctx);
    if (error || !user) return errorJson('Unauthorized', 401, 'UNAUTHORIZED', undefined, ctx.headers);

    let body: Body;
    try {
      body = (await req.json()) as Body;
    } catch {
      return errorJson('Invalid JSON', 400, 'BAD_JSON', undefined, ctx.headers);
    }

    const action = body.action ?? 'upload';
    const rideId = (body.ride_id ?? '').trim();
    if (!rideId) return errorJson('ride_id is required', 400, 'VALIDATION_ERROR', undefined, ctx.headers);

    const authed = createUserClient(req);
    const svc = createServiceClient();

    // Ensure participant (RLS read)
    const { data: ride, error: rideErr } = await authed.from('rides').select('id').eq('id', rideId).maybeSingle();
    if (rideErr) return errorJson(rideErr.message, 400, 'DB_ERROR', undefined, ctx.headers);
    if (!ride) return errorJson('Ride not found', 404, 'RIDE_NOT_FOUND', undefined, ctx.headers);

    // Create / fetch chat thread (SECURITY DEFINER function enforces membership).
    // We store media under:
    //   threads/<thread_id>/...
    const { data: threadId, error: thrErr } = await authed.rpc('ride_chat_get_or_create_thread', { p_ride_id: rideId });
    if (thrErr || !threadId) return errorJson(thrErr?.message ?? 'Failed to resolve chat thread', 400, 'DB_ERROR', undefined, ctx.headers);

    if (action === 'upload') {
      const filename = (body.filename ?? 'upload.bin').trim() || 'upload.bin';
      const ext = safeExt(filename);

      const objectKey = `threads/${threadId}/${crypto.randomUUID()}.${ext}`;

      const { data, error: upErr } = await svc.storage.from('chat-media').createSignedUploadUrl(objectKey);
      if (upErr || !data) return errorJson(upErr?.message ?? 'Create signed upload URL failed', 400, 'STORAGE_ERROR', undefined, ctx.headers);

      return json({ ok: true, bucket: 'chat-media', object_key: objectKey, ...data }, 200, ctx.headers);
    }

    const objectKey = (body.object_key ?? '').trim();
    if (!objectKey) return errorJson('object_key is required for download', 400, 'VALIDATION_ERROR', undefined, ctx.headers);
    if (objectKey.length > 1024) return errorJson('object_key too long', 400, 'VALIDATION_ERROR', undefined, ctx.headers);

    // Verify the object belongs to a message in this ride (RLS-protected).
    // This is defense-in-depth on top of the server-side checks that gate URL signing.
    const { data: msg, error: mErr } = await authed
      .from('ride_chat_messages')
      .select('id,ride_id,attachment_key')
      .eq('ride_id', rideId)
      .eq('attachment_key', objectKey)
      .limit(1)
      .maybeSingle();

    if (mErr) return errorJson(mErr.message, 400, 'DB_ERROR', undefined, ctx.headers);
    if (!msg) return errorJson('Not found', 404, 'NOT_FOUND', undefined, ctx.headers);

    const expiresIn = clamp(Number(body.expires_in ?? 3600), 60, 60 * 60 * 24);

    const { data, error: sErr } = await svc.storage.from('chat-media').createSignedUrl(objectKey, expiresIn);
    if (sErr || !data) return errorJson(sErr?.message ?? 'Create signed URL failed', 400, 'STORAGE_ERROR', undefined, ctx.headers);

    return json({ ok: true, bucket: 'chat-media', object_key: objectKey, signedUrl: data.signedUrl, expires_in: expiresIn }, 200, ctx.headers);
  }),
);
