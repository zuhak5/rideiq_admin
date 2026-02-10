import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { callAiGatewayStream } from '../lib/aiGatewayStream';
import { listChatMessages, sendChatMessage, merchantChatMarkRead } from '../lib/merchant';
import { supabase } from '../lib/supabaseClient';
import type { Database } from '../lib/database.types';

type ThreadRow = {
  id: string;
  merchant_id: string;
  customer_id: string;
  last_message_at: string | null;
  last_message_preview: string | null;
};

type MerchantRow = {
  id: string;
  business_name: string | null;
  owner_profile_id: string | null;
};

type AiSettingsRow = {
  thread_id: string;
  auto_enabled: boolean;
  auto_reply_mode: Database['public']['Enums']['merchant_chat_auto_reply_mode'];
  min_gap_seconds: number;
};

type MsgRow = {
  id: string;
  thread_id: string;
  sender_id: string;
  message_type: Database['public']['Enums']['chat_message_type'];
  body: string | null;
  attachments: any[] | null;
  created_at: string;
};

function isAiTrigger(text: string) {
  const t = text.trim();
  return t.startsWith('@ai') || t.startsWith('@AI') || t.startsWith('@مساعد') || t.startsWith('🤖');
}

function stripAiTrigger(text: string) {
  let t = text.trim();
  if (t.startsWith('🤖')) t = t.slice(1).trim();
  if (t.toLowerCase().startsWith('@ai')) t = t.slice(3).trim();
  if (t.startsWith('@مساعد')) t = t.slice('@مساعد'.length).trim();
  return t;
}

