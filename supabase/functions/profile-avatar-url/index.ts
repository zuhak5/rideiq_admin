import { createServiceClient, createUserClient, requireUser } from '../_shared/supabase.ts';
import { errorJson, json } from '../_shared/json.ts';
import { withRequestContext } from '../_shared/requestContext.ts';

type Body =
  | { action: 'upload'; ext?: string; content_type?: string; set_profile?: boolean }
  | { action: 'download'; object_key: string; expires_in?: number };

function sanitizeExt(ext?: string) {
  const e = (ext ?? 'png').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!e || e.length > 8) return 'png';
  return e;
}

Deno.serve((req) =>
  withRequestContext('profile-avatar-url', req, async (_ctx) => {

  if (req.method !== 'POST') return errorJson('Method not allowed', 405);

  const { user, error: authError } = await requireUser(req);
  if (!user) return errorJson(String(authError ?? 'Unauthorized'), 401, 'UNAUTHORIZED');

  const body = (await req.json()) as Body;
  // Use user-scoped client for RLS-protected reads/writes.
  const authed = createUserClient(req);
  // Use service role for Storage signing to avoid relying on `storage.objects` policies (which can be brittle across
  // local/dev images due to table ownership constraints).
  const svc = createServiceClient();

  if (body.action === 'upload') {
    const ext = sanitizeExt(body.ext);
    const objectKey = `${user.id}/avatar_${crypto.randomUUID()}.${ext}`;

    const { data, error } = await svc.storage.from('avatars').createSignedUploadUrl(objectKey);
    if (error || !data) return errorJson(error?.message ?? 'Failed to create signed upload url', 400, 'STORAGE_ERROR');

    // Optional: set profile to point at the new object key
    if (body.set_profile) {
      const { error: upErr } = await authed.from('profiles').update({ avatar_object_key: objectKey }).eq('id', user.id);
      if (upErr) return errorJson(upErr.message, 400, 'DB_ERROR');
    }

    return json({ bucket: 'avatars', object_key: objectKey, ...data });
  }

  if (body.action === 'download') {
    const expiresIn = Math.max(10, Math.min(60 * 60, Math.trunc(body.expires_in ?? 60)));
    // Only allow user to sign their own avatar path (folder == user id)
    const folder = body.object_key.split('/')[0];
    if (folder !== user.id) return errorJson('Forbidden', 403, 'FORBIDDEN');

    const { data, error } = await svc.storage.from('avatars').createSignedUrl(body.object_key, expiresIn);
    if (error || !data) return errorJson(error?.message ?? 'Failed to create signed url', 400, 'STORAGE_ERROR');

    return json({ bucket: 'avatars', object_key: body.object_key, signedUrl: data.signedUrl, expires_in: expiresIn });
  }

  return errorJson('Invalid payload', 400);
  }),
);
