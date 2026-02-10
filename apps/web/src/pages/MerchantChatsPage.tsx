import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { fetchPublicProfiles, getMyMerchant, listMerchantThreadsForOwner } from '../lib/merchant';

export default function MerchantChatsPage() {
  const merchantQ = useQuery({ queryKey: ['merchant', 'mine'], queryFn: getMyMerchant });
  const merchantId = merchantQ.data?.id;

  const threadsQ = useQuery({
    queryKey: ['merchant-threads', merchantId],
    queryFn: () => listMerchantThreadsForOwner(merchantId!),
    enabled: Boolean(merchantId),
  });

  const profilesQ = useQuery({
    queryKey: ['merchant-threads-profiles', merchantId, (threadsQ.data ?? []).map((t) => t.customer_id).join(',')],
    queryFn: async () => {
      const ids = Array.from(new Set((threadsQ.data ?? []).map((t: any) => t.customer_id)));
      return fetchPublicProfiles(ids);
    },
    enabled: Boolean(merchantId) && Boolean(threadsQ.data),
  });

  const profileMap = useMemo(() => {
    const m = new Map<string, any>();
    for (const p of profilesQ.data ?? []) m.set(p.id, p);
    return m;
  }, [profilesQ.data]);

  if (merchantQ.isLoading) return <div className="p-4 text-sm text-gray-500">Loading…</div>;
  if (merchantQ.error) return <div className="p-4 text-sm text-red-600">Failed to load business.</div>;
  if (!merchantQ.data) return <div className="p-4 text-sm text-gray-600">Create a business first in /merchant.</div>;

  return (
    <div className="max-w-3xl mx-auto p-4 space-y-4">
      <h1 className="text-xl font-semibold">Chats</h1>

      {threadsQ.isLoading && <div className="text-sm text-gray-500">Loading…</div>}
      {threadsQ.error && <div className="text-sm text-red-600">Failed to load chats.</div>}

      <div className="grid gap-2">
        {(threadsQ.data ?? []).map((t: any) => {
          const p = profileMap.get(t.customer_id);
          return (
            <Link key={t.id} to={`/merchant-chat/${t.id}`} className="border rounded p-3 hover:bg-gray-50 transition">
              <div className="flex items-center justify-between gap-2">
                <div className="font-medium">{p?.display_name ?? t.customer_id}</div>
                {(() => {
                  const lm = t.last_message_at ? new Date(t.last_message_at).getTime() : null;
                  const lr = t.merchant_last_read_at ? new Date(t.merchant_last_read_at).getTime() : null;
                  const unread = lm != null && (lr == null || lm > lr);
                  return unread ? <span className="text-xs px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">Unread</span> : null;
                })()}
              </div>
              <div className="text-xs text-gray-500">Last message: {t.last_message_at ? new Date(t.last_message_at).toLocaleString() : '—'}</div>
            </Link>
          );
        })}
        {(threadsQ.data ?? []).length === 0 && !threadsQ.isLoading && <div className="text-sm text-gray-500">No chats yet.</div>}
      </div>
    </div>
  );
}
