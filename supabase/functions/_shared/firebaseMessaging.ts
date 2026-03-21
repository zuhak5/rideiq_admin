type FirebaseServiceAccount = {
  project_id: string;
  client_email: string;
  private_key: string;
};

let cachedAccessToken: { token: string; expiresAt: number } | null = null;

function envTrim(key: string): string {
  return (Deno.env.get(key) ?? '').trim();
}

function decodePem(pkcs8Pem: string): Uint8Array {
  const normalized = pkcs8Pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s+/g, '');
  const binary = atob(normalized);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

function b64url(input: Uint8Array): string {
  const b64 = btoa(String.fromCharCode(...input));
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function encodeJson(value: Record<string, unknown>): string {
  return b64url(new TextEncoder().encode(JSON.stringify(value)));
}

function getServiceAccount(): FirebaseServiceAccount {
  const rawJson = envTrim('FIREBASE_SERVICE_ACCOUNT_JSON');
  if (rawJson) {
    const parsed = JSON.parse(rawJson) as FirebaseServiceAccount;
    if (parsed.project_id && parsed.client_email && parsed.private_key) {
      return parsed;
    }
  }

  const project_id = envTrim('FIREBASE_PROJECT_ID');
  const client_email = envTrim('FIREBASE_CLIENT_EMAIL');
  const private_key = (Deno.env.get('FIREBASE_PRIVATE_KEY') ?? '').replace(/\\n/g, '\n').trim();

  if (!project_id || !client_email || !private_key) {
    throw new Error('Firebase service account is not configured');
  }

  return {
    project_id,
    client_email,
    private_key,
  };
}

async function signServiceAccountJwt(account: FirebaseServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = encodeJson({ alg: 'RS256', typ: 'JWT' });
  const payload = encodeJson({
    iss: account.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  });
  const unsigned = `${header}.${payload}`;

  const key = await crypto.subtle.importKey(
    'pkcs8',
    decodePem(account.private_key),
    {
      name: 'RSASSA-PKCS1-v1_5',
      hash: 'SHA-256',
    },
    false,
    ['sign'],
  );

  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(unsigned),
  );

  return `${unsigned}.${b64url(new Uint8Array(signature))}`;
}

async function getAccessToken(): Promise<string> {
  const now = Date.now();
  if (cachedAccessToken && cachedAccessToken.expiresAt > now + 60_000) {
    return cachedAccessToken.token;
  }

  const account = getServiceAccount();
  const assertion = await signServiceAccountJwt(account);
  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion,
  });

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`google_oauth_failed:${res.status}:${text.slice(0, 400)}`);
  }

  const parsed = JSON.parse(text) as { access_token: string; expires_in?: number };
  const expiresInMs = Math.max(300, Number(parsed.expires_in ?? 3600)) * 1000;
  cachedAccessToken = {
    token: parsed.access_token,
    expiresAt: now + expiresInMs,
  };
  return parsed.access_token;
}

function toStringMap(input: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null) continue;
    if (typeof value === 'string') {
      out[key] = value;
      continue;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      out[key] = String(value);
      continue;
    }
    out[key] = JSON.stringify(value);
  }
  return out;
}

export type SendFcmArgs = {
  registrationToken: string;
  platform: 'android' | 'ios' | 'web';
  title: string | null;
  body: string | null;
  data: Record<string, unknown>;
};

export async function sendFcmMessage(args: SendFcmArgs): Promise<{
  ok: boolean;
  errorText?: string;
  disableToken?: boolean;
}> {
  const account = getServiceAccount();
  const accessToken = await getAccessToken();
  const webLink = envTrim('FIREBASE_WEB_PUSH_LINK') || '/notifications';

  const payload = {
    message: {
      token: args.registrationToken,
      notification:
        args.title || args.body
          ? {
              title: args.title ?? '',
              body: args.body ?? '',
            }
          : undefined,
      data: toStringMap(args.data),
      android: {
        priority: 'HIGH',
        notification: {
          channel_id: 'rideiq_general',
          sound: 'default',
        },
      },
      apns: {
        headers: {
          'apns-priority': '10',
          'apns-push-type': 'alert',
        },
        payload: {
          aps: {
            sound: 'default',
          },
        },
      },
      webpush: {
        notification: args.title || args.body
          ? {
              title: args.title ?? '',
              body: args.body ?? '',
              icon: '/icons/Icon-192.png',
            }
          : undefined,
        fcm_options: {
          link: webLink,
        },
      },
    },
  };

  const res = await fetch(
    `https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    },
  );

  const text = await res.text();
  if (res.ok) {
    return { ok: true };
  }

  const normalized = text.toLowerCase();
  const disableToken =
    normalized.includes('unregistered') ||
    normalized.includes('registration-token-not-registered') ||
    normalized.includes('invalid registration token') ||
    normalized.includes('requested entity was not found');

  return {
    ok: false,
    errorText: text.slice(0, 400),
    disableToken,
  };
}
