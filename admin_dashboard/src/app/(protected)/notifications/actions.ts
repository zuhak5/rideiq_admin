'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requirePermission } from '@/lib/auth/guards';
import {
  cancelNotificationCampaign,
  previewNotificationCampaignAudience,
  sendNotificationCampaign,
  scheduleNotificationCampaign,
  type NotificationAudienceFilter,
  upsertNotificationCampaign,
} from '@/lib/admin/notifications';
import {
  type NotificationComposerState,
  type NotificationMutationState,
} from './state';

const routeKeySchema = z.enum([
  'notification_center',
  'home',
  'wallet',
  'rider_activity',
  'driver_requests',
  'merchant_orders',
]);

const categorySchema = z.enum(['operational', 'marketing']);
const roleSchema = z.enum(['rider', 'driver', 'merchant']);
const platformSchema = z.enum(['android', 'ios', 'web']);

const uuidListSchema = z.array(z.string().uuid()).max(1000);
const localeListSchema = z.array(z.string().trim().min(1).max(16)).max(20);

function splitList(raw: string): string[] {
  return raw
    .split(/[\s,]+/g)
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function readString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

function readOptionalString(formData: FormData, key: string): string | null {
  const value = readString(formData, key);
  return value.length > 0 ? value : null;
}

function parseDataJson(formData: FormData): Record<string, unknown> {
  const raw = readString(formData, 'dataJson');
  if (!raw) {
    return {};
  }
  const parsed = JSON.parse(raw);
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error('Route data must be a JSON object.');
  }
  return parsed as Record<string, unknown>;
}

function parseAudienceFilter(formData: FormData): Partial<NotificationAudienceFilter> {
  const includeUserIds = uuidListSchema.parse(splitList(readString(formData, 'includeUserIds')));
  const excludeUserIds = uuidListSchema.parse(splitList(readString(formData, 'excludeUserIds')));
  const locales = localeListSchema.parse(splitList(readString(formData, 'locales')));
  const roles = z.array(roleSchema).max(8).parse(formData.getAll('roles').map(String));
  const platforms = z.array(platformSchema).max(3).parse(formData.getAll('platforms').map(String));

  return {
    include_user_ids: includeUserIds,
    exclude_user_ids: excludeUserIds,
    roles,
    locales,
    platforms,
    has_tokens_only: formData.get('hasTokensOnly') === 'on',
    exclude_admins: formData.get('excludeAdmins') === 'on',
  };
}

function notificationPath(campaignId: string): string {
  return `/notifications?id=${encodeURIComponent(campaignId)}`;
}

export async function notificationComposerAction(
  _prev: NotificationComposerState,
  formData: FormData,
): Promise<NotificationComposerState> {
  try {
    const { supabase } = await requirePermission('notifications.manage');
    const intent = readString(formData, 'intent') || 'save';
    const audienceFilter = parseAudienceFilter(formData);

    if (intent === 'preview') {
      const preview = await previewNotificationCampaignAudience(supabase, audienceFilter);
      return {
        ok: true,
        error: null,
        notice: 'Audience preview updated.',
        preview,
        nextPath: null,
      };
    }

    const category = categorySchema.parse(readString(formData, 'category'));
    const title = z.string().trim().min(1).max(120).parse(readString(formData, 'title'));
    const body = z.string().max(500).nullable().parse(readOptionalString(formData, 'body'));
    const routeKey = routeKeySchema.parse(readString(formData, 'routeKey') || 'notification_center');
    const scheduledAtIso = readOptionalString(formData, 'scheduledAtIso');
    const campaignId = readOptionalString(formData, 'campaignId');

    const upserted = await upsertNotificationCampaign(supabase, {
      id: campaignId,
      category,
      title,
      body,
      route_key: routeKey,
      data: parseDataJson(formData),
      audience_filter: audienceFilter,
      scheduled_at: scheduledAtIso,
    });

    const nextPath = notificationPath(upserted.campaign.id);

    if (intent === 'send') {
      await sendNotificationCampaign(supabase, upserted.campaign.id);
      revalidatePath('/notifications');
      revalidatePath('/users');
      return {
        ok: true,
        error: null,
        notice: 'Campaign queued for immediate delivery.',
        preview: null,
        nextPath,
      };
    }

    if (intent === 'schedule') {
      if (!scheduledAtIso) {
        return {
          ok: false,
          error: 'Pick a schedule time before scheduling the campaign.',
          notice: null,
          preview: null,
          nextPath: null,
        };
      }
      await scheduleNotificationCampaign(supabase, upserted.campaign.id, scheduledAtIso);
      revalidatePath('/notifications');
      revalidatePath('/users');
      return {
        ok: true,
        error: null,
        notice: 'Campaign scheduled.',
        preview: null,
        nextPath,
      };
    }

    revalidatePath('/notifications');
    revalidatePath('/users');
    return {
      ok: true,
      error: null,
      notice: 'Draft saved.',
      preview: null,
      nextPath,
    };
  } catch (error) {
    return {
      ok: false,
      error: String((error as Error)?.message ?? error ?? 'Request failed'),
      notice: null,
      preview: null,
      nextPath: null,
    };
  }
}

export async function cancelNotificationCampaignAction(
  _prev: NotificationMutationState,
  formData: FormData,
): Promise<NotificationMutationState> {
  try {
    const { supabase } = await requirePermission('notifications.manage');
    const campaignId = z.string().uuid().parse(readString(formData, 'campaignId'));
    const note = z.string().max(300).nullable().parse(readOptionalString(formData, 'note'));

    await cancelNotificationCampaign(supabase, campaignId, note);
    revalidatePath('/notifications');

    return {
      ok: true,
      error: null,
      notice: 'Campaign cancelled.',
      nextPath: notificationPath(campaignId),
    };
  } catch (error) {
    return {
      ok: false,
      error: String((error as Error)?.message ?? error ?? 'Cancellation failed'),
      notice: null,
      nextPath: null,
    };
  }
}
