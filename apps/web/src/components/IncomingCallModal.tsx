import React from 'react';
import { useNavigate } from 'react-router-dom';
import { voiceCallEnd } from '../lib/voiceCalls';
import { errorText } from '../lib/errors';

export type IncomingCall = {
  callId: string;
  fromUserId: string;
  provider: string;
  createdAt: string;
};

export default function IncomingCallModal({
  open,
  call,
  onClose,
}: {
  open: boolean;
  call: IncomingCall | null;
  onClose: () => void;
}) {
  const nav = useNavigate();
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) {
      setBusy(false);
      setErr(null);
    }
  }, [open]);

  if (!open || !call) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-xl border border-gray-200">
        <div className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-base font-semibold">Incoming call</div>
              <div className="text-xs text-gray-500 mt-1">
                Provider: {call.provider} • {new Date(call.createdAt).toLocaleString()}
              </div>
            </div>
            <button className="btn" disabled={busy} onClick={onClose}>
              Close
            </button>
          </div>

          {err ? <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{err}</div> : null}

          <div className="mt-5 flex gap-2">
            <button
              className="btn btn-primary"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                onClose();
                nav(`/voice-call/${call.callId}`);
              }}
            >
              Answer
            </button>
            <button
              className="btn btn-danger"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setErr(null);
                try {
                  await voiceCallEnd({ callId: call.callId, reason: 'declined' });
                  onClose();
                } catch (e: unknown) {
                  setErr(errorText(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              Decline
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
