import { getCorsHeaders } from '../_shared/cors.ts';
import { errorJson, json } from '../_shared/json.ts';
import { createServiceClient, requireUser } from '../_shared/supabase.ts';
import { buildRateLimitHeaders, consumeRateLimit, getClientIp } from '../_shared/rateLimit.ts';
import { normalizeError } from '../_shared/errors.ts';
import { z } from 'npm:zod@3.23.8';
import { buildAgoraRtcToken, createDailyMeetingToken, createDailyRoom } from '../_shared/voiceProviders.ts';
import { envTrim } from '../_shared/config.ts';
import { withRequestContext } from '../_shared/requestContext.ts';

// Minimal schema is kept local to avoid changing global shared schemas.
const bodySchema = z
  .object({
    ride_id: z.string().uuid().optional(),
    callee_profile_id: z.string().uuid().optional(),
    provider: z.enum(['auto', 'agora', 'daily']).optional().default('auto'),
    with_ai: z.boolean().optional().default(false),
  })
  .refine((v) => Boolean(v.ride_id) || Boolean(v.callee_profile_id), {
    message: 'ride_id or callee_profile_id is required',
    path: ['ride_id'],
  });

type CallRole = 'rider' | 'driver' | 'business';

function mapActiveRoleToCallRole(activeRole: string | null | undefined): CallRole {
  if (activeRole === 'rider') return 'rider';
  if (activeRole === 'driver') return 'driver';
  // In our app schema, business accounts are stored as "merchant".
  return 'business';
}

async function startPipecatAgentSession(params: { agentName: string }) {
  const token = envTrim('PIPECAT_CLOUD_API_KEY');
  if (!token) throw new Error('Missing PIPECAT_CLOUD_API_KEY');

  const res = await fetch(`https://api.pipecat.daily.co/v1/public/${encodeURIComponent(params.agentName)}/start`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({
      createDailyRoom: true,
      enableDefaultIceServers: true,
      transport: 'webrtc',
    }),
  });

  const text = await res.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }

  if (!res.ok) throw new Error(`Pipecat start failed: HTTP ${res.status} ${JSON.stringify(data)}`);
  if (!data?.dailyRoom || !data?.sessionId) throw new Error('Pipecat start: missing dailyRoom/sessionId');
  return {
    dailyRoomUrl: String(data.dailyRoom),
    dailyToken: data?.dailyToken ? String(data.dailyToken) : undefined,
    sessionId: String(data.sessionId),
  };
}

