import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'react-router-dom';
import { aiGatewayStream } from '../lib/aiGatewayStream';
import { getMyAppContext } from '../lib/profile';
import { supabase } from '../lib/supabaseClient';

type Msg = { id: string; role: 'user' | 'assistant'; text: string };

type Surface = 'copilot' | 'driver' | 'merchant';

function rid() {
  return (crypto as any).randomUUID?.() ?? String(Date.now() + Math.random());
}

export default function CopilotWidget() {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [uid, setUid] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);

  const loc = useLocation();

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!alive) return;
      setUid(data.session?.user.id ?? null);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const ctxQ = useQuery({
    queryKey: ['my-app-context'],
    queryFn: getMyAppContext,
    retry: false,
  });

  const surface: Surface = useMemo(() => {
    // Prefer current screen context first, then fall back to active role.
    const path = loc.pathname || '';
    if (path.startsWith('/driver')) return 'driver';
    if (path.startsWith('/merchant')) return 'merchant';

    const role = ctxQ.data?.active_role;
    if (role === 'driver') return 'driver';
    if (role === 'merchant') return 'merchant';
    return 'copilot';
  }, [loc.pathname, ctxQ.data?.active_role]);

  const assistantTitle = surface === 'driver' ? 'مساعد السواق' : surface === 'merchant' ? 'مساعد التاجر' : 'المساعد';

  const initialText = surface === 'driver'
    ? 'هلا سواقنا! اكدر اساعدك تزيد رحلاتك ودخلك: وين تگعد وشنو الوقت الاحسن.'
    : surface === 'merchant'
      ? 'هلا! اكدر اساعدك بملخصات المبيعات واقتراحات تزيد البيع والخصومات.'
      : 'هلا! شتحتاج؟ اكدر اساعدك تلكه محلات، مواد، او خصومات.';

  const storageKey = useMemo(() => {
    const who = uid ?? 'anon';
    return `rideiq:copilot_msgs:${who}:${surface}`;
  }, [uid, surface]);

  useEffect(() => {
    // When role/surface changes, load that surface's conversation.
    setErr(null);
    setBusy(false);
    setInput('');

    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length) {
          setMsgs(parsed as Msg[]);
          return;
        }
      }
    } catch {
      // ignore
    }

    setMsgs([{ id: rid(), role: 'assistant', text: initialText }]);
  }, [storageKey, initialText]);

  useEffect(() => {
    if (!msgs.length) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(msgs.slice(-60)));
    } catch {
      // ignore
    }
  }, [msgs, storageKey]);

  const inferredMerchantId = useMemo(() => {
    const p = loc.pathname || '';
    const m1 = p.match(/^\/business\/([^/]+)/);
    if (m1?.[1]) return m1[1];
    const m2 = p.match(/^\/checkout\/([^/]+)/);
    if (m2?.[1]) return m2[1];
    return undefined;
  }, [loc.pathname]);

  const canSend = useMemo(() => input.trim().length > 0 && !busy, [input, busy]);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setErr(null);
    setBusy(true);
    setInput('');
    const userMsg: Msg = { id: rid(), role: 'user', text };
    setMsgs((m) => [...m, userMsg]);

    const botId = rid();
    let acc = '';
    setMsgs((m) => [...m, { id: botId, role: 'assistant', text: '' }]);

    const history = msgs
      .filter((m) => (m.role === 'user' || m.role === 'assistant') && !!m.text)
      .slice(-10)
      .map((m) => ({ role: m.role, text: m.text }));

    try {
      await aiGatewayStream({
        surface,
        history,
        message: text,
        ui_path: loc.pathname,
        merchant_id: inferredMerchantId,
        onDelta: (d) => {
          if (!d) return;
          acc += d;
          setMsgs((m) => m.map((x) => (x.id === botId ? { ...x, text: acc } : x)));
        },
        onDone: (payload) => {
          const finalText = String(payload?.reply ?? acc).trim();
          setMsgs((m) => m.map((x) => (x.id === botId ? { ...x, text: finalText || 'ما لكيت جواب واضح. جرب صياغة ثانية.' } : x)));
        },
        onError: (payload) => {
          setErr(String(payload?.message ?? 'صار خطأ'));
          setMsgs((m) => m.map((x) => (x.id === botId ? { ...x, text: 'صار خطأ. حاول بعد شوي.' } : x)));
        },
      });
    } catch (e: any) {
      setErr(e?.message ?? String(e));
      setMsgs((m) => m.map((x) => (x.id === botId ? { ...x, text: 'صار خطأ. حاول بعد شوي.' } : x)));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!open) return;
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      <button
        onClick={() => setOpen((v) => !v)}
        className="fixed bottom-4 right-4 z-50 rounded-full shadow-lg px-4 py-3 bg-black text-white hover:opacity-90"
        title="المساعد"
      >
        🤖
      </button>

      {open && (
        <div className={
          expanded
            ? 'fixed inset-0 z-50 bg-white'
            : 'fixed bottom-20 right-4 z-50 w-[92vw] max-w-md rounded-2xl shadow-2xl border bg-white overflow-hidden'
        }>
          <div className="flex items-center justify-between px-4 py-3 border-b">
            <div className="font-semibold">{assistantTitle}</div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  try {
                    localStorage.removeItem(storageKey);
                  } catch {
                    // ignore
                  }
                  setMsgs([{ id: rid(), role: 'assistant', text: initialText }]);
                }}
                className="text-sm opacity-70 hover:opacity-100"
                title="بدء محادثة جديدة"
              >
                جديد
              </button>
              <button onClick={() => setExpanded((v) => !v)} className="text-sm opacity-70 hover:opacity-100">
                {expanded ? 'تصغير' : 'تكبير'}
              </button>
              <button
                onClick={() => {
                  setExpanded(false);
                  setOpen(false);
                }}
                className="text-sm opacity-70 hover:opacity-100"
              >
                إغلاق
              </button>
            </div>
          </div>

          <div className={expanded ? 'h-[calc(100vh-168px)] overflow-y-auto p-3 space-y-2' : 'h-[55vh] max-h-[520px] overflow-y-auto p-3 space-y-2'}>
            {msgs.map((m) => (
              <div key={m.id} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                <div
                  className={
                    'max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-relaxed ' +
                    (m.role === 'user' ? 'bg-black text-white' : 'bg-gray-100 text-gray-900')
                  }
                >
                  {m.text}
                </div>
              </div>
            ))}
          </div>

          <div className="p-3 border-t">
            {err && <div className="text-xs text-red-600 mb-2">{err}</div>}
            <div className="flex gap-2">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && canSend) send();
                }}
                className="flex-1 rounded-xl border px-3 py-2 text-sm"
                placeholder="اكتب سؤالك..."
                disabled={busy}
              />
              <button
                onClick={send}
                disabled={!canSend}
                className="rounded-xl px-4 py-2 text-sm bg-black text-white disabled:opacity-40"
              >
                {busy ? '...' : 'إرسال'}
              </button>
            </div>
            <div className="text-[11px] opacity-60 mt-2">
              تلميح: اسأل عن خصومات، محلات قريبة، او مواد معيّنة.
            </div>
          </div>
        </div>
      )}
    </>
  );
}
