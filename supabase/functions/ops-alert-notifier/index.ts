import { requireCronSecret } from '../_shared/cronAuth.ts';
import { errorJson, json } from '../_shared/json.ts';
import { withRequestContext, type RequestContext } from '../_shared/requestContext.ts';
import { createServiceClient } from '../_shared/supabase.ts';
import { envTrim } from '../_shared/config.ts';
import { getAppEnv } from '../_shared/env.ts';
import { emitMetricBestEffort } from '../_shared/metrics.ts';

type AlertEventRow = {
  id: string;
  rule_id: string;
  occurred_at: string;
  event_type: 'triggered' | 'resolved' | 'note';
  message: string | null;
  value: Record<string, unknown>;
  notify_status: string | null;
  notified_attempts: number;
};

type RuleRow = {
  id: string;
  name: string;
  kind: string;
  severity: 'page' | 'ticket';
  config: Record<string, unknown>;
};

type StateRow = {
  rule_id: string;
  is_active: boolean;
  active_since: string | null;
  last_message: string | null;
  last_value: Record<string, unknown> | null;
  escalated_at: string | null;
};

const MAX_EVENTS_PER_RUN = 25;
const MAX_ATTEMPTS = 5;

function nowIso() {
  return new Date().toISOString();
}

function minutesBetween(aIso: string, bIso: string): number {
  const a = new Date(aIso).getTime();
  const b = new Date(bIso).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(0, (b - a) / 60000);
}

function getNum(cfg: Record<string, unknown>, key: string, fallback: number) {
  const v = cfg[key];
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

function truncate(s: string, n: number) {
  if (s.length <= n) return s;
  return s.slice(0, Math.max(0, n - 1)) + '…';
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return '{}';
  }
}

function slackSeverityEmoji(sev: 'page' | 'ticket') {
  return sev === 'page' ? '🚨' : '⚠️';
}

function slackColor(sev: 'page' | 'ticket') {
  return sev === 'page' ? '#D72C2C' : '#EAA500';
}

function buildSlackPayload(args: {
  env: string;
  rule: RuleRow;
  event: AlertEventRow;
  state?: StateRow | null;
  dashboardUrl?: string;
  isEscalation?: boolean;
}) {
  const { env, rule, event, state, dashboardUrl, isEscalation } = args;
  const sev = isEscalation ? 'page' : rule.severity;
  const emoji = slackSeverityEmoji(sev);
  const status = event.event_type.toUpperCase();
  const title = `${emoji} [${env}] ${status}: ${rule.name}`;

  const contextParts = [
    `kind=${rule.kind}`,
    `severity=${sev}`,
    `event_id=${event.id}`,
    `rule_id=${rule.id}`,
  ];

  const main = event.message ?? state?.last_message ?? '';

  // Slack Incoming Webhooks support "attachments" for color emphasis.
  return {
    text: title,
    attachments: [
      {
        color: slackColor(sev),
        blocks: [
          { type: 'header', text: { type: 'plain_text', text: truncate(title, 140) } },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: main ? truncate(main, 2900) : '_no message_',
            },
          },
          {
            type: 'context',
            elements: [{ type: 'mrkdwn', text: truncate(contextParts.join(' • '), 3000) }],
          },
          ...(dashboardUrl
            ? [
                {
                  type: 'actions',
                  elements: [
                    {
                      type: 'button',
                      text: { type: 'plain_text', text: 'Open Ops Dashboard' },
                      url: dashboardUrl,
                    },
                  ],
                },
              ]
            : []),
        ],
      },
    ],
  };
}

async function postJson(url: string, payload: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(payload),
  });
  const text = await res.text().catch(() => '');
  return { ok: res.ok, status: res.status, body: text };
}

async function sendSlack(webhookUrl: string, payload: unknown) {
  return await postJson(webhookUrl, payload);
}

async function sendWebhook(webhookUrl: string, payload: unknown) {
  // Optional shared secret header for receiver-side validation.
  const secret = envTrim('OPS_WEBHOOK_SECRET');
  const headers: Record<string, string> = secret ? { 'x-ops-signing-secret': secret } : {};
  return await postJson(webhookUrl, payload, headers);
}

