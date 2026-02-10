// Lightweight HMAC-signed token for anonymous telemetry.
//
// Design goals
// - Avoid requiring end-user auth for public pages (e.g., share links).
// - Prevent trivial spoofing of usage logs.
// - Keep implementation small and deterministic (no dependency on JWT libraries).

export type TelemetryTokenPayloadV1 = {
  v: 1;
  request_id: string;
  capability: 'render';
  iat: number; // epoch seconds
  exp: number; // epoch seconds
  origin?: string | null;
};

function base64UrlEncode(bytes: Uint8Array): string {
  let str = '';
  for (const b of bytes) str += String.fromCharCode(b);
  const b64 = btoa(str);
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(input: string): Uint8Array {
  let s = input.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function hmacSha256(secret: string, msg: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, msg as BufferSource);
  return new Uint8Array(sig);
}

export async function issueTelemetryTokenV1(payload: TelemetryTokenPayloadV1, secret: string): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  const sig = await hmacSha256(secret, bytes);
  return `${base64UrlEncode(bytes)}.${base64UrlEncode(sig)}`;
}

export async function verifyTelemetryTokenV1(
  token: string,
  secret: string,
): Promise<{ ok: true; payload: TelemetryTokenPayloadV1 } | { ok: false; reason: string }> {
  const parts = token.split('.');
  if (parts.length !== 2) return { ok: false, reason: 'token_format' };
  const [p64, s64] = parts;
  if (!p64 || !s64) return { ok: false, reason: 'token_format' };

  let payloadBytes: Uint8Array;
  let sigBytes: Uint8Array;
  try {
    payloadBytes = base64UrlDecode(p64);
    sigBytes = base64UrlDecode(s64);
  } catch {
    return { ok: false, reason: 'token_decode' };
  }

  const expectedSig = await hmacSha256(secret, payloadBytes);
  if (!timingSafeEqual(sigBytes, expectedSig)) return { ok: false, reason: 'token_sig' };

  let payload: TelemetryTokenPayloadV1;
  try {
    payload = JSON.parse(new TextDecoder().decode(payloadBytes)) as TelemetryTokenPayloadV1;
  } catch {
    return { ok: false, reason: 'token_json' };
  }

  if (payload?.v !== 1) return { ok: false, reason: 'token_version' };
  if (payload?.capability !== 'render') return { ok: false, reason: 'token_capability' };
  if (typeof payload?.request_id !== 'string' || !payload.request_id) return { ok: false, reason: 'token_request_id' };
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload?.exp !== 'number' || payload.exp < now) return { ok: false, reason: 'token_expired' };
  if (typeof payload?.iat !== 'number' || payload.iat > now + 30) return { ok: false, reason: 'token_iat' };

  return { ok: true, payload };
}
