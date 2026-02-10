import { errorJson } from './json.ts';

function extractProvidedSecret(req: Request): string {
  const raw = (req.headers.get('x-cron-secret') ?? req.headers.get('authorization') ?? '').trim();
  if (!raw) return '';
  return raw.toLowerCase().startsWith('bearer ') ? raw.slice('bearer '.length).trim() : raw;
}

/**
 * Require CRON_SECRET for maintenance endpoints.
 *
 * Best practice: keep `verify_jwt = false` for cron/webhook endpoints and
 * authorize using a shared secret header.
 */
export function requireCronSecret(req: Request): Response | null {
  const expected = (Deno.env.get('CRON_SECRET') ?? '').trim();
  if (!expected) {
    return errorJson('CRON_SECRET is not configured', 500, 'CRON_SECRET_MISSING');
  }

  const got = extractProvidedSecret(req);
  if (!got || got !== expected) {
    return errorJson('Unauthorized', 401, 'UNAUTHORIZED');
  }

  return null;
}