Deno.serve((req) =>
  withRequestContext('voice-call-create', req, async (_ctx) => {
  if (req.method !== 'POST') return errorJson('Method not allowed', 405);

  try {
    // Auth
    const { user, error: authError } = await requireUser(req);
    if (!user) return errorJson(authError ?? 'Unauthorized', 401, 'UNAUTHORIZED');
    const ip = getClientIp(req);
    const rl = await consumeRateLimit({
      key: `voice-call-create:${user.id}:${ip ?? 'noip'}`,
      windowSeconds: 60,
      limit: 12,
    });
    if (!rl.allowed) {
      return json(
        { error: 'Rate limit exceeded', code: 'RATE_LIMITED', remaining: rl.remaining, reset_at: rl.resetAt },
        429,
        buildRateLimitHeaders({ limit: 12, remaining: rl.remaining, resetAt: rl.resetAt }),
      );
    }

    const body = bodySchema.parse(await req.json());
    const supabaseAdmin = createServiceClient();

    // Determine callee
    let calleeId = body.callee_profile_id ?? null;
    let rideId = body.ride_id ?? null;

    if (rideId) {
      const { data: ride, error } = await supabaseAdmin
        .from('rides')
        .select('id,rider_id,driver_id,status')
        .eq('id', rideId)
        .maybeSingle();
      if (error) throw error;
      if (!ride) return errorJson('Ride not found', 404, 'NOT_FOUND');
      if (ride.driver_id == null) return errorJson('Ride has no assigned driver yet', 409, 'NO_DRIVER');

      if (ride.rider_id === user.id) calleeId = ride.driver_id;
      else if (ride.driver_id === user.id) calleeId = ride.rider_id;
      else return errorJson('Not authorized for this ride', 403, 'FORBIDDEN');
    }

    if (!calleeId) return errorJson('callee_profile_id is required', 400, 'VALIDATION');
    if (calleeId === user.id) return errorJson('Cannot call yourself', 400, 'VALIDATION');

    const { data: profiles, error: pErr } = await supabaseAdmin
      .from('profiles')
      .select('id,active_role,display_name')
      .in('id', [user.id, calleeId]);
    if (pErr) throw pErr;

    const me = profiles?.find((p) => p.id === user.id);
    const callee = profiles?.find((p) => p.id === calleeId);
    if (!me || !callee) return errorJson('Profile not found', 404, 'NOT_FOUND');

    const myRole = mapActiveRoleToCallRole(me.active_role);
    const calleeRole = mapActiveRoleToCallRole(callee.active_role);

    // Provider selection
    const provider = body.with_ai ? 'daily' : body.provider === 'auto' ? 'agora' : body.provider;

    const callId = crypto.randomUUID();
    const agoraChannel = provider === 'agora' ? `vc_${callId}` : null;
    const dailyRoomName = provider === 'daily' ? `vc-${callId}` : null;

    let dailyRoomUrl: string | null = null;
    let pipecatSessionId: string | null = null;
    let pipecatAgentName: string | null = null;
    let pipecatDailyToken: string | undefined;

    if (provider === 'daily' && body.with_ai) {
      // Pipecat Cloud can create the room (Daily transport) and start the agent.
      const agentName = envTrim('PIPECAT_AGENT_NAME') || 'rideiq-voice-agent';
      const started = await startPipecatAgentSession({ agentName });
      dailyRoomUrl = started.dailyRoomUrl;
      pipecatSessionId = started.sessionId;
      pipecatAgentName = agentName;
      pipecatDailyToken = started.dailyToken;
    }

    // Insert call
    const { error: insErr } = await supabaseAdmin.from('voice_calls').insert({
      id: callId,
      provider,
      status: 'ringing',
      ride_id: rideId,
      created_by: user.id,
      agora_channel: agoraChannel,
      daily_room_name: dailyRoomName,
      daily_room_url: dailyRoomUrl,
      pipecat_session_id: pipecatSessionId,
      pipecat_agent_name: pipecatAgentName,
    });
    if (insErr) throw insErr;

    // If Daily is selected and Pipecat did not create the room, create it now.
    if (provider === 'daily' && !dailyRoomUrl) {
      const created = await createDailyRoom({ roomName: dailyRoomName! });
      dailyRoomUrl = created.roomUrl;
      const { error: upErr } = await supabaseAdmin
        .from('voice_calls')
        .update({ daily_room_url: dailyRoomUrl })
        .eq('id', callId);
      if (upErr) throw upErr;
    }

    // Participants
    const { error: partErr } = await supabaseAdmin.from('voice_call_participants').insert([
      { call_id: callId, profile_id: user.id, role: myRole, is_initiator: true },
      { call_id: callId, profile_id: calleeId, role: calleeRole, is_initiator: false },
    ]);
    if (partErr) throw partErr;

    // Return join info for the initiator
    let join: any;
    if (provider === 'agora') {
      join = await buildAgoraRtcToken({ channel: agoraChannel!, userAccount: user.id });
    } else {
      // Prefer a scoped meeting token (Daily). If DAILY_API_KEY is not present but Pipecat returned a token,
      // fall back to that (owner token) so the feature still works in dev.
      if (envTrim('DAILY_API_KEY')) {
        const t = await createDailyMeetingToken({
          roomName: dailyRoomName!,
          userId: user.id,
          userName: (me as any).display_name ?? undefined,
          isOwner: true,
        });
        join = { ...t, roomUrl: dailyRoomUrl };
      } else if (pipecatDailyToken) {
        join = {
          provider: 'daily',
          roomName: dailyRoomName!,
          roomUrl: dailyRoomUrl,
          token: pipecatDailyToken,
          expiresAt: Math.floor(Date.now() / 1000) + 60 * 30,
        };
      } else {
        return errorJson('Missing DAILY_API_KEY (required for Daily meeting tokens)', 500, 'CONFIG');
      }
    }

    return json(
      {
        call: {
          id: callId,
          provider,
          status: 'ringing',
          ride_id: rideId,
          created_by: user.id,
          agora_channel: agoraChannel,
          daily_room_name: dailyRoomName,
          daily_room_url: dailyRoomUrl,
          pipecat_session_id: pipecatSessionId,
        },
        callee: { id: calleeId, role: calleeRole },
        join,
      },
      200,
    );
  } catch (e) {
    const ne = normalizeError(e);
    console.error('[voice-call-create] error', ne.raw ?? e);
    return errorJson(ne.message, 500, ne.code ?? 'INTERNAL', ne.hint || ne.details ? { hint: ne.hint, details: ne.details } : undefined);
  }
  }),
);