async function sendResendEmail(args: { subject: string; text: string; html?: string }) {
  const apiKey = envTrim('OPS_RESEND_API_KEY');
  const from = envTrim('OPS_EMAIL_FROM');
  const toRaw = envTrim('OPS_EMAIL_TO');
  if (!apiKey || !from || !toRaw) {
    return { ok: false, status: 0, body: 'email_not_configured' };
  }
  const to = toRaw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!to.length) {
    return { ok: false, status: 0, body: 'email_not_configured' };
  }

  const payload = {
    from,
    to,
    subject: args.subject,
    text: args.text,
    ...(args.html ? { html: args.html } : {}),
  };

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const text = await res.text().catch(() => '');
  return { ok: res.ok, status: res.status, body: text };
}

function buildWebhookPayload(args: {
  env: string;
  rule: RuleRow;
  event: AlertEventRow;
  state?: StateRow | null;
  isEscalation?: boolean;
}) {
  const { env, rule, event, state, isEscalation } = args;
  return {
    env,
    kind: 'ops_alert',
    is_escalation: !!isEscalation,
    rule: {
      id: rule.id,
      name: rule.name,
      kind: rule.kind,
      severity: isEscalation ? 'page' : rule.severity,
    },
    event: {
      id: event.id,
      occurred_at: event.occurred_at,
      type: event.event_type,
      message: event.message,
      value: event.value,
    },
    state: state
      ? {
          is_active: state.is_active,
          active_since: state.active_since,
          last_message: state.last_message,
          last_value: state.last_value,
          escalated_at: state.escalated_at,
        }
      : null,
    ts: nowIso(),
  };
}

async function claimEvent(service: any, eventId: string): Promise<boolean> {
  // Atomic claim to avoid double-send when two cron runs overlap.
  const { data, error } = await service
    .from('ops_alert_events')
    .update({ notify_status: 'sending' })
    .eq('id', eventId)
    .is('notify_status', null)
    .select('id')
    .maybeSingle();

  if (error) return false;
  return !!data;
}

async function bumpAttempts(service: any, eventId: string): Promise<number> {
  const { data } = await service
    .from('ops_alert_events')
    .select('notified_attempts')
    .eq('id', eventId)
    .maybeSingle();
  const cur = Number((data as any)?.notified_attempts ?? 0) || 0;
  const next = cur + 1;
  await service
    .from('ops_alert_events')
    .update({ notified_attempts: next })
    .eq('id', eventId);
  return next;
}

async function markSent(service: any, eventId: string, channels: Record<string, unknown>) {
  await service
    .from('ops_alert_events')
    .update({ notify_status: 'sent', notified_at: nowIso(), notified_channels: channels, notified_error: null })
    .eq('id', eventId);
}

async function markFailed(service: any, eventId: string, errorMsg: string, attempts: number) {
  const status = attempts >= MAX_ATTEMPTS ? 'dead' : 'failed';
  await service
    .from('ops_alert_events')
    .update({ notify_status: status, notified_error: truncate(errorMsg, 4000) })
    .eq('id', eventId);
}

async function loadRuleAndState(service: any, ruleId: string) {
  const [{ data: rule }, { data: state }] = await Promise.all([
    service
      .from('ops_alert_rules')
      .select('id,name,kind,severity,config')
      .eq('id', ruleId)
      .maybeSingle(),
    service
      .from('ops_alert_state')
      .select('rule_id,is_active,active_since,last_message,last_value,escalated_at')
      .eq('rule_id', ruleId)
      .maybeSingle(),
  ]);
  return { rule: (rule ?? null) as RuleRow | null, state: (state ?? null) as StateRow | null };
}

