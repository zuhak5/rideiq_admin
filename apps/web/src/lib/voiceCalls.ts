import { invokeEdge } from './edgeInvoke';

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

export type VoiceCallCreateResponse = {
  call: {
    id: string;
    provider: VoiceProvider;
    status: string;
    ride_id: string | null;
    created_by: string;
    agora_channel: string | null;
    daily_room_name: string | null;
    daily_room_url: string | null;
    pipecat_session_id: string | null;
  };
  callee: { id: string; role: 'rider' | 'driver' | 'business' };
  join: VoiceJoinInfo;
};

export async function voiceCallCreateForRide(params: {
  rideId: string;
  provider?: 'auto' | VoiceProvider;
  withAi?: boolean;
}) {
  const { data } = await invokeEdge<VoiceCallCreateResponse>('voice-call-create', {
    ride_id: params.rideId,
    provider: params.provider ?? 'auto',
    with_ai: Boolean(params.withAi),
  });
  return data;
}

export async function voiceCallCreateToProfile(params: {
  calleeProfileId: string;
  provider?: 'auto' | VoiceProvider;
  withAi?: boolean;
}) {
  const { data } = await invokeEdge<VoiceCallCreateResponse>('voice-call-create', {
    callee_profile_id: params.calleeProfileId,
    provider: params.provider ?? 'auto',
    with_ai: Boolean(params.withAi),
  });
  return data;
}

export type VoiceCallJoinResponse = {
  call_id: string;
  join: VoiceJoinInfo;
};

export async function voiceCallJoin(callId: string) {
  const { data } = await invokeEdge<VoiceCallJoinResponse>('voice-call-join', { call_id: callId });
  return data;
}

export async function voiceCallEnd(params: { callId: string; reason?: string }) {
  const { data } = await invokeEdge<{ ok: boolean; call_id: string; status: string }>('voice-call-end', {
    call_id: params.callId,
    reason: params.reason ?? null,
  });
  return data;
}
