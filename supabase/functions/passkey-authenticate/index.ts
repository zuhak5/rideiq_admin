import { z } from 'npm:zod@4.3.6';
import {
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from 'npm:@simplewebauthn/server@12.0.0';
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from 'npm:@simplewebauthn/types@12.0.0';

import { withCors} from '../_shared/cors.ts';
import { errorJson, json } from '../_shared/json.ts';
import { buildRateLimitHeaders, consumeRateLimit, getClientIp } from '../_shared/rateLimit.ts';
import { withRequestContext } from '../_shared/requestContext.ts';
import { createServiceClient, requireUser } from '../_shared/supabase.ts';

// ---- WebAuthn helpers -------------------------------------------------------

function base64urlToBytes(b64url: string): Uint8Array {
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

function fromPgByteaHex(hex: string): Uint8Array {
  const s = String(hex);
  if (!s.startsWith('\\x')) return new Uint8Array();
  const pairs = s.slice(2).match(/.{1,2}/g) ?? [];
  return Uint8Array.from(pairs.map((h) => parseInt(h, 16)));
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

const BeginSchema = z.object({ step: z.literal('begin') });

const FinishSchema = z.object({
  step: z.literal('finish'),
  challengeId: z.string().uuid(),
  credential: z.custom<AuthenticationResponseJSON>(),
});

const BodySchema = z.union([BeginSchema, FinishSchema]);

type BeginResponse = {
  challengeId: string;
  publicKey: PublicKeyCredentialRequestOptionsJSON;
};

Deno.serve(async (req) => {

  return await withRequestContext('passkey-authenticate', req, async (ctx) => {
    if (req.method !== 'POST') return errorJson('Method not allowed', 405, 'METHOD_NOT_ALLOWED', undefined, ctx.headers);

    const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return errorJson('Invalid request', 400, 'BAD_REQUEST', { details: parsed.error.flatten() }, ctx.headers);
    }

    const { user, error } = await requireUser(req, ctx);
    if (!user) return errorJson(error ?? 'Unauthorized', 401, 'UNAUTHORIZED', undefined, ctx.headers);

    // Rate limit passkey ceremonies (defense-in-depth).
    const ip = getClientIp(req);
    const step = parsed.data.step;

    const perUser = await consumeRateLimit({
      key: `passkey:auth:${step}:user:${user.id}`,
      windowSeconds: 60,
      limit: step === 'begin' ? 10 : 10,
      failOpen: true,
    });
    if (!perUser.allowed) {
      const headers = { ...ctx.headers, ...buildRateLimitHeaders({ limit: 10, remaining: perUser.remaining, resetAt: perUser.resetAt }) };
      return errorJson('Too many requests', 429, 'RATE_LIMITED', { reset_at: perUser.resetAt }, headers);
    }
    if (ip) {
      const perIp = await consumeRateLimit({
        key: `passkey:auth:${step}:ip:${ip}`,
        windowSeconds: 60,
        limit: 30,
        failOpen: true,
      });
      if (!perIp.allowed) {
        const headers = { ...ctx.headers, ...buildRateLimitHeaders({ limit: 30, remaining: perIp.remaining, resetAt: perIp.resetAt }) };
        return errorJson('Too many requests', 429, 'RATE_LIMITED', { reset_at: perIp.resetAt }, headers);
      }
    }

    const service = createServiceClient();
    const rpID = getRpID(req);

    if (parsed.data.step === 'begin') {
      const { data: rows, error: pkErr } = await service
        .from('user_passkeys')
        .select('credential_id, transports')
        .eq('user_id', user.id)
        .eq('status', 'active');
      if (pkErr) throw pkErr;

      const allowCredentials = (rows ?? [])
        .map((r: any) => {
          const idBytes = fromPgByteaHex(String(r.credential_id ?? ''));
          if (!idBytes.length) return null;
          return {
            id: bytesToBase64url(idBytes),
            type: 'public-key' as const,
            transports: (r.transports ?? undefined) as any,
          };
        })
        .filter(Boolean) as any[];

      const publicKey = await generateAuthenticationOptions({
        rpID,
        allowCredentials,
        userVerification: 'preferred',
      });

      const challengeBytes = base64urlToBytes(publicKey.challenge);
      const { data: challRow, error: challErr } = await service.rpc('webauthn_create_challenge', {
        p_challenge_type: 'authentication',
        p_user_id: user.id,
        p_user_agent: req.headers.get('user-agent') ?? null,
        p_challenge: toPgByteaHex(challengeBytes),
      });
      if (challErr) throw challErr;
      const row = Array.isArray(challRow) ? challRow[0] : null;
      if (!row?.challenge_id) return errorJson('Failed to create challenge', 500, 'CHALLENGE_CREATE_FAILED', undefined, ctx.headers);

      const res: BeginResponse = { challengeId: row.challenge_id, publicKey };
      ctx.setCorrelationId(row.challenge_id);
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
    if (details.challenge_type !== 'authentication') return errorJson('Wrong challenge type', 400, 'CHALLENGE_WRONG_TYPE', undefined, ctx.headers);
    if (details.user_id && details.user_id !== user.id) return errorJson('Challenge does not belong to this user', 403, 'CHALLENGE_FORBIDDEN', undefined, ctx.headers);

    const expectedChallenge = bytesToBase64url(fromPgByteaHex(String(details.challenge)));

    // Load the passkey referenced by the assertion
    const assertedId = parsed.data.credential?.id;
    if (!assertedId) return errorJson('Missing credential id', 400, 'BAD_REQUEST', undefined, ctx.headers);
    const assertedIdBytes = base64urlToBytes(assertedId);

    const { data: keyRow, error: keyErr } = await service
      .from('user_passkeys')
      .select('id, credential_id, public_key, sign_count, transports')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .eq('credential_id', toPgByteaHex(assertedIdBytes))
      .maybeSingle();
    if (keyErr) throw keyErr;
    if (!keyRow) return errorJson('Unknown passkey', 404, 'NOT_FOUND', undefined, ctx.headers);

    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response: parsed.data.credential,
        expectedChallenge,
        expectedOrigin: expectedOrigins,
        expectedRPID: rpID,
        credential: {
          id: assertedId,
          publicKey: fromPgByteaHex(String((keyRow as any).public_key ?? '')),
          counter: Number((keyRow as any).sign_count ?? 0),
          transports: (keyRow as any).transports ?? undefined,
        },
      });
    } catch (err) {
      return errorJson((err && (err as any).message) || 'Verification failed', 400, 'VERIFICATION_FAILED', undefined, ctx.headers);
    }

    if (!verification.verified) return errorJson('Passkey assertion not verified', 400, 'NOT_VERIFIED', undefined, ctx.headers);

    const newCounter = verification.authenticationInfo?.newCounter;
    if (typeof newCounter === 'number') {
      const { error: updErr } = await service.rpc('passkey_update_sign_count', {
        p_user_id: user.id,
        p_credential_id: toPgByteaHex(assertedIdBytes),
        p_sign_count: newCounter,
      });
      if (updErr) throw updErr;
    }

    return json({ ok: true, verified: true }, 200, ctx.headers);
  }).catch((err) => {
    return withCors(req, errorJson(String(err?.message ?? err ?? 'Internal error'), 500, 'INTERNAL_ERROR'));
  });
});
