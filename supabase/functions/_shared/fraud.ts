import { getClientIp } from './rateLimit.ts';
import { hmacSha256Bytes } from './crypto.ts';
import { createServiceClient } from './supabase.ts';

export type FraudSubjectKind = 'user' | 'driver' | 'device' | 'ip_prefix';

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Privacy-aware IP prefix bucketing.
 * - IPv4: /24 (a.b.c.0/24)
 * - IPv6: /64 (first 4 hextets ::/64)
 */
export function ipPrefix(ip: string | null): string | null {
  if (!ip) return null;
  const v = ip.trim();
  if (!v) return null;

  if (v.includes('.')) {
    const parts = v.split('.');
    if (parts.length >= 3) return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
    return null;
  }
  if (v.includes(':')) {
    const parts = v.split(':').filter((p) => p.length > 0);
    const head = parts.slice(0, 4).join(':');
    return `${head}::/64`;
  }
  return null;
}

/**
 * Compute a privacy-aware device fingerprint:
 * - HMAC-SHA256 over canonical, low-risk headers
 * - Stores only the hash; never raw values.
 */
export async function computeDeviceHash(req: Request): Promise<string | null> {
  const secret = (Deno.env.get('FRAUD_FINGERPRINT_HMAC_KEY') ?? '').trim();
  if (!secret) return null;

  const fields: Array<[string, string]> = [
    ['user-agent', req.headers.get('user-agent') ?? ''],
    ['accept-language', req.headers.get('accept-language') ?? ''],
    ['sec-ch-ua', req.headers.get('sec-ch-ua') ?? ''],
    ['sec-ch-ua-platform', req.headers.get('sec-ch-ua-platform') ?? ''],
    // Optional app-provided stable ID (not persisted raw; only hashed).
    ['x-device-id', req.headers.get('x-device-id') ?? ''],
    ['x-app-version', req.headers.get('x-app-version') ?? ''],
  ];

  const input = fields.map(([k, v]) => `${k}:${String(v).trim()}`).join('\n');
  const sig = await hmacSha256Bytes(secret, input);
  return toHex(sig);
}

export function expiresIso(minutes: number): string {
  const ms = Math.max(0, minutes) * 60 * 1000;
  return new Date(Date.now() + ms).toISOString();
}

export function subjectKey(kind: FraudSubjectKind, id: string): string {
  return `${kind}:${id}`;
}

async function deriveSignals(req?: Request): Promise<{ ip_prefix: string | null; device_hash: string | null }> {
  if (!req) return { ip_prefix: null, device_hash: null };
  const ip = getClientIp(req);
  return { ip_prefix: ipPrefix(ip), device_hash: await computeDeviceHash(req) };
}

export async function fraudLogEventBestEffort(params: {
  reason: string;
  subjectKind: FraudSubjectKind;
  subjectId: string;
  severity?: number;
  score?: number;
  dedupeKey?: string | null;
  metadata?: Record<string, unknown>;
  req?: Request;
}): Promise<void> {
  try {
    const svc = createServiceClient();
    const { ip_prefix, device_hash } = await deriveSignals(params.req);

    await svc.rpc('fraud_log_event', {
      p_reason: params.reason,
      p_subject_kind: params.subjectKind,
      p_subject_key: subjectKey(params.subjectKind, params.subjectId),
      p_severity: params.severity ?? 1,
      p_score: params.score ?? 0,
      p_dedupe_key: params.dedupeKey ?? null,
      p_ip_prefix: ip_prefix,
      p_device_hash: device_hash,
      p_metadata: params.metadata ?? {},
    });
  } catch {
    // Best-effort.
  }
}

export async function fraudOpenCaseBestEffort(params: {
  reason: string;
  subjectKind: FraudSubjectKind;
  subjectId: string;
  severity?: number;
  metadata?: Record<string, unknown>;
  openedBy?: string;
}): Promise<void> {
  try {
    const svc = createServiceClient();
    await svc.rpc('fraud_open_case', {
      p_reason: params.reason,
      p_subject_kind: params.subjectKind,
      p_subject_key: subjectKey(params.subjectKind, params.subjectId),
      p_severity: params.severity ?? 1,
      p_metadata: params.metadata ?? {},
      p_opened_by: params.openedBy ?? 'system',
    });
  } catch {
    // Best-effort.
  }
}

export async function fraudEnforceActionBestEffort(params: {
  actionType: string;
  reason: string;
  subjectKind: FraudSubjectKind;
  subjectId: string;
  severity?: number;
  expiresAt?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    const svc = createServiceClient();
    await svc.rpc('fraud_enforce_action', {
      p_action_type: params.actionType,
      p_subject_kind: params.subjectKind,
      p_subject_key: subjectKey(params.subjectKind, params.subjectId),
      p_reason: params.reason,
      p_severity: params.severity ?? 1,
      p_expires_at: params.expiresAt ?? null,
      p_metadata: params.metadata ?? {},
    });
  } catch {
    // Best-effort.
  }
}

export async function fraudGetActiveActionBestEffort(params: {
  actionType: string;
  subjectKind: FraudSubjectKind;
  subjectId: string;
}): Promise<{ id: string; reason: string; severity: number; expires_at: string | null; metadata: any } | null> {
  try {
    const svc = createServiceClient();
    const { data, error } = await svc.rpc('fraud_get_active_action', {
      p_action_type: params.actionType,
      p_subject_kind: params.subjectKind,
      p_subject_key: subjectKey(params.subjectKind, params.subjectId),
    });
    if (error) return null;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row?.id) return null;
    return row as any;
  } catch {
    return null;
  }
}
