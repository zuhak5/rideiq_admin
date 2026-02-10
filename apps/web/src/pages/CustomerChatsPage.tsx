import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { listMyCustomerThreads } from '../lib/merchant';
import { supabase } from '../lib/supabaseClient';

type MerchantMini = {
  id: string;
  business_name: string;
  business_type: string;
  status: string;
};

async function fetchMerchantsMini(ids: string[]): Promise<MerchantMini[]> {
  if (ids.length === 0) return [];
  const { data, error } = await supabase
    .from('merchants')
    .select('id,business_name,business_type,status')
    .in('id', ids);
  if (error) throw error;
  return (data ?? []) as MerchantMini[];
}

export default function CustomerChatsPage() {
  const threadsQ = useQuery({ queryKey: ['customer-merchant-threads'], queryFn: listMyCustomerThreads });

  const merchantsQ = useQuery({
    queryKey: ['customer-merchant-threads-merchants', (threadsQ.data ?? []).map((t) => t.merchant_id).join(',')],
    queryFn: async () => {
      const ids = Array.from(new Set((threadsQ.data ?? []).map((t: any) => t.merchant_id)));
      return fetchMerchantsMini(ids);
    },
    enabled: Boolean(threadsQ.data),
  });

  const merchantMap = useMemo(() => {
    const m = new Map<string, MerchantMini>();
    for (const r of merchantsQ.data ?? []) m.set(r.id, r);
    return m;
  }, [merchantsQ.data]);

  return (
    <div className="max-w-3xl mx-auto p-4 space-y-4">
      <h1 className="text-xl font-semibold">Chats</h1>

      {threadsQ.isLoading ? <div className="text-sm text-gray-500">Loading…</div> : null}
      {threadsQ.error ? <div className="text-sm text-red-600">Failed to load chats.</div> : null}

      <div className="grid gap-2">
        {(threadsQ.data ?? []).map((t: any) => {
          const biz = merchantMap.get(t.merchant_id);
          return (
            <Link key={t.id} to={`/merchant-chat/${t.id}`} className="border rounded p-3 hover:bg-gray-50 transition">
              <div className="flex items-center justify-between gap-2">
                <div className="font-medium">{biz?.business_name ?? t.merchant_id}</div>
                {(() => {
                  const lm = t.last_message_at ? new Date(t.last_message_at).getTime() : null;
                  const lr = t.customer_last_read_at ? new Date(t.customer_last_read_at).getTime() : null;
                  const unread = lm != null && (lr == null || lm > lr);
                  return unread ? <span className="text-xs px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">Unread</span> : null;
                })()}
              </div>
              <div className="text-sm text-gray-600">{biz?.business_type ?? '—'}</div>
              <div className="text-xs text-gray-500 mt-1">Last message: {t.last_message_at ? new Date(t.last_message_at).toLocaleString() : '—'}</div>
              {biz?.status && biz.status !== 'approved' ? (
                <div className="text-xs text-amber-700 mt-1">Business status: {biz.status}</div>
              ) : null}
            </Link>
          );
        })}
        {(threadsQ.data ?? []).length === 0 && !threadsQ.isLoading ? (
          <div className="text-sm text-gray-500">No chats yet. Open a business and press “Chat”.</div>
        ) : null}
      </div>
    </div>
  );
}
