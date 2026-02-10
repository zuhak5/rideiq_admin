import React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { voiceCallEnd, voiceCallJoin, type VoiceJoinInfo } from '../lib/voiceCalls';
import { errorText } from '../lib/errors';

declare global {
  interface Window {
    AgoraRTC?: any;
  }
}

async function loadScriptOnce(src: string): Promise<void> {
  const existing = document.querySelector(`script[data-rideiq-src="${src}"]`) as HTMLScriptElement | null;
  if (existing) {
    if ((existing as any)._loaded) return;
    await new Promise<void>((resolve, reject) => {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)), { once: true });
    });
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.dataset.rideiqSrc = src;
    s.onload = () => {
      (s as any)._loaded = true;
      resolve();
    };
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(s);
  });
}

type AgoraRuntime = {
  client: any;
  localTrack: any;
  joined: boolean;
};

export default function VoiceCallPage() {
  const { callId } = useParams();
  const nav = useNavigate();
  const id = callId ?? '';

  const [loading, setLoading] = React.useState(true);
  const [joinInfo, setJoinInfo] = React.useState<VoiceJoinInfo | null>(null);
  const [status, setStatus] = React.useState<string>('Connecting…');
  const [err, setErr] = React.useState<string | null>(null);
  const [muted, setMuted] = React.useState(false);
  const agoraRef = React.useRef<AgoraRuntime | null>(null);

  const cleanupAgora = React.useCallback(async () => {
    try {
      const rt = agoraRef.current;
      if (!rt) return;
      try {
        if (rt.localTrack) {
          rt.localTrack.stop?.();
          rt.localTrack.close?.();
        }
      } catch {
        // ignore
      }
      try {
        if (rt.client && rt.joined) await rt.client.leave();
      } catch {
        // ignore
      }
      agoraRef.current = null;
    } finally {
      // no-op
    }
  }, []);

  const hangup = React.useCallback(
    async (reason?: string) => {
      try {
        await cleanupAgora();
        if (id) await voiceCallEnd({ callId: id, reason: reason ?? 'hangup' });
      } catch {
        // ignore
      } finally {
        nav(-1);
      }
    },
    [cleanupAgora, id, nav],
  );

  React.useEffect(() => {
    if (!id) return;
    let alive = true;
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const data = await voiceCallJoin(id);
        if (!alive) return;
        setJoinInfo(data.join);
        setLoading(false);
      } catch (e: unknown) {
        if (!alive) return;
        setErr(errorText(e));
        setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [id]);

  // Join provider runtime
  React.useEffect(() => {
    if (!joinInfo) return;
    let cancelled = false;

    (async () => {
      try {
        if (joinInfo.provider === 'daily') {
          // Daily: simplest reliable web experience is the Daily Prebuilt room.
          const u = new URL(joinInfo.roomUrl);
          // Daily prebuilt accepts meeting token via `t`.
          u.searchParams.set('t', joinInfo.token);
          // Hint: voice call (no camera) by default.
          u.searchParams.set('video', '0');
          u.searchParams.set('audio', '1');
          setStatus('Opening Daily room…');
          window.location.replace(u.toString());
          return;
        }

        // Agora
        setStatus('Loading Agora…');
        // Agora Web SDK (NG) UMD build
        await loadScriptOnce('https://download.agora.io/sdk/release/AgoraRTC_N.js');
        if (cancelled) return;
        const AgoraRTC = window.AgoraRTC;
        if (!AgoraRTC) throw new Error('AgoraRTC is not available after script load');

        setStatus('Joining Agora channel…');
        const client = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });
        const runtime: AgoraRuntime = { client, localTrack: null, joined: false };
        agoraRef.current = runtime;

        client.on('user-published', async (user: any, mediaType: string) => {
          if (mediaType !== 'audio') return;
          await client.subscribe(user, mediaType);
          user.audioTrack?.play();
          setStatus('Connected');
        });

        client.on('user-left', () => {
          setStatus('Other party left');
        });

        const uid = joinInfo.userAccount; // use stable string uid
        await client.join(joinInfo.appId, joinInfo.channel, joinInfo.token, uid);
        runtime.joined = true;

        const localTrack = await AgoraRTC.createMicrophoneAudioTrack();
        runtime.localTrack = localTrack;

        if (muted) {
          await localTrack.setEnabled(false);
        }

        await client.publish([localTrack]);
        setStatus('Connected');
      } catch (e: unknown) {
        if (cancelled) return;
        setErr(errorText(e));
        setStatus('Failed');
      }
    })();

    return () => {
      cancelled = true;
      void cleanupAgora();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joinInfo]);

  // Toggle mute
  React.useEffect(() => {
    const rt = agoraRef.current;
    if (!rt?.localTrack) return;
    void rt.localTrack.setEnabled(!muted);
  }, [muted]);

  React.useEffect(() => {
    const onBeforeUnload = () => {
      void cleanupAgora();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [cleanupAgora]);

  return (
    <div className="max-w-2xl mx-auto">
      <div className="card p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-base font-semibold">Voice call</div>
            <div className="text-sm text-gray-500 mt-1">{status}</div>
          </div>
          <button className="btn" onClick={() => void hangup('close')}>
            Close
          </button>
        </div>

        {loading ? <div className="mt-4 text-sm text-gray-500">Loading call…</div> : null}
        {err ? (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{err}</div>
        ) : null}

        {joinInfo?.provider === 'agora' && !loading ? (
          <div className="mt-5 flex flex-wrap gap-2">
            <button className="btn" onClick={() => setMuted((v) => !v)}>
              {muted ? 'Unmute' : 'Mute'}
            </button>
            <button className="btn btn-danger" onClick={() => void hangup('hangup')}>
              Hang up
            </button>
          </div>
        ) : null}

        {joinInfo?.provider === 'daily' && !loading ? (
          <div className="mt-4 text-sm text-gray-600">
            Redirecting to Daily room…
          </div>
        ) : null}
      </div>
    </div>
  );
}
