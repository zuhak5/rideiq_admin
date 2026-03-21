import { unstable_noStore as noStore } from 'next/cache';
import type { SupabaseClient } from '@supabase/supabase-js';
import { invokeEdgeFunction } from '@/lib/supabase/edge';

export type NotificationAudienceFilter = {
  include_user_ids: string[];
  exclude_user_ids: string[];
  roles: string[];
  locales: string[];
  platforms: string[];
  has_tokens_only: boolean;
  exclude_admins: boolean;
};

export type NotificationCampaignRow = {
  id: string;
  status: 'draft' | 'scheduled' | 'running' | 'completed' | 'cancelled' | 'failed';
  category: 'operational' | 'marketing';
  title: string;
  body: string | null;
  route_key:
    | 'notification_center'
    | 'home'
    | 'wallet'
    | 'rider_activity'
    | 'driver_requests'
    | 'merchant_orders';
  data: Record<string, unknown>;
  audience_filter: NotificationAudienceFilter;
  scheduled_at: string | null;
  created_by: string;
  created_at?: string;
  updated_at?: string;
  started_at?: string | null;
  completed_at?: string | null;
  cancelled_at?: string | null;
  last_error?: string | null;
  estimated_recipients?: number | null;
  inbox_created?: number;
  push_sent?: number;
  push_failed?: number;
  read_count?: number;
};

export type NotificationAudiencePreviewRow = {
  id: string;
  display_name: string | null;
  phone: string | null;
  active_role: string | null;
  locale: string | null;
  is_admin: boolean;
  has_enabled_token: boolean;
  platforms: string[];
};

export type NotificationCampaignRecipientRow = {
  id: number;
  user_id: string;
  user_notification_id: string | null;
  push_status: 'pending' | 'sent' | 'failed' | 'suppressed' | 'skipped';
  push_reason: string | null;
  created_at: string;
  push_sent_at: string | null;
  push_failed_at: string | null;
  profile: {
    id: string;
    display_name: string | null;
    phone: string | null;
    active_role: string | null;
    locale: string | null;
  } | null;
  notification: {
    id: string;
    read_at: string | null;
  } | null;
};

export async function listNotificationCampaigns(
  supabase: SupabaseClient,
  args: { q?: string; status?: string; limit?: number; offset?: number } = {},
): Promise<{
  campaigns: NotificationCampaignRow[];
  page: { limit: number; offset: number; returned: number; total: number | null };
}> {
  noStore();
  return invokeEdgeFunction(supabase, 'admin-api', {
    path: 'admin-notification-campaigns-list',
    method: 'POST',
    body: {
      q: args.q ?? '',
      status: args.status ?? null,
      limit: args.limit ?? 25,
      offset: args.offset ?? 0,
    },
  });
}

export async function getNotificationCampaign(
  supabase: SupabaseClient,
  id: string,
): Promise<{
  campaign: NotificationCampaignRow;
  recipients: NotificationCampaignRecipientRow[];
}> {
  noStore();
  return invokeEdgeFunction(supabase, 'admin-api', {
    path: 'admin-notification-campaign-get',
    method: 'GET',
    query: { id },
  });
}

export async function previewNotificationCampaignAudience(
  supabase: SupabaseClient,
  audience_filter: Partial<NotificationAudienceFilter>,
): Promise<{
  count: number;
  sample: NotificationAudiencePreviewRow[];
}> {
  return invokeEdgeFunction(supabase, 'admin-api', {
    path: 'admin-notification-campaign-preview',
    method: 'POST',
    body: { audience_filter },
  });
}

export async function upsertNotificationCampaign(
  supabase: SupabaseClient,
  body: {
    id?: string | null;
    category: NotificationCampaignRow['category'];
    title: string;
    body?: string | null;
    route_key: NotificationCampaignRow['route_key'];
    data?: Record<string, unknown>;
    audience_filter?: Partial<NotificationAudienceFilter>;
    scheduled_at?: string | null;
  },
): Promise<{ ok: boolean; campaign: NotificationCampaignRow }> {
  return invokeEdgeFunction(supabase, 'admin-api', {
    path: 'admin-notification-campaign-upsert',
    method: 'POST',
    body,
  });
}

export async function sendNotificationCampaign(
  supabase: SupabaseClient,
  id: string,
): Promise<{ ok: boolean; scheduled_at: string }> {
  return invokeEdgeFunction(supabase, 'admin-api', {
    path: 'admin-notification-campaign-send',
    method: 'POST',
    body: { id },
  });
}

export async function scheduleNotificationCampaign(
  supabase: SupabaseClient,
  id: string,
  scheduled_at: string,
): Promise<{ ok: boolean; scheduled_at: string }> {
  return invokeEdgeFunction(supabase, 'admin-api', {
    path: 'admin-notification-campaign-schedule',
    method: 'POST',
    body: { id, scheduled_at },
  });
}

export async function cancelNotificationCampaign(
  supabase: SupabaseClient,
  id: string,
  note?: string | null,
): Promise<{ ok: boolean; cancelled_at: string }> {
  return invokeEdgeFunction(supabase, 'admin-api', {
    path: 'admin-notification-campaign-cancel',
    method: 'POST',
    body: { id, note: note ?? null },
  });
}
