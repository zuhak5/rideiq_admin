'use client';

import { useActionState, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type {
  NotificationAudiencePreviewRow,
  NotificationCampaignRecipientRow,
  NotificationCampaignRow,
} from '@/lib/admin/notifications';
import {
  cancelNotificationCampaignAction,
  notificationComposerAction,
} from './actions';
import {
  initialNotificationComposerState,
  initialNotificationMutationState,
} from './state';

type Props = {
  canManage: boolean;
  initialCampaigns: NotificationCampaignRow[];
  page: { limit: number; offset: number; returned: number; total: number | null };
  initialQuery: string;
  initialStatus: string;
  selectedCampaign: { campaign: NotificationCampaignRow; recipients: NotificationCampaignRecipientRow[] } | null;
  prefillIncludeUserId: string | null;
};

const routeOptions = [
  'notification_center',
  'home',
  'wallet',
  'rider_activity',
  'driver_requests',
  'merchant_orders',
] as const;

const categoryOptions = ['operational', 'marketing'] as const;
const roleOptions = ['rider', 'driver', 'merchant'] as const;
const platformOptions = ['android', 'ios', 'web'] as const;
const editableStatuses = new Set(['draft', 'scheduled']);

function fmtTs(ts: string | null | undefined): string {
  if (!ts) return '—';
  const parsed = new Date(ts);
  return Number.isNaN(parsed.getTime()) ? String(ts) : parsed.toLocaleString();
}

function fmtLocalInputValue(ts: string | null | undefined): string {
  if (!ts) return '';
  const parsed = new Date(ts);
  if (Number.isNaN(parsed.getTime())) return '';
  const adjusted = new Date(parsed.getTime() - parsed.getTimezoneOffset() * 60_000);
  return adjusted.toISOString().slice(0, 16);
}

function toIsoFromLocalInput(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString();
}

function prettyJson(value: Record<string, unknown> | null | undefined): string {
  if (!value || Object.keys(value).length === 0) return '{}';
  return JSON.stringify(value, null, 2);
}

function csv(values: string[] | null | undefined): string {
  return (values ?? []).join('\n');
}

function statusTone(status: string): string {
  switch (status) {
    case 'completed':
      return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    case 'scheduled':
      return 'bg-blue-50 text-blue-700 border-blue-200';
    case 'running':
      return 'bg-amber-50 text-amber-700 border-amber-200';
    case 'failed':
      return 'bg-red-50 text-red-700 border-red-200';
    case 'cancelled':
      return 'bg-neutral-100 text-neutral-700 border-neutral-200';
    default:
      return 'bg-neutral-50 text-neutral-700 border-neutral-200';
  }
}

function AudiencePreviewTable({ preview }: { preview: { count: number; sample: NotificationAudiencePreviewRow[] } | null }) {
  if (!preview) {
    return (
      <div className="rounded-lg border border-dashed p-3 text-sm text-neutral-500">
        Run preview to estimate the audience before saving or sending.
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border bg-neutral-50 p-3">
      <div className="text-sm font-medium">Audience preview: {preview.count.toLocaleString()} users</div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-neutral-500">
            <tr>
              <th className="py-2 pr-3">Name</th>
              <th className="py-2 pr-3">Phone</th>
              <th className="py-2 pr-3">Role</th>
              <th className="py-2 pr-3">Locale</th>
              <th className="py-2 pr-3">Token</th>
              <th className="py-2 pr-0">Platforms</th>
            </tr>
          </thead>
          <tbody>
            {preview.sample.map((row) => (
              <tr key={row.id} className="border-t">
                <td className="py-2 pr-3">{row.display_name ?? '—'}</td>
                <td className="py-2 pr-3">{row.phone ?? '—'}</td>
                <td className="py-2 pr-3">{row.active_role ?? '—'}</td>
                <td className="py-2 pr-3">{row.locale ?? '—'}</td>
                <td className="py-2 pr-3">{row.has_enabled_token ? 'yes' : 'no'}</td>
                <td className="py-2 pr-0">{row.platforms.join(', ') || '—'}</td>
              </tr>
            ))}
            {preview.sample.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-4 text-center text-neutral-500">
                  No matching users.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function NotificationsClient({
  canManage,
  initialCampaigns,
  page,
  initialQuery,
  initialStatus,
  selectedCampaign,
  prefillIncludeUserId,
}: Props) {
  const router = useRouter();
  const [composerState, composerAction] = useActionState(notificationComposerAction as any, initialNotificationComposerState());
  const [cancelState, cancelAction] = useActionState(
    cancelNotificationCampaignAction as any,
    initialNotificationMutationState(),
  );

  const selected = selectedCampaign?.campaign ?? null;
  const selectedAudience = selected?.audience_filter;
  const selectedEditable = !selected || editableStatuses.has(selected.status);

  const initialIncludeUserIds = useMemo(() => {
    if (selectedAudience?.include_user_ids?.length) {
      return csv(selectedAudience.include_user_ids);
    }
    return prefillIncludeUserId ? prefillIncludeUserId : '';
  }, [prefillIncludeUserId, selectedAudience?.include_user_ids]);

  const [scheduledAtInput, setScheduledAtInput] = useState(fmtLocalInputValue(selected?.scheduled_at));

  useEffect(() => {
    setScheduledAtInput(fmtLocalInputValue(selected?.scheduled_at));
  }, [selected?.scheduled_at, selected?.id]);

  useEffect(() => {
    if (composerState.nextPath) {
      router.replace(composerState.nextPath);
      router.refresh();
    }
  }, [composerState.nextPath, router]);

  useEffect(() => {
    if (cancelState.nextPath) {
      router.replace(cancelState.nextPath);
      router.refresh();
    }
  }, [cancelState.nextPath, router]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Notifications</h1>
          <p className="text-sm text-neutral-500">
            Campaign drafting, delivery scheduling, user-targeted sends, and inbox delivery history.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/notifications" className="rounded-md border bg-white px-3 py-2 text-sm hover:bg-neutral-50">
            New campaign
          </Link>
          <form className="flex gap-2" action="/notifications" method="get">
            <input
              name="q"
              defaultValue={initialQuery}
              placeholder="Search title or body"
              className="rounded-md border bg-white px-3 py-2 text-sm"
            />
            <select name="status" defaultValue={initialStatus} className="rounded-md border bg-white px-3 py-2 text-sm">
              <option value="">All statuses</option>
              <option value="draft">Draft</option>
              <option value="scheduled">Scheduled</option>
              <option value="running">Running</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
              <option value="failed">Failed</option>
            </select>
            <button className="rounded-md bg-neutral-900 px-3 py-2 text-sm text-white hover:bg-neutral-800">
              Search
            </button>
          </form>
        </div>
      </div>

      {!canManage ? (
        <div className="rounded-xl border bg-white p-4 text-sm text-neutral-600">
          You have read access only. Campaign detail and delivery history remain visible below.
        </div>
      ) : (
        <div className="rounded-xl border bg-white p-4">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold">{selected ? 'Campaign composer' : 'New campaign composer'}</h2>
              <p className="text-sm text-neutral-500">
                Save a draft, preview the audience, send immediately, or schedule for later.
              </p>
            </div>
            {selected ? (
              <span className={`rounded-full border px-2 py-1 text-xs font-medium ${statusTone(selected.status)}`}>
                {selected.status}
              </span>
            ) : null}
          </div>

          {composerState.error ? (
            <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {composerState.error}
            </div>
          ) : null}
          {composerState.notice ? (
            <div className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
              {composerState.notice}
            </div>
          ) : null}
          {!selectedEditable ? (
            <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              This campaign is no longer editable. Use “New campaign” to create another send.
            </div>
          ) : null}

          <form action={composerAction} className="space-y-4">
            <input type="hidden" name="campaignId" value={selected?.id ?? ''} />
            <input type="hidden" name="scheduledAtIso" value={scheduledAtInput ? toIsoFromLocalInput(scheduledAtInput) : ''} />

            <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
              <label className="md:col-span-1">
                <div className="mb-1 text-xs font-medium text-neutral-600">Category</div>
                <select
                  name="category"
                  defaultValue={selected?.category ?? 'operational'}
                  disabled={!selectedEditable}
                  className="w-full rounded-md border px-3 py-2 text-sm"
                >
                  {categoryOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
              <label className="md:col-span-1">
                <div className="mb-1 text-xs font-medium text-neutral-600">Route</div>
                <select
                  name="routeKey"
                  defaultValue={selected?.route_key ?? 'notification_center'}
                  disabled={!selectedEditable}
                  className="w-full rounded-md border px-3 py-2 text-sm"
                >
                  {routeOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
              <label className="md:col-span-2">
                <div className="mb-1 text-xs font-medium text-neutral-600">Schedule time</div>
                <input
                  type="datetime-local"
                  value={scheduledAtInput}
                  disabled={!selectedEditable}
                  onChange={(event) => setScheduledAtInput(event.target.value)}
                  className="w-full rounded-md border px-3 py-2 text-sm"
                />
              </label>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <label>
                <div className="mb-1 text-xs font-medium text-neutral-600">Title</div>
                <input
                  name="title"
                  defaultValue={selected?.title ?? ''}
                  disabled={!selectedEditable}
                  maxLength={120}
                  required
                  className="w-full rounded-md border px-3 py-2 text-sm"
                />
              </label>
              <label>
                <div className="mb-1 text-xs font-medium text-neutral-600">Locales</div>
                <input
                  name="locales"
                  defaultValue={selectedAudience?.locales?.join(', ') ?? ''}
                  disabled={!selectedEditable}
                  placeholder="ar, en"
                  className="w-full rounded-md border px-3 py-2 text-sm"
                />
              </label>
            </div>

            <label>
              <div className="mb-1 text-xs font-medium text-neutral-600">Body</div>
              <textarea
                name="body"
                defaultValue={selected?.body ?? ''}
                disabled={!selectedEditable}
                rows={3}
                maxLength={500}
                className="w-full rounded-md border px-3 py-2 text-sm"
              />
            </label>

            <label>
              <div className="mb-1 text-xs font-medium text-neutral-600">Route data JSON</div>
              <textarea
                name="dataJson"
                defaultValue={prettyJson(selected?.data)}
                disabled={!selectedEditable}
                rows={6}
                className="w-full rounded-md border px-3 py-2 font-mono text-xs"
              />
            </label>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <label>
                <div className="mb-1 text-xs font-medium text-neutral-600">Include user IDs</div>
                <textarea
                  name="includeUserIds"
                  defaultValue={initialIncludeUserIds}
                  disabled={!selectedEditable}
                  rows={4}
                  className="w-full rounded-md border px-3 py-2 font-mono text-xs"
                />
              </label>
              <label>
                <div className="mb-1 text-xs font-medium text-neutral-600">Exclude user IDs</div>
                <textarea
                  name="excludeUserIds"
                  defaultValue={csv(selectedAudience?.exclude_user_ids)}
                  disabled={!selectedEditable}
                  rows={4}
                  className="w-full rounded-md border px-3 py-2 font-mono text-xs"
                />
              </label>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div>
                <div className="mb-2 text-xs font-medium text-neutral-600">Roles</div>
                <div className="flex flex-wrap gap-3">
                  {roleOptions.map((role) => (
                    <label key={role} className="flex items-center gap-2 text-sm text-neutral-700">
                      <input
                        type="checkbox"
                        name="roles"
                        value={role}
                        defaultChecked={selectedAudience?.roles?.includes(role) ?? false}
                        disabled={!selectedEditable}
                      />
                      {role}
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <div className="mb-2 text-xs font-medium text-neutral-600">Platforms</div>
                <div className="flex flex-wrap gap-3">
                  {platformOptions.map((platform) => (
                    <label key={platform} className="flex items-center gap-2 text-sm text-neutral-700">
                      <input
                        type="checkbox"
                        name="platforms"
                        value={platform}
                        defaultChecked={selectedAudience?.platforms?.includes(platform) ?? false}
                        disabled={!selectedEditable}
                      />
                      {platform}
                    </label>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <div className="text-xs font-medium text-neutral-600">Audience flags</div>
                <label className="flex items-center gap-2 text-sm text-neutral-700">
                  <input
                    type="checkbox"
                    name="hasTokensOnly"
                    defaultChecked={selectedAudience?.has_tokens_only ?? false}
                    disabled={!selectedEditable}
                  />
                  Users with enabled tokens only
                </label>
                <label className="flex items-center gap-2 text-sm text-neutral-700">
                  <input
                    type="checkbox"
                    name="excludeAdmins"
                    defaultChecked={selectedAudience?.exclude_admins ?? true}
                    disabled={!selectedEditable}
                  />
                  Exclude admins
                </label>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="submit"
                name="intent"
                value="preview"
                className="rounded-md border px-3 py-2 text-sm hover:bg-neutral-50"
                disabled={!selectedEditable}
              >
                Preview audience
              </button>
              <button
                type="submit"
                name="intent"
                value="save"
                className="rounded-md border px-3 py-2 text-sm hover:bg-neutral-50"
                disabled={!selectedEditable}
              >
                Save draft
              </button>
              <button
                type="submit"
                name="intent"
                value="send"
                className="rounded-md bg-neutral-900 px-3 py-2 text-sm text-white hover:bg-neutral-800"
                disabled={!selectedEditable}
              >
                Send now
              </button>
              <button
                type="submit"
                name="intent"
                value="schedule"
                className="rounded-md border border-blue-300 bg-blue-50 px-3 py-2 text-sm text-blue-700 hover:bg-blue-100"
                disabled={!selectedEditable}
              >
                Schedule
              </button>
            </div>
          </form>

          <div className="mt-4">
            <AudiencePreviewTable preview={composerState.preview} />
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="overflow-hidden rounded-xl border bg-white">
          <table className="w-full text-sm">
            <thead className="border-b bg-neutral-50">
              <tr>
                <th className="px-4 py-3 text-left font-medium">Campaign</th>
                <th className="px-4 py-3 text-left font-medium">Status</th>
                <th className="px-4 py-3 text-left font-medium">Audience</th>
                <th className="px-4 py-3 text-left font-medium">Push</th>
                <th className="px-4 py-3 text-left font-medium">Scheduled</th>
                <th className="px-4 py-3 text-left font-medium">Reads</th>
              </tr>
            </thead>
            <tbody>
              {initialCampaigns.map((campaign) => (
                <tr
                  key={campaign.id}
                  className={`border-b last:border-b-0 ${selected?.id === campaign.id ? 'bg-blue-50/40' : ''}`}
                >
                  <td className="px-4 py-3 align-top">
                    <Link href={`/notifications?id=${encodeURIComponent(campaign.id)}`} className="font-medium hover:underline">
                      {campaign.title}
                    </Link>
                    <div className="mt-1 text-xs text-neutral-500">
                      {campaign.category} · {campaign.route_key}
                    </div>
                    {campaign.body ? <div className="mt-1 text-xs text-neutral-600">{campaign.body}</div> : null}
                  </td>
                  <td className="px-4 py-3 align-top">
                    <span className={`rounded-full border px-2 py-1 text-xs font-medium ${statusTone(campaign.status)}`}>
                      {campaign.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 align-top">{campaign.estimated_recipients ?? 0}</td>
                  <td className="px-4 py-3 align-top">
                    {campaign.push_sent ?? 0}/{(campaign.push_failed ?? 0) + (campaign.push_sent ?? 0)}
                  </td>
                  <td className="px-4 py-3 align-top">{fmtTs(campaign.scheduled_at)}</td>
                  <td className="px-4 py-3 align-top">{campaign.read_count ?? 0}</td>
                </tr>
              ))}
              {initialCampaigns.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm text-neutral-500">
                    No campaigns found for this filter.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>

          <div className="flex items-center justify-between border-t bg-neutral-50 px-4 py-3 text-xs text-neutral-500">
            <div>
              Showing {page.returned} campaigns (offset {page.offset}, total {page.total ?? '—'})
            </div>
            <div className="flex gap-2">
              <Link
                className="rounded-md border bg-white px-2 py-1 hover:bg-neutral-50"
                href={`/notifications?q=${encodeURIComponent(initialQuery)}&status=${encodeURIComponent(initialStatus)}&offset=${Math.max(0, page.offset - page.limit)}`}
              >
                Prev
              </Link>
              <Link
                className="rounded-md border bg-white px-2 py-1 hover:bg-neutral-50"
                href={`/notifications?q=${encodeURIComponent(initialQuery)}&status=${encodeURIComponent(initialStatus)}&offset=${page.offset + page.limit}`}
              >
                Next
              </Link>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-xl border bg-white p-4">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold">Campaign detail</h2>
                <p className="text-sm text-neutral-500">Frozen audience, inbox creation, and delivery state.</p>
              </div>
              {selected ? (
                <span className={`rounded-full border px-2 py-1 text-xs font-medium ${statusTone(selected.status)}`}>
                  {selected.status}
                </span>
              ) : null}
            </div>

            {!selected ? (
              <div className="rounded-lg border border-dashed p-3 text-sm text-neutral-500">
                Select a campaign from the table to inspect recipients and delivery history.
              </div>
            ) : (
              <div className="space-y-4">
                {cancelState.error ? (
                  <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                    {cancelState.error}
                  </div>
                ) : null}
                {cancelState.notice ? (
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
                    {cancelState.notice}
                  </div>
                ) : null}

                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-lg border bg-neutral-50 p-3">
                    <div className="text-xs text-neutral-500">Estimated recipients</div>
                    <div className="mt-1 text-lg font-semibold">{selected.estimated_recipients ?? 0}</div>
                  </div>
                  <div className="rounded-lg border bg-neutral-50 p-3">
                    <div className="text-xs text-neutral-500">Inbox created</div>
                    <div className="mt-1 text-lg font-semibold">{selected.inbox_created ?? 0}</div>
                  </div>
                  <div className="rounded-lg border bg-neutral-50 p-3">
                    <div className="text-xs text-neutral-500">Push sent</div>
                    <div className="mt-1 text-lg font-semibold">{selected.push_sent ?? 0}</div>
                  </div>
                  <div className="rounded-lg border bg-neutral-50 p-3">
                    <div className="text-xs text-neutral-500">Push failed</div>
                    <div className="mt-1 text-lg font-semibold">{selected.push_failed ?? 0}</div>
                  </div>
                  <div className="rounded-lg border bg-neutral-50 p-3">
                    <div className="text-xs text-neutral-500">Read count</div>
                    <div className="mt-1 text-lg font-semibold">{selected.read_count ?? 0}</div>
                  </div>
                  <div className="rounded-lg border bg-neutral-50 p-3">
                    <div className="text-xs text-neutral-500">Scheduled</div>
                    <div className="mt-1 text-sm font-medium">{fmtTs(selected.scheduled_at)}</div>
                  </div>
                </div>

                {selected.last_error ? (
                  <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                    {selected.last_error}
                  </div>
                ) : null}

                {canManage && editableStatuses.has(selected.status) ? (
                  <form action={cancelAction} className="space-y-2 rounded-lg border p-3">
                    <input type="hidden" name="campaignId" value={selected.id} />
                    <div className="text-sm font-medium">Cancel campaign</div>
                    <textarea
                      name="note"
                      rows={2}
                      maxLength={300}
                      placeholder="Optional audit note"
                      className="w-full rounded-md border px-3 py-2 text-sm"
                    />
                    <button
                      type="submit"
                      className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 hover:bg-red-100"
                    >
                      Cancel campaign
                    </button>
                  </form>
                ) : null}

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="text-neutral-500">
                      <tr>
                        <th className="py-2 pr-3">User</th>
                        <th className="py-2 pr-3">Role</th>
                        <th className="py-2 pr-3">Push</th>
                        <th className="py-2 pr-3">Read</th>
                        <th className="py-2 pr-0">Reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedCampaign?.recipients.map((recipient) => (
                        <tr key={recipient.id} className="border-t">
                          <td className="py-2 pr-3">
                            <div>{recipient.profile?.display_name ?? recipient.user_id}</div>
                            <div className="text-[11px] text-neutral-500">{recipient.profile?.phone ?? recipient.user_id}</div>
                          </td>
                          <td className="py-2 pr-3">{recipient.profile?.active_role ?? '—'}</td>
                          <td className="py-2 pr-3">
                            <div>{recipient.push_status}</div>
                            <div className="text-[11px] text-neutral-500">
                              {recipient.push_sent_at
                                ? fmtTs(recipient.push_sent_at)
                                : recipient.push_failed_at
                                  ? fmtTs(recipient.push_failed_at)
                                  : '—'}
                            </div>
                          </td>
                          <td className="py-2 pr-3">{recipient.notification?.read_at ? fmtTs(recipient.notification.read_at) : 'Unread'}</td>
                          <td className="py-2 pr-0">{recipient.push_reason ?? '—'}</td>
                        </tr>
                      ))}
                      {selectedCampaign?.recipients.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="py-4 text-center text-neutral-500">
                            No recipient rows yet.
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
