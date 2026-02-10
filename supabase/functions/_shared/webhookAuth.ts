import { envTrim } from './config.ts';
import { errorJson } from './json.ts';

export function requireWebhookSecret(req: Request, envName = 'WEBHOOK_SECRET', headerName = 'x-webhook-secret') {
  const expected = envTrim(envName);
  if (!expected) {
    return errorJson(`${envName} not configured`, 500, 'CONFIG_ERROR');
  }
  const got = (req.headers.get(headerName) ?? '').trim();
  if (!got || got !== expected) return errorJson('Unauthorized', 401, 'UNAUTHORIZED');
  return null;
}