async function processEvent(ctx: RequestContext, service: any, ev: AlertEventRow) {
  const attempts = await bumpAttempts(service, ev.id);
  if (attempts > MAX_ATTEMPTS) {
    await markFailed(service, ev.id, 'max_attempts_exceeded', attempts);
    return { ok: false, sent: false };
  }

  const { rule, state } = await loadRuleAndState(service, ev.rule_id);
  if (!rule) {
    await markFailed(service, ev.id, 'missing_rule', attempts);
    return { ok: false, sent: false };
  }

  const env = getAppEnv();
  const dash = envTrim('OPS_DASHBOARD_URL') || envTrim('ADMIN_DASHBOARD_URL');

  const slackTicket = envTrim('OPS_SLACK_WEBHOOK_TICKET');
  const slackPage = envTrim('OPS_SLACK_WEBHOOK_PAGE');
  const genericWebhook = envTrim('OPS_WEBHOOK_URL');

  const channels: Record<string, unknown> = {};
  const failures: Array<{ channel: string; status: number; body: string }> = [];

  // Route Slack by severity.
  const slackUrl = rule.severity === 'page' ? slackPage : slackTicket;
  if (slackUrl) {
    const payload = buildSlackPayload({ env, rule, event: ev, state, dashboardUrl: dash });
    const res = await sendSlack(slackUrl, payload);
    channels.slack = { ok: res.ok, status: res.status };
    if (!res.ok) failures.push({ channel: 'slack', status: res.status, body: truncate(res.body, 800) });
  }

  if (genericWebhook) {
    const payload = buildWebhookPayload({ env, rule, event: ev, state });
    const res = await sendWebhook(genericWebhook, payload);
    channels.webhook = { ok: res.ok, status: res.status };
    if (!res.ok) failures.push({ channel: 'webhook', status: res.status, body: truncate(res.body, 800) });
  }

  // Email: only for page-severity triggered events (reduce noise)
  if (ev.event_type === 'triggered' && rule.severity === 'page') {
    const subject = `[${env}] ALERT: ${rule.name}`;
    const text = `${rule.name}\n\n${ev.message ?? ''}\n\nDetails: ${safeJson(ev.value)}`;
    const res = await sendResendEmail({ subject, text });
    channels.email = { ok: res.ok, status: res.status };
    if (!res.ok && res.status !== 0) failures.push({ channel: 'email', status: res.status, body: truncate(res.body, 800) });
  }

  const ok = failures.length === 0;
  if (ok) {
    await markSent(service, ev.id, channels);
    emitMetricBestEffort(ctx, {
      event_type: 'metric.ops.alert_notification_sent',
      level: rule.severity === 'page' ? 'error' : 'warn',
      payload: { rule: rule.name, kind: rule.kind, event_type: ev.event_type, channels },
    });

    // Reset escalation markers when resolved.
    if (ev.event_type === 'resolved') {
      await service
        .from('ops_alert_state')
        .update({ escalated_at: null, last_escalation_notified_at: null })
        .eq('rule_id', rule.id);
    }

    return { ok: true, sent: true };
  }

  await markFailed(service, ev.id, safeJson(failures), attempts);
  emitMetricBestEffort(ctx, {
    event_type: 'metric.ops.alert_notification_failed',
    level: 'error',
    payload: { rule: rule.name, kind: rule.kind, event_type: ev.event_type, failures },
  });
  return { ok: false, sent: false };
}

