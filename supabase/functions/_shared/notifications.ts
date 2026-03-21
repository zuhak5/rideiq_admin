import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.92.0';

export const NOTIFICATION_ROUTE_KEYS = [
  'notification_center',
  'home',
  'wallet',
  'rider_activity',
  'driver_requests',
  'merchant_orders',
] as const;

export const NOTIFICATION_CATEGORIES = ['operational', 'marketing'] as const;
export const NOTIFICATION_AUDIENCE_ROLES = ['rider', 'driver', 'merchant'] as const;
export const NOTIFICATION_AUDIENCE_PLATFORMS = ['android', 'ios', 'web'] as const;

export type NotificationRouteKey = (typeof NOTIFICATION_ROUTE_KEYS)[number];
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export type CampaignAudienceFilter = {
  include_user_ids: string[];
  exclude_user_ids: string[];
  roles: string[];
  locales: string[];
  platforms: string[];
  has_tokens_only: boolean;
  exclude_admins: boolean;
};

export type AudiencePreviewRow = {
  id: string;
  display_name: string | null;
  phone: string | null;
  active_role: string | null;
  locale: string | null;
  is_admin: boolean;
  has_enabled_token: boolean;
  platforms: string[];
};

export type NotificationCampaignRow = {
  id: string;
  status: string;
  category: NotificationCategory;
  title: string;
  body: string | null;
  route_key: NotificationRouteKey;
  data: Record<string, unknown>;
  audience_filter: CampaignAudienceFilter;
  scheduled_at: string | null;
  created_by: string;
};

type DeviceTokenLite = {
  id: number;
  user_id: string;
  platform: string;
};

function uniqueStrings(values: Iterable<string>): string[] {
  return Array.from(
    new Set(
      Array.from(values)
        .map((value) => String(value ?? '').trim())
        .filter((value) => value.length > 0),
    ),
  );
}

export function normalizeAudienceFilter(input: Partial<CampaignAudienceFilter> | Record<string, unknown> | null | undefined): CampaignAudienceFilter {
  const raw = (input ?? {}) as Record<string, unknown>;
  const include = Array.isArray(raw.include_user_ids) ? raw.include_user_ids : [];
  const exclude = Array.isArray(raw.exclude_user_ids) ? raw.exclude_user_ids : [];
  const roles = Array.isArray(raw.roles) ? raw.roles : [];
  const locales = Array.isArray(raw.locales) ? raw.locales : [];
  const platforms = Array.isArray(raw.platforms) ? raw.platforms : [];
  return {
    include_user_ids: uniqueStrings(include as string[]),
    exclude_user_ids: uniqueStrings(exclude as string[]),
    roles: uniqueStrings(roles as string[]).filter((value) => NOTIFICATION_AUDIENCE_ROLES.includes(value as any)),
    locales: uniqueStrings(locales as string[]),
    platforms: uniqueStrings(platforms as string[]).filter((value) => NOTIFICATION_AUDIENCE_PLATFORMS.includes(value as any)),
    has_tokens_only: raw.has_tokens_only === true,
    exclude_admins: raw.exclude_admins !== false,
  };
}

async function listMatchingDeviceTokens(
  supabase: SupabaseClient,
  platforms: string[],
): Promise<DeviceTokenLite[]> {
  const rows: DeviceTokenLite[] = [];
  let from = 0;
  const pageSize = 1000;

  while (true) {
    let query = supabase
      .from('device_tokens')
      .select('id,user_id,platform')
      .eq('enabled', true)
      .is('disabled_at', null)
      .order('id', { ascending: true })
      .range(from, from + pageSize - 1);

    if (platforms.length > 0) {
      query = query.in('platform', platforms);
    }

    const { data, error } = await query;
    if (error) {
      throw new Error(`device_tokens query failed: ${error.message}`);
    }

    const chunk = (data ?? []).map((row: any) => ({
      id: Number(row.id),
      user_id: String(row.user_id),
      platform: String(row.platform),
    }));
    rows.push(...chunk);

    if (chunk.length < pageSize) {
      break;
    }
    from += pageSize;
  }

  return rows;
}

