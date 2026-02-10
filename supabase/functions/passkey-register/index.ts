import { z } from 'npm:zod@4.3.6';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
} from 'npm:@simplewebauthn/server@12.0.0';
import type {
  RegistrationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
} from 'npm:@simplewebauthn/types@12.0.0';

import { withCors} from '../_shared/cors.ts';
import { errorJson, json } from '../_shared/json.ts';
import { consumeRateLimit, buildRateLimitHeaders, getClientIp } from '../_shared/rateLimit.ts';
import { withRequestContext } from '../_shared/requestContext.ts';
import { createServiceClient, requireUser } from '../_shared/supabase.ts';

// ---- WebAuthn helpers -------------------------------------------------------

function base64urlToBytes(b64url: string): Uint8Array {
  // atob expects standard base64.
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(b64url.length / 4) * 4, '=');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToBase64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  const b64 = btoa(bin);
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function toPgByteaHex(bytes: Uint8Array): string {
  return `\\x${Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

function getRpID(req: Request): string {
  const env = Deno.env.get('PASSKEY_RP_ID');
  if (env) return env;
  const origin = req.headers.get('origin');
  if (origin) return new URL(origin).hostname;
  const host = req.headers.get('host') ?? 'localhost';
  return host.split(':')[0];
}

function getExpectedOrigins(req: Request): string[] {
  const raw = Deno.env.get('PASSKEY_ALLOWED_ORIGINS') ?? Deno.env.get('PASSKEY_ORIGIN');
  if (raw) {
    const list = raw.split(',').map((s) => s.trim()).filter(Boolean);
    if (list.length) return list;
  }

  // Local dev fallback only.
  const origin = req.headers.get('origin');
  if (!origin) return [];
  const hostname = new URL(origin).hostname;
  if (hostname === 'localhost' || hostname === '127.0.0.1') return [origin];
  return [];
}

// ---- Input schema -----------------------------------------------------------

const BeginSchema = z.object({
  step: z.literal('begin'),
});

const FinishSchema = z.object({
  step: z.literal('finish'),
  challengeId: z.string().uuid(),
  credential: z.custom<RegistrationResponseJSON>(),
  // Optional UX metadata
  friendlyName: z.string().min(1).max(120).optional(),
});

const BodySchema = z.union([BeginSchema, FinishSchema]);

type BeginResponse = {
  challengeId: string;
  publicKey: PublicKeyCredentialCreationOptionsJSON;
};

Deno.serve(async (req) => {

  return await withRequestContext('passkey-register', req, async (ctx) => {
    if (req.method !== 'POST') return errorJson('Method not allowed', 405, 'METHOD_NOT_ALLOWED', undefined, ctx.headers);

    const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return errorJson('Invalid request', 400, 'BAD_REQUEST', { details: parsed.error.flatten() }, ctx.headers);
    }

    const { user, error } = await requireUser(req, ctx);
    if (!user) return errorJson(error ?? 'Unauthorized', 401, 'UNAUTHORIZED', undefined, ctx.headers);

    // Rate limit passkey ceremonies (defense-in-depth).
    // - Per-user: protects accounts from request floods.
    // - Per-IP: protects infrastructure from wide-open unauthenticated traffic patterns.
    const ip = getClientIp(req);
    const step = parsed.data.step;
    const perUser = await consumeRateLimit({
      key: `passkey:register:${step}:user:${user.id}`,
      windowSeconds: 60,
      limit: step === 'begin' ? 5 : 5,
      failOpen: true,
    });
    if (!perUser.allowed) {
      const headers = { ...ctx.headers, ...buildRateLimitHeaders({ limit: 5, remaining: perUser.remaining, resetAt: perUser.resetAt }) };
      return errorJson('Too many requests', 429, 'RATE_LIMITED', { reset_at: perUser.resetAt }, headers);
    }
    if (ip) {
      const perIp = await consumeRateLimit({
        key: `passkey:register:${step}:ip:${ip}`,
        windowSeconds: 60,
        limit: 20,
        failOpen: true,
      });
      if (!perIp.allowed) {
        const headers = { ...ctx.headers, ...buildRateLimitHeaders({ limit: 20, remaining: perIp.remaining, resetAt: perIp.resetAt }) };
        return errorJson('Too many requests', 429, 'RATE_LIMITED', { reset_at: perIp.resetAt }, headers);
      }
    }

    const service = createServiceClient();
    const rpID = getRpID(req);
    const rpName = Deno.env.get('PASSKEY_RP_NAME') ?? 'RideIQ';

    if (parsed.data.step === 'begin') {
      const { data: existing, error: pkErr } = await service
        .from('user_passkeys')
        .select('credential_id, transports')
        .eq('user_id', user.id)
        .eq('status', 'active');
      if (pkErr) throw pkErr;

      // Prevent registering the same authenticator twice.
      const excludeCredentials = (existing ?? [])
        .map((p: any) => {
          const hex = String(p.credential_id ?? '');
          if (!hex.startsWith('\\x')) return null;
          const pairs = hex.slice(2).match(/.{1,2}/g) ?? [];
          const bytes = Uint8Array.from(pairs.map((h: string) => parseInt(h, 16)));
          return {
            id: bytesToBase64url(bytes),
            type: 'public-key' as const,
            transports: (p.transports ?? undefined) as any,
          };
        })
        .filter(Boolean) as any[];

      const publicKey = await generateRegistrationOptions({
        rpName,
        rpID,
        userID: new TextEncoder().encode(user.id),
        userName: user.id,
        attestationType: 'none',
        authenticatorSelection: {
          residentKey: 'preferred',
          userVerification: 'preferred',
        },
        excludeCredentials,
      });

      const challengeBytes = base64urlToBytes(publicKey.challenge);
      const { data: challRow, error: challErr } = await service.rpc('webauthn_create_challenge', {
        p_challenge_type: 'registration',
        p_user_id: user.id,
        p_user_agent: req.headers.get('user-agent') ?? null,
        p_challenge: toPgByteaHex(challengeBytes),
      });
      if (challErr) throw challErr;
      const row = Array.isArray(challRow) ? challRow[0] : null;
      if (!row?.challenge_id) return errorJson('Failed to create challenge', 500, 'CHALLENGE_CREATE_FAILED', undefined, ctx.headers);

      ctx.setCorrelationId(row.challenge_id);
      const res: BeginResponse = { challengeId: row.challenge_id, publicKey };
      return json(res, 200, ctx.headers);
    }

    // finish
    ctx.setCorrelationId(parsed.data.challengeId);
    const expectedOrigins = getExpectedOrigins(req);
    if (!expectedOrigins.length) {
      return errorJson(
        'Passkey server is missing allowed origins. Set PASSKEY_ALLOWED_ORIGINS (comma-separated) in Edge Function secrets.',
        500,
        'PASSKEY_ORIGIN_MISSING',
        undefined,
        ctx.headers,
      );
    }

    const { data: chall, error: challErr } = await service.rpc('webauthn_consume_challenge_details', {
      p_challenge_id: parsed.data.challengeId,
    });
    if (challErr) throw challErr;
    const details = Array.isArray(chall) ? chall[0] : null;
    if (!details?.challenge) return errorJson('Challenge expired or already used', 400, 'CHALLENGE_INVALID', undefined, ctx.headers);
    if (details.challenge_type !== 'registration') return errorJson('Wrong challenge type', 400, 'CHALLENGE_WRONG_TYPE', undefined, ctx.headers);
    if (details.user_id && details.user_id !== user.id) return errorJson('Challenge does not belong to this user', 403, 'CHALLENGE_FORBIDDEN', undefined, ctx.headers);

    const expectedChallenge = bytesToBase64url(
      (() => {
        const hex = String(details.challenge);
        if (hex.startsWith('\\x')) {
          const pairs = hex.slice(2).match(/.{1,2}/g) ?? [];
          return Uint8Array.from(pairs.map((h: string) => parseInt(h, 16)));
        }
        return new Uint8Array();
      })(),
    );

    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response: parsed.data.credential,
        expectedChallenge,
        expectedOrigin: expectedOrigins,
        expectedRPID: rpID,
      });
    } catch (err) {
      return errorJson((err && (err as any).message) || 'Verification failed', 400, 'VERIFICATION_FAILED', undefined, ctx.headers);
    }

    if (!verification.verified || !verification.registrationInfo) {
      return errorJson('Passkey registration not verified', 400, 'NOT_VERIFIED', undefined, ctx.headers);
    }

    const { registrationInfo } = verification;
    const { credential, credentialDeviceType, credentialBackedUp } = registrationInfo;

    const attachment = (parsed.data.credential as any).authenticatorAttachment;
    const passkeyType = attachment === 'cross-platform' ? 'cross_platform' : 'platform';

    const credentialIdBytes = base64urlToBytes(credential.id);
    const publicKeyBytes = credential.publicKey;

    const { data: passkeyId, error: insertErr } = await service.rpc('passkey_register', {
      p_user_id: user.id,
      p_credential_id: toPgByteaHex(credentialIdBytes),
      p_public_key: toPgByteaHex(publicKeyBytes),
      p_passkey_type: passkeyType,
      p_friendly_name: parsed.data.friendlyName ?? null,
      p_backup_eligible: credentialDeviceType === 'multiDevice',
      p_device_type: null,
      p_user_agent: req.headers.get('user-agent') ?? null,
      p_transports: credential.transports ?? null,
      p_webauthn_device_type: credentialDeviceType ?? null,
      p_backup_state: credentialBackedUp ?? null,
    });
    if (insertErr) throw insertErr;

    return json({ ok: true, passkeyId }, 200, ctx.headers);
  }).catch((err) => {
    // Backstop: withRequestContext should catch; this is for catastrophic failures.
    return withCors(req, errorJson(String(err?.message ?? err ?? 'Internal error'), 500, 'INTERNAL_ERROR'));
  });
});