async function runEscalations(ctx: RequestContext, service: any) {
  const slackPage = envTrim('OPS_SLACK_WEBHOOK_PAGE');
  const genericWebhook = envTrim('OPS_WEBHOOK_URL');
  if (!slackPage && !genericWebhook) return { escalated: 0 };

  const { data: rows } = await service
    .from('ops_alert_state')
    .select('rule_id,is_active,active_since,last_message,last_value,escalated_at')
    .eq('is_active', true)
    .is('escalated_at', null);

  const activeStates = (rows ?? []) as StateRow[];
  if (!activeStates.length) return { escalated: 0 };

  let escalated = 0;
  for (const st of activeStates) {
    const { data: ruleRow } = await service
      .from('ops_alert_rules')
      .select('id,name,kind,severity,config')
      .eq('id', st.rule_id)
      .maybeSingle();
    const rule = (ruleRow ?? null) as RuleRow | null;
    if (!rule || rule.severity !== 'ticket') continue;

    const activeSince = st.active_since;
    if (!activeSince) continue;

    const escalateAfter = getNum(rule.config ?? {}, 'escalate_after_minutes', 60);
    const ageMin = minutesBetween(activeSince, nowIso());
    if (ageMin < escalateAfter) continue;

    const env = getAppEnv();
    const dash = envTrim('OPS_DASHBOARD_URL') || envTrim('ADMIN_DASHBOARD_URL');

    // Build a synthetic event payload for escalation.
    const syntheticEvent: AlertEventRow = {
      id: `escalation-${rule.id}-${Date.now()}`,
      rule_id: rule.id,
      occurred_at: nowIso(),
      event_type: 'note',
      message: `Escalation: alert active for ${Math.floor(ageMin)}m (threshold=${escalateAfter}m).`,
      value: { ...((st.last_value ?? {}) as any), active_for_minutes: ageMin, escalate_after_minutes: escalateAfter },
      notify_status: null,
      notified_attempts: 0,
    };

    const failures: string[] = [];
    const channels: Record<string, unknown> = {};

    if (slackPage) {
      const payload = buildSlackPayload({ env, rule, event: syntheticEvent, state: st, dashboardUrl: dash, isEscalation: true });
      const res = await sendSlack(slackPage, payload);
      channels.slack = { ok: res.ok, status: res.status };
      if (!res.ok) failures.push(`slack:${res.status}`);
    }

    if (genericWebhook) {
      const payload = buildWebhookPayload({ env, rule, event: syntheticEvent, state: st, isEscalation: true });
      const res = await sendWebhook(genericWebhook, payload);
      channels.webhook = { ok: res.ok, status: res.status };
      if (!res.ok) failures.push(`webhook:${res.status}`);
    }

    if (failures.length === 0) {
      // Record escalation marker + note event for auditability.
      await service.from('ops_alert_state').update({ escalated_at: nowIso(), last_escalation_notified_at: nowIso() }).eq('rule_id', rule.id);
      await service.from('ops_alert_events').insert({ rule_id: rule.id, occurred_at: nowIso(), event_type: 'note', message: syntheticEvent.message, value: syntheticEvent.value });
      escalated += 1;

      emitMetricBestEffort(ctx, {
        event_type: 'metric.ops.alert_escalated',
        level: 'error',
        payload: { rule: rule.name, kind: rule.kind, active_for_minutes: ageMin, channels },
      });
    } else {
      emitMetricBestEffort(ctx, {
        event_type: 'metric.ops.alert_escalation_failed',
        level: 'error',
        payload: { rule: rule.name, kind: rule.kind, failures, channels },
      });
    }
  }

  return { escalated };
}

Deno.serve(async (req) => {
  // verify_jwt=false in config.toml (cron endpoint)
  const auth = requireCronSecret(req);
  if (auth) return auth;

  return await withRequestContext('ops-alert-notifier', req, async (ctx) => {
    const service = createServiceClient();

    // Pick events not yet notified (or failed but still retryable)
    const { data: pending, error } = await service
      .from('ops_alert_events')
      .select('id,rule_id,occurred_at,event_type,message,value,notify_status,notified_attempts')
      .or('notify_status.is.null,notify_status.eq.failed')
      .order('occurred_at', { ascending: true })
      .limit(MAX_EVENTS_PER_RUN);

    if (error) {
      return errorJson(error.message, 500, 'DB_ERROR', undefined, ctx.headers);
    }

    let claimed = 0;
    let sent = 0;
    let failed = 0;

    for (const ev of (pending ?? []) as AlertEventRow[]) {
      // Skip hard-dead events.
      if (ev.notify_status === 'dead') continue;
      if (Number(ev.notified_attempts ?? 0) >= MAX_ATTEMPTS) continue;

      // Try to claim if never attempted.
      if (ev.notify_status === null) {
        const okClaim = await claimEvent(service, ev.id);
        if (!okClaim) continue;
        claimed += 1;
      } else if (ev.notify_status === 'failed') {
        // Re-claim failed events by flipping back to sending.
        const { data: claimedRow } = await service
          .from('ops_alert_events')
          .update({ notify_status: 'sending' })
          .eq('id', ev.id)
          .eq('notify_status', 'failed')
          .select('id')
          .maybeSingle();
        if (!claimedRow) continue;
        claimed += 1;
      }

      const res = await processEvent(ctx, service, ev);
      if (res.sent) sent += 1;
      else failed += 1;
    }

    const escalation = await runEscalations(ctx, service);

    return json(
      {
        ok: true,
        evaluated_at: nowIso(),
        counts: { pending: (pending ?? []).length, claimed, sent, failed, escalated: escalation.escalated },
      },
      200,
      ctx.headers,
    );
  });
});