export default function MerchantChatPage() {
  const { threadId } = useParams();
  const [myId, setMyId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [aiDraft, setAiDraft] = useState<string | null>(null);
  const [savingAiSettings, setSavingAiSettings] = useState(false);
  const aiStartedAtRef = useRef<number>(0);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setMyId(data.user?.id ?? null));
  }, []);

  const threadQ = useQuery({
    queryKey: ['merchant-chat-thread', threadId],
    queryFn: async () => {
      if (!threadId) throw new Error('Missing threadId');
      const { data, error } = await supabase
        .from('merchant_chat_threads')
        .select('id,merchant_id,customer_id,last_message_at,last_message_preview')
        .eq('id', threadId)
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('Thread not found');
      return data as ThreadRow;
    },
    enabled: Boolean(threadId),
  });

  const merchantQ = useQuery({
    queryKey: ['merchant-chat-merchant', threadQ.data?.merchant_id],
    queryFn: async () => {
      const merchantId = threadQ.data?.merchant_id;
      if (!merchantId) throw new Error('Missing merchantId');
      const { data, error } = await supabase
        .from('merchants')
        .select('id,business_name,owner_profile_id')
        .eq('id', merchantId)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as MerchantRow | null;
    },
    enabled: Boolean(threadQ.data?.merchant_id),
  });

  const aiSettingsQ = useQuery({
    queryKey: ['merchant-chat-ai-settings', threadId],
    queryFn: async () => {
      if (!threadId) return null;
      const { data, error } = await supabase
        .from('merchant_chat_ai_settings')
        .select('thread_id,auto_enabled,auto_reply_mode,min_gap_seconds')
        .eq('thread_id', threadId)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as AiSettingsRow | null;
    },
    enabled: Boolean(threadId),
  });

  const messagesQ = useQuery({
    queryKey: ['merchant-chat-messages', threadId],
    queryFn: async () => {
      if (!threadId) return [];
      const rows = await listChatMessages(threadId, 120);
      return rows as MsgRow[];
    },
    enabled: Boolean(threadId),
  });

  const [messages, setMessages] = useState<MsgRow[]>([]);
  useEffect(() => {
    if (messagesQ.data) setMessages(messagesQ.data);
  }, [messagesQ.data]);

  const sorted = useMemo(() => {
    const arr = [...(messages ?? [])];
    arr.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    return arr;
  }, [messages]);

  const isMerchantOwner = Boolean(myId && merchantQ.data?.owner_profile_id && myId === merchantQ.data?.owner_profile_id);
  const autoEnabled = Boolean(aiSettingsQ.data?.auto_enabled);

  useEffect(() => {
    if (!threadId) return;

    // Mark read (best-effort)
    merchantChatMarkRead(threadId).catch(() => undefined);

    const channel = supabase
      .channel(`merchant-chat:${threadId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'merchant_chat_messages', filter: `thread_id=eq.${threadId}` },
        (payload) => {
          const row = payload.new as any as MsgRow;
          setMessages((prev) => (prev.some((m) => m.id === row.id) ? prev : [...prev, row]));

          // إذا وصل رد AI (message_type=ai) بعد ما بدأنا بثه من الواجهة، نخفي الـ draft المؤقت
          if (row.message_type === 'ai' && aiDraft !== null) {
            const startedAt = aiStartedAtRef.current;
            const createdAt = new Date(row.created_at).getTime();
            if (!Number.isNaN(createdAt) && createdAt >= startedAt - 2000) {
              setAiDraft(null);
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [threadId, aiDraft]);

  useEffect(() => {
    // auto scroll to bottom
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [sorted.length, aiDraft]);

  async function maybeCallAi(userMessage: string) {
    if (!threadId) return;
    const trimmed = userMessage.trim();
    if (!isAiTrigger(trimmed)) return;

    const clean = stripAiTrigger(trimmed);
    if (!clean) return;

    aiStartedAtRef.current = Date.now();
    setAiDraft('');

    await callAiGatewayStream({
      surface: 'merchant_chat',
      thread_id: threadId,
      message: clean,
      ui_path: `/merchant-chat/${threadId}`,
      onDelta: (t: string) => setAiDraft((p) => (p ?? '') + t),
      onError: () => setAiDraft(null),
      onDone: () => {
        // الرد النهائي يندرج داخل DB من السيرفر (ai-gateway) وبـ realtime يظهر
        setTimeout(() => setAiDraft(null), 1000);
      },
    });
  }

  async function onSend() {
    if (!threadId) return;
    const text = draft.trim();
    if (!text) return;
    setSending(true);
    try {
      const inserted = await sendChatMessage(threadId, text);
      setDraft('');
      // Optimistic append (server + realtime will dedupe by id)
      setMessages((prev) => (prev.some((m) => m.id === inserted.id) ? prev : [...prev, inserted as any as MsgRow]));

      // NOTE: autopilot replies are handled server-side by DB webhook -> merchant-chat-autoreply.
      // The UI only triggers AI when user explicitly writes @ai.
      await maybeCallAi(text);
    } finally {
      setSending(false);
    }
  }

  async function saveAiSettings(patch: Partial<AiSettingsRow>) {
    if (!threadId) return;
    setSavingAiSettings(true);
    try {
      const base: Partial<AiSettingsRow> = { thread_id: threadId };
      const up = { ...base, ...patch };
      const { error } = await supabase
        .from('merchant_chat_ai_settings')
        .upsert(up, { onConflict: 'thread_id' });
      if (error) throw error;
      await aiSettingsQ.refetch();
    } finally {
      setSavingAiSettings(false);
    }
  }

  const headerTitle = threadQ.data
    ? `دردشة (Thread: ${threadQ.data.id.slice(0, 8)}...)`
    : 'دردشة';

  const hint = autoEnabled
    ? 'المساعد مفعل تلقائياً. التاجر يگدر يطفّيه بأي وقت. تگدر بعد تكتب @ai لأسئلة محددة.'
    : 'تلميح: اكتب @ai حتى المساعد يجاوب داخل الدردشة.';

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-3xl mx-auto p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h1 className="text-xl font-semibold">{headerTitle}</h1>
            <div className="text-xs text-gray-600">
              <Link to="/customer-chats" className="underline">رجوع</Link>
            </div>
          </div>
          <div className="text-xs text-gray-500">{myId ? 'متصل' : '...'}</div>
        </div>

        {/* Merchant-only autopilot toggle */}
        {isMerchantOwner && (
          <div className="mb-3 bg-white rounded-2xl shadow-sm border p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold">🤖 ردود تلقائية داخل الدردشة</div>
                <div className="text-xs text-gray-600">المساعد يرد على أسئلة السعر/العروض/المنيو حتى الزبون يكمّل الطلب بسرعة.</div>
              </div>
              <button
                onClick={() => saveAiSettings({ auto_enabled: !autoEnabled })}
                disabled={savingAiSettings}
                className={`px-3 py-2 rounded-xl text-sm border ${autoEnabled ? 'bg-green-600 text-white border-green-700' : 'bg-gray-100 text-gray-800 border-gray-200'} disabled:opacity-60`}
              >
                {autoEnabled ? 'مفعل' : 'مطفّي'}
              </button>
            </div>

            {autoEnabled && (
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
                <label className="text-xs text-gray-700">
                  وضع الرد
                  <select
                    className="mt-1 w-full border rounded-xl px-2 py-2 text-sm"
                    value={String(aiSettingsQ.data?.auto_reply_mode ?? 'smart')}
                    onChange={(e) => saveAiSettings({ auto_reply_mode: e.target.value as any })}
                    disabled={savingAiSettings}
                  >
                    <option value="smart">ذكي (سعر/عروض/طلب)</option>
                    <option value="always">دائماً</option>
                  </select>
                </label>

                <label className="text-xs text-gray-700">
                  أقل مدة بين ردّين
                  <input
                    type="number"
                    min={0}
                    max={300}
                    className="mt-1 w-full border rounded-xl px-2 py-2 text-sm"
                    value={Number(aiSettingsQ.data?.min_gap_seconds ?? 15)}
                    onChange={(e) => saveAiSettings({ min_gap_seconds: Number(e.target.value) })}
                    disabled={savingAiSettings}
                  />
                </label>

                <div className="text-xs text-gray-600 flex items-end">
                  <div className="p-2 rounded-xl bg-gray-50 border w-full">
                    تظل تگدر تكتب <span className="font-mono">@ai</span> حتى تسأل المساعد بشكل مباشر.
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        <div ref={listRef} className="bg-white rounded-2xl shadow-sm border p-3 h-[66vh] overflow-y-auto">
          {sorted.map((m) => {
            const mine = myId && m.sender_id === myId;
            const isAi = m.message_type === 'ai';
            return (
              <div key={m.id} className={`mb-2 flex ${mine ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap break-words ${
                    isAi
                      ? 'bg-purple-50 border border-purple-200'
                      : mine
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-100'
                  }`}
                >
                  {m.body ?? ''}
                  <div className={`mt-1 text-[10px] ${mine ? 'text-blue-100' : 'text-gray-500'}`}>
                    {new Date(m.created_at).toLocaleString('ar-IQ')}
                    {isAi ? ' • 🤖' : ''}
                  </div>
                </div>
              </div>
            );
          })}

          {aiDraft !== null && (
            <div className="mb-2 flex justify-start">
              <div className="max-w-[80%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap break-words bg-purple-50 border border-purple-200">
                {aiDraft || '...'}
                <div className="mt-1 text-[10px] text-gray-500">يكتب... • 🤖</div>
              </div>
            </div>
          )}
        </div>

        <div className="mt-3 bg-white rounded-2xl shadow-sm border p-3">
          <div className="flex gap-2">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  onSend();
                }
              }}
              placeholder={autoEnabled ? 'اكتب رسالتك... (المساعد قد يرد تلقائياً)' : 'اكتب رسالتك... (اكتب @ai حتى يشارك المساعد)'}
              className="flex-1 border rounded-xl px-3 py-2 text-sm"
              disabled={sending}
            />
            <button
              onClick={onSend}
              disabled={sending}
              className="px-4 py-2 rounded-xl bg-blue-600 text-white text-sm disabled:opacity-60"
            >
              إرسال
            </button>
          </div>
          <div className="text-xs text-gray-500 mt-2">
            {hint}
          </div>
        </div>
      </div>
    </div>
  );
}
