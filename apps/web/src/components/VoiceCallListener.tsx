import React from 'react';
import { supabase } from '../lib/supabaseClient';
import IncomingCallModal, { type IncomingCall } from './IncomingCallModal';

export default function VoiceCallListener({ uid }: { uid: string | null }) {
  const [incoming, setIncoming] = React.useState<IncomingCall | null>(null);
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    if (!uid) return;

    let cancelled = false;

    const ch = supabase
      .channel(`voice-calls:${uid}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'voice_call_participants', filter: `profile_id=eq.${uid}` },
        async (payload: any) => {
          try {
            const row = payload?.new;
            if (!row || row.profile_id !== uid) return;
            // Ignore our own initiator row.
            if (row.is_initiator) return;

            const callId = row.call_id as string;
            if (!callId) return;

            const { data: call } = await supabase
              .from('voice_calls')
              .select('id,provider,status,created_by,created_at')
              .eq('id', callId)
              .maybeSingle();
            if (cancelled) return;
            if (!call) return;
            if (call.status !== 'ringing') return;

            setIncoming({
              callId: call.id,
              fromUserId: call.created_by,
              provider: call.provider,
              createdAt: call.created_at,
            });
            setOpen(true);
          } catch {
            // ignore
          }
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      void supabase.removeChannel(ch);
    };
  }, [uid]);

  return <IncomingCallModal open={open} call={incoming} onClose={() => setOpen(false)} />;
}
