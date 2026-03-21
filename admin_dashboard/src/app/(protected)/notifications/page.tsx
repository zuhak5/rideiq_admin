import { redirect } from 'next/navigation';
import { getAdminContext } from '@/lib/auth/guards';
import {
  getNotificationCampaign,
  listNotificationCampaigns,
  type NotificationCampaignRow,
} from '@/lib/admin/notifications';
import NotificationsClient from './notificationsClient';

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams?: {
    q?: string;
    status?: string;
    offset?: string;
    id?: string;
    include_user_id?: string;
  };
}) {
  const ctx = await getAdminContext();
  if (!ctx.can('notifications.read')) {
    redirect('/forbidden?permission=notifications.read');
  }

  const q = (searchParams?.q ?? '').trim();
  const status = (searchParams?.status ?? '').trim();
  const offset = Math.max(0, Number(searchParams?.offset ?? 0) || 0);
  const selectedId = (searchParams?.id ?? '').trim();
  const includeUserId = (searchParams?.include_user_id ?? '').trim();

  const campaignsRes = await listNotificationCampaigns(ctx.supabase, {
    q,
    status,
    offset,
    limit: 25,
  });

  let selectedCampaign:
    | {
        campaign: NotificationCampaignRow;
        recipients: Awaited<ReturnType<typeof getNotificationCampaign>>['recipients'];
      }
    | null = null;

  if (selectedId) {
    try {
      selectedCampaign = await getNotificationCampaign(ctx.supabase, selectedId);
    } catch {
      selectedCampaign = null;
    }
  }

  return (
    <NotificationsClient
      canManage={ctx.can('notifications.manage')}
      initialCampaigns={campaignsRes.campaigns}
      page={campaignsRes.page}
      initialQuery={q}
      initialStatus={status}
      selectedCampaign={selectedCampaign}
      prefillIncludeUserId={includeUserId || null}
    />
  );
}
