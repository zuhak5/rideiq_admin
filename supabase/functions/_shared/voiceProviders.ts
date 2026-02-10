import { envTrim } from './config.ts';

// NOTE: Supabase Edge Functions (Deno) must be able to statically analyze npm dependencies.
// Dynamic imports like `await import(variable)` are not reliably bundled, which can surface as:
// "Could not find constraint '<pkg>' in the list of packages" at runtime.
//
// Agora recommends using the `agora-token` NPM package for token generation.
// Version is pinned to keep builds deterministic.
// (The older `agora-access-token` package is deprecated.)
import * as AgoraTokenNS from 'npm:agora-token@2.0.5';

export type VoiceProvider = 'agora' | 'daily';

export type AgoraJoinInfo = {
  provider: 'agora';
  appId: string;
  channel: string;
  userAccount: string;
  token: string;
  expiresAt: number; // unix seconds
};

export type DailyJoinInfo = {
  provider: 'daily';
  roomName: string;
  roomUrl: string;
  token: string;
  expiresAt: number; // unix seconds
};

export type VoiceJoinInfo = AgoraJoinInfo | DailyJoinInfo;

function requiredEnv(key: string): string {
  const v = envTrim(key);
  if (!v) throw new Error(`Missing required env var: ${key}`);
  return v;
}

function getAgoraModule(): any {
  // Deno may wrap CommonJS npm modules in a `default` export.
  const ns: any = AgoraTokenNS as any;
  return ns?.default ?? ns;
}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit & { timeoutMs?: number } = {}) {
  const { timeoutMs = 10_000, ...rest } = init;
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...rest, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

async function safeJson(text: string): Promise<unknown> {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

/**
 * Generates an Agora RTC token server-side.
 *
 * NOTE: We use the official Agora token builder package via `npm:` import.
 * If their API changes, we try several common call signatures.
 */
export async function buildAgoraRtcToken(params: {
  channel: string;
  userAccount: string;
  expiresInSeconds?: number;
}): Promise<AgoraJoinInfo> {
  const appId = requiredEnv('AGORA_APP_ID');
  const appCertificate = requiredEnv('AGORA_APP_CERTIFICATE');
  const expiresInSeconds = params.expiresInSeconds ?? 60 * 30;
  const expiresAt = nowSec() + expiresInSeconds;

  const mod: any = getAgoraModule();
  const RtcTokenBuilder = mod?.RtcTokenBuilder ?? mod?.RtcTokenBuilder2;
  const Role = mod?.RtcRole ?? mod?.RtcRoleType ?? mod?.RtcRoleEnum ?? mod?.Role;
  const PUBLISHER = Role?.PUBLISHER ?? Role?.Publisher ?? Role?.publisher ?? 1;

  if (!RtcTokenBuilder) throw new Error('Agora token builder not available (missing RtcTokenBuilder export)');

  // Try the most common signatures found in Agora node examples.
  const variants: Array<() => string> = [];

  // 1) buildTokenWithAccount(appId, cert, channel, account, role, expireSeconds)
  if (typeof RtcTokenBuilder.buildTokenWithAccount === 'function') {
    variants.push(() => RtcTokenBuilder.buildTokenWithAccount(appId, appCertificate, params.channel, params.userAccount, PUBLISHER, expiresInSeconds));
    // Some builders want absolute unix time
    variants.push(() => RtcTokenBuilder.buildTokenWithAccount(appId, appCertificate, params.channel, params.userAccount, PUBLISHER, expiresAt));
  }

  // 2) buildTokenWithUid(appId, cert, channel, uid, role, expireSeconds)
  if (typeof RtcTokenBuilder.buildTokenWithUid === 'function') {
    variants.push(() => RtcTokenBuilder.buildTokenWithUid(appId, appCertificate, params.channel, 0, PUBLISHER, expiresInSeconds));
    variants.push(() => RtcTokenBuilder.buildTokenWithUid(appId, appCertificate, params.channel, 0, PUBLISHER, expiresAt));
  }

  // 3) buildTokenWithUserAccount(appId, cert, channel, account, role, expireSeconds)
  if (typeof RtcTokenBuilder.buildTokenWithUserAccount === 'function') {
    variants.push(() => RtcTokenBuilder.buildTokenWithUserAccount(appId, appCertificate, params.channel, params.userAccount, PUBLISHER, expiresInSeconds));
    variants.push(() => RtcTokenBuilder.buildTokenWithUserAccount(appId, appCertificate, params.channel, params.userAccount, PUBLISHER, expiresAt));
  }

  let lastErr: unknown;
  for (const v of variants) {
    try {
      const token = v();
      if (typeof token === 'string' && token.length > 20) {
        return {
          provider: 'agora',
          appId,
          channel: params.channel,
          userAccount: params.userAccount,
          token,
          expiresAt,
        };
      }
      lastErr = new Error('Token builder returned an unexpected value');
    } catch (e) {
      lastErr = e;
    }
  }

  throw (lastErr instanceof Error ? lastErr : new Error(String(lastErr))) ?? new Error('Failed to build Agora token');
}

export async function createDailyRoom(params: {
  roomName: string;
  timeoutMs?: number;
}): Promise<{ roomName: string; roomUrl: string }> {
  const apiKey = requiredEnv('DAILY_API_KEY');

  const res = await fetchWithTimeout('https://api.daily.co/v1/rooms', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({
      name: params.roomName,
      privacy: 'private',
      properties: {
        start_video_off: true,
      },
    }),
    timeoutMs: params.timeoutMs ?? 10_000,
  });

  const data = await safeJson(await res.text());
  if (!res.ok) throw new Error(`Daily create room failed: HTTP ${res.status} ${JSON.stringify(data)}`);

  const url = typeof data === 'object' && data !== null ? (data as any).url : undefined;
  if (!url || typeof url !== 'string') throw new Error('Daily create room: missing url');
  return { roomName: params.roomName, roomUrl: url };
}

export async function createDailyMeetingToken(params: {
  roomName: string;
  userId: string;
  userName?: string;
  isOwner?: boolean;
  expiresInSeconds?: number;
  timeoutMs?: number;
}): Promise<DailyJoinInfo> {
  const apiKey = requiredEnv('DAILY_API_KEY');
  const expiresInSeconds = params.expiresInSeconds ?? 60 * 30;
  const expiresAt = nowSec() + expiresInSeconds;

  const res = await fetchWithTimeout('https://api.daily.co/v1/meeting-tokens', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({
      properties: {
        room_name: params.roomName,
        user_id: params.userId,
        ...(params.userName ? { user_name: params.userName } : {}),
        ...(params.isOwner ? { is_owner: true } : {}),
        exp: expiresAt,
        start_video_off: true,
      },
    }),
    timeoutMs: params.timeoutMs ?? 10_000,
  });

  const data = await safeJson(await res.text());
  if (!res.ok) throw new Error(`Daily meeting token failed: HTTP ${res.status} ${JSON.stringify(data)}`);
  const token = typeof data === 'object' && data !== null ? (data as any).token : undefined;
  if (!token || typeof token !== 'string') throw new Error('Daily meeting token: missing token');

  // Room URL is not returned by /meeting-tokens; the caller should look it up from the call record.
  return {
    provider: 'daily',
    roomName: params.roomName,
    roomUrl: '',
    token,
    expiresAt,
  };
}