async function listMatchingProfiles(
  supabase: SupabaseClient,
  filter: CampaignAudienceFilter,
): Promise<Array<{
  id: string;
  display_name: string | null;
  phone: string | null;
  active_role: string | null;
  locale: string | null;
  is_admin: boolean;
}>> {
  const rows: Array<{
    id: string;
    display_name: string | null;
    phone: string | null;
    active_role: string | null;
    locale: string | null;
    is_admin: boolean;
  }> = [];
  let from = 0;
  const pageSize = 1000;

  while (true) {
    let query = supabase
      .from('profiles')
      .select('id,display_name,phone,active_role,locale,is_admin')
      .order('id', { ascending: true })
      .range(from, from + pageSize - 1);

    if (filter.roles.length > 0) {
      query = query.in('active_role', filter.roles);
    }
    if (filter.locales.length > 0) {
      query = query.in('locale', filter.locales);
    }
    if (filter.exclude_admins) {
      query = query.eq('is_admin', false);
    }
    if (filter.include_user_ids.length > 0) {
      query = query.in('id', filter.include_user_ids);
    }

    const { data, error } = await query;
    if (error) {
      throw new Error(`profiles query failed: ${error.message}`);
    }

    const chunk = (data ?? []).map((row: any) => ({
      id: String(row.id),
      display_name: row.display_name ?? null,
      phone: row.phone ?? null,
      active_role: row.active_role ?? null,
      locale: row.locale ?? null,
      is_admin: Boolean(row.is_admin),
    }));
    rows.push(...chunk);

    if (chunk.length < pageSize) {
      break;
    }
    from += pageSize;
  }

  return rows;
}

export async function previewCampaignAudience(
  supabase: SupabaseClient,
  rawFilter: Partial<CampaignAudienceFilter> | Record<string, unknown> | null | undefined,
): Promise<{ count: number; sample: AudiencePreviewRow[]; userIds: string[]; tokenUserIds: Set<string> }> {
  const filter = normalizeAudienceFilter(rawFilter);
  const matchingTokens =
    filter.has_tokens_only || filter.platforms.length > 0
      ? await listMatchingDeviceTokens(supabase, filter.platforms)
      : [];
  const tokenMap = new Map<string, Set<string>>();
  for (const token of matchingTokens) {
    if (!tokenMap.has(token.user_id)) {
      tokenMap.set(token.user_id, new Set<string>());
    }
    tokenMap.get(token.user_id)!.add(token.platform);
  }

  const profiles = await listMatchingProfiles(supabase, filter);
  const excluded = new Set(filter.exclude_user_ids);

  const filtered = profiles.filter((row) => {
    if (excluded.has(row.id)) {
      return false;
    }
    if (filter.has_tokens_only && !tokenMap.has(row.id)) {
      return false;
    }
    if (filter.platforms.length > 0 && !tokenMap.has(row.id)) {
      return false;
    }
    return true;
  });

  const userIds = filtered.map((row) => row.id);
  const sample = filtered.slice(0, 25).map((row) => {
    const platforms = Array.from(tokenMap.get(row.id) ?? []);
    return {
      ...row,
      has_enabled_token: platforms.length > 0,
      platforms,
    };
  });

  return {
    count: filtered.length,
    sample,
    userIds,
    tokenUserIds: new Set(tokenMap.keys()),
  };
}

function safeJsonData(input: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const raw = input ?? {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined) continue;
    out[key] = value;
  }
  return out;
}

