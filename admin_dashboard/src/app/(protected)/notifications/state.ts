import type { NotificationAudiencePreviewRow } from '@/lib/admin/notifications';

export type NotificationComposerState = {
  ok: boolean;
  error: string | null;
  notice: string | null;
  preview: {
    count: number;
    sample: NotificationAudiencePreviewRow[];
  } | null;
  nextPath: string | null;
};

export type NotificationMutationState = {
  ok: boolean;
  error: string | null;
  notice: string | null;
  nextPath: string | null;
};

export function initialNotificationComposerState(): NotificationComposerState {
  return {
    ok: true,
    error: null,
    notice: null,
    preview: null,
    nextPath: null,
  };
}

export function initialNotificationMutationState(): NotificationMutationState {
  return {
    ok: true,
    error: null,
    notice: null,
    nextPath: null,
  };
}