export async function executeCampaign(
  supabase: SupabaseClient,
  campaign: NotificationCampaignRow,
): Promise<{
  recipientsCount: number;
  inboxCreated: number;
  pushSent: number;
  pushFailed: number;
  readCount: number;
}> {
  const audience = await previewCampaignAudience(supabase, campaign.audience_filter);
  const userIds = audience.userIds;
  const recipientsCount = userIds.length;
  const tokenUserIds = audience.tokenUserIds;

  if (recipientsCount === 0) {
    await supabase
      .from('notification_campaigns')
      .update({
        estimated_recipients: 0,
        inbox_created: 0,
        push_sent: 0,
        push_failed: 0,
        read_count: 0,
        status: 'completed',
        completed_at: new Date().toISOString(),
        last_error: null,
      })
      .eq('id', campaign.id);

    return {
      recipientsCount: 0,
      inboxCreated: 0,
      pushSent: 0,
      pushFailed: 0,
      readCount: 0,
    };
  }

  const { data: prefsRows, error: prefsError } = await supabase
    .from('user_notification_preferences')
    .select('user_id,marketing_push_enabled,marketing_inapp_enabled')
    .in('user_id', userIds);
  if (prefsError) {
    throw new Error(`user_notification_preferences query failed: ${prefsError.message}`);
  }

  const prefsMap = new Map<string, { marketing_push_enabled: boolean; marketing_inapp_enabled: boolean }>();
  for (const row of prefsRows ?? []) {
    prefsMap.set(String((row as any).user_id), {
      marketing_push_enabled: Boolean((row as any).marketing_push_enabled),
      marketing_inapp_enabled: Boolean((row as any).marketing_inapp_enabled),
    });
  }

  const recipientRows = userIds.map((userId) => {
    const prefs = prefsMap.get(userId) ?? {
      marketing_push_enabled: true,
      marketing_inapp_enabled: true,
    };
    const isMarketing = campaign.category === 'marketing';
    const allowInApp = !isMarketing || prefs.marketing_inapp_enabled;
    const allowPush = !isMarketing || prefs.marketing_push_enabled;
    const hasToken = tokenUserIds.has(userId);
    let pushStatus = 'pending';
    let pushReason: string | null = null;

    if (!allowInApp) {
      pushStatus = 'suppressed';
      pushReason = 'marketing_inapp_disabled';
    } else if (!allowPush) {
      pushStatus = 'suppressed';
      pushReason = 'marketing_push_disabled';
    } else if (!hasToken) {
      pushStatus = 'skipped';
      pushReason = 'no_enabled_token';
    }

    return {
      campaign_id: campaign.id,
      user_id: userId,
      push_status: pushStatus,
      push_reason: pushReason,
    };
  });

  const { error: recipientsError } = await supabase
    .from('notification_campaign_recipients')
    .upsert(recipientRows, { onConflict: 'campaign_id,user_id', ignoreDuplicates: false });
  if (recipientsError) {
    throw new Error(`notification_campaign_recipients upsert failed: ${recipientsError.message}`);
  }

  const notificationRows = recipientRows
    .filter((row) => row.push_reason !== 'marketing_inapp_disabled')
    .map((row) => {
      const payloadData = safeJsonData(campaign.data);
      return {
        user_id: row.user_id,
        kind: `campaign:${campaign.category}`,
        title: campaign.title,
        body: campaign.body,
        data: {
          ...payloadData,
          campaign_id: campaign.id,
          route_key: campaign.route_key,
          push: row.push_reason === 'marketing_push_disabled' ? false : payloadData.push ?? true,
        },
      };
    });

  let insertedNotifications: Array<{ id: string; user_id: string }> = [];
  if (notificationRows.length > 0) {
    const { data, error } = await supabase
      .from('user_notifications')
      .insert(notificationRows)
      .select('id,user_id');
    if (error) {
      throw new Error(`user_notifications insert failed: ${error.message}`);
    }
    insertedNotifications = (data ?? []).map((row: any) => ({
      id: String(row.id),
      user_id: String(row.user_id),
    }));
  }

  const insertedByUser = new Map(insertedNotifications.map((row) => [row.user_id, row.id]));
  if (insertedByUser.size > 0) {
    const updates = recipientRows
      .filter((row) => insertedByUser.has(row.user_id))
      .map((row) => ({
        campaign_id: campaign.id,
        user_id: row.user_id,
        user_notification_id: insertedByUser.get(row.user_id)!,
      }));

    const { error } = await supabase
      .from('notification_campaign_recipients')
      .upsert(updates, { onConflict: 'campaign_id,user_id', ignoreDuplicates: false });
    if (error) {
      throw new Error(`notification_campaign_recipients notification link failed: ${error.message}`);
    }
  }

  const pushSent = recipientRows.filter((row) => row.push_status === 'sent').length;
  const pushFailed = recipientRows.filter((row) => row.push_status === 'failed').length;

  const { error: updateError } = await supabase
    .from('notification_campaigns')
    .update({
      status: 'completed',
      estimated_recipients: recipientsCount,
      inbox_created: insertedNotifications.length,
      push_sent: pushSent,
      push_failed: pushFailed,
      read_count: 0,
      completed_at: new Date().toISOString(),
      last_error: null,
    })
    .eq('id', campaign.id);
  if (updateError) {
    throw new Error(`notification_campaigns update failed: ${updateError.message}`);
  }

  return {
    recipientsCount,
    inboxCreated: insertedNotifications.length,
    pushSent,
    pushFailed,
    readCount: 0,
  };
}

export async function refreshCampaignReadCount(
  supabase: SupabaseClient,
  campaignId: string,
): Promise<number> {
  const { data, error } = await supabase
    .from('notification_campaign_recipients')
    .select('user_notification_id,user_notifications!left(read_at)')
    .eq('campaign_id', campaignId);
  if (error) {
    throw new Error(`campaign read count query failed: ${error.message}`);
  }
  const count = (data ?? []).filter((row: any) => row.user_notifications?.read_at).length;
  const { error: updateError } = await supabase
    .from('notification_campaigns')
    .update({ read_count: count })
    .eq('id', campaignId);
  if (updateError) {
    throw new Error(`campaign read count update failed: ${updateError.message}`);
  }
  return count;
}

export async function insertAdminNotificationAudit(
  supabase: SupabaseClient,
  actorId: string,
  action: string,
  note: string | null,
  details: Record<string, unknown>,
) {
  await supabase.from('admin_audit_log').insert({
    actor_id: actorId,
    action,
    target_user_id: actorId,
    note,
    details,
  } as any);
}
