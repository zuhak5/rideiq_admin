import { requireCronSecret } from '../_shared/cronAuth.ts';
import { errorJson, json } from '../_shared/json.ts';
import { withRequestContext } from '../_shared/requestContext.ts';
import { createServiceClient } from '../_shared/supabase.ts';
import { emitMetricBestEffort } from '../_shared/metrics.ts';

type RuleRow = {
  id: string;
  name: string;
  kind: string;
  severity: 'page' | 'ticket';
  enabled: boolean;
  window_minutes: number;
  cooldown_minutes: number;
  config: Record<string, unknown>;
};

type StateRow = {
  rule_id: string;
  is_active: boolean;
  active_since: string | null;
  last_triggered_at: string | null;
  last_resolved_at: string | null;
  last_message: string | null;
  last_value: Record<string, unknown> | null;
};

function nowIso() {
  return new Date().toISOString();
}

function minutesAgoIso(min: number) {
  return new Date(Date.now() - min * 60 * 1000).toISOString();
}

function getNum(cfg: Record<string, unknown>, key: string, fallback: number) {
  const v = cfg[key];
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

function getBool(cfg: Record<string, unknown>, key: string, fallback: boolean) {
  const v = cfg[key];
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    if (v === 'true') return true;
    if (v === 'false') return false;
  }
  return fallback;
}

function inCooldown(state: StateRow | null, cooldownMinutes: number): boolean {
  if (!state?.last_triggered_at) return false;
  if (cooldownMinutes <= 0) return false;
  const last = new Date(state.last_triggered_at).getTime();
  if (!Number.isFinite(last)) return false;
  return Date.now() - last < cooldownMinutes * 60 * 1000;
}

function ratio(n: number, d: number) {
  if (!d || d <= 0) return 0;
  return n / d;
}

async function fetchDashboards(service: any) {
  const [
    webhook,
    payments,
    dispatch,
    safety,
    maps,
    jobs,
  ] = await Promise.all([
    service.from('ops_webhook_metrics_15m').select('*'),
    service.from('ops_payment_metrics_15m').select('*'),
    service.from('ops_dispatch_metrics_15m').select('*').maybeSingle(),
    service.from('ops_safety_metrics_15m').select('*').maybeSingle(),
    service.from('ops_maps_metrics_15m').select('*').maybeSingle(),
    service.from('ops_job_queue_summary').select('*').maybeSingle(),
  ]);

  return {
    webhook: webhook.data ?? [],
    payments: payments.data ?? [],
    dispatch: dispatch.data ?? null,
    safety: safety.data ?? null,
    maps: maps.data ?? null,
    jobs: jobs.data ?? null,
    errors: {
      webhook: webhook.error?.message ?? null,
      payments: payments.error?.message ?? null,
      dispatch: dispatch.error?.message ?? null,
      safety: safety.error?.message ?? null,
      maps: maps.error?.message ?? null,
      jobs: jobs.error?.message ?? null,
    },
  } as const;
}

function evalRule(rule: RuleRow, dashboards: any, dbStats: any): { active: boolean; message: string; value: Record<string, unknown> } {
  const cfg = rule.config ?? {};

  if (rule.kind === 'webhook_internal_error_spike') {
    const rows = dashboards.webhook as any[];
    const accepted = rows.reduce((s, r) => s + Number(r.accepted ?? 0), 0);
    const internal = rows.reduce((s, r) => s + Number(r.internal_error ?? 0), 0);
    const total = rows.reduce((s, r) => s + Number(r.total ?? 0), 0);

    const minTotal = getNum(cfg, 'min_total', 20);
    const thresholdCount = getNum(cfg, 'threshold_count', 5);
    const thresholdRatio = getNum(cfg, 'threshold_ratio', 0.05);

    const errRatio = ratio(internal, total);
    const active = total >= minTotal && (internal >= thresholdCount || errRatio >= thresholdRatio);

    return {
      active,
      message: `webhooks: internal_error=${internal} total=${total} ratio=${errRatio.toFixed(3)}`,
      value: { internal_error: internal, total, accepted, ratio: errRatio, window_minutes: rule.window_minutes },
    };
  }

  if (rule.kind === 'job_queue_backlog') {
    const j = dashboards.jobs ?? {};
    const queued = Number(j.queued ?? 0);
    const runnable = Number(j.runnable ?? 0);
    const oldest = Number(j.oldest_age_seconds ?? 0);

    const thresholdCount = getNum(cfg, 'threshold_count', 50);
    const thresholdAge = getNum(cfg, 'threshold_age_seconds', 900);

    const active = queued >= thresholdCount || runnable >= thresholdCount || oldest >= thresholdAge;
    return {
      active,
      message: `job_queue: queued=${queued} runnable=${runnable} oldest_age_s=${Math.floor(oldest)}`,
      value: { queued, runnable, oldest_age_seconds: oldest, window_minutes: rule.window_minutes },
    };
  }

  if (rule.kind === 'payment_provider_error_spike') {
    const rows = dashboards.payments as any[];
    const providerErrors = rows.reduce((s, r) => s + Number(r.provider_errors ?? 0), 0);
    const attempts = rows.reduce((s, r) => s + Number(r.topup_ok ?? 0) + Number(r.topup_fail ?? 0), 0);

    const minAttempts = getNum(cfg, 'min_attempts', 10);
    const thresholdCount = getNum(cfg, 'threshold_count', 5);
    const thresholdRatio = getNum(cfg, 'threshold_ratio', 0.2);

    const errRatio = ratio(providerErrors, attempts);
    const active = attempts >= minAttempts && (providerErrors >= thresholdCount || errRatio >= thresholdRatio);
    return {
      active,
      message: `payments: provider_errors=${providerErrors} attempts=${attempts} ratio=${errRatio.toFixed(3)}`,
      value: { provider_errors: providerErrors, attempts, ratio: errRatio, window_minutes: rule.window_minutes },
    };
  }

  if (rule.kind === 'dispatch_error_spike') {
    const d = dashboards.dispatch ?? {};
    const failed = Number(d.failed ?? 0);
    const total = Number(d.total ?? 0);

    const thresholdCount = getNum(cfg, 'threshold_count', 10);
    const thresholdRatio = getNum(cfg, 'threshold_ratio', 0.1);

    const r = ratio(failed, total);
    const active = total > 0 && (failed >= thresholdCount || r >= thresholdRatio);
    return {
      active,
      message: `dispatch: failed=${failed} total=${total} ratio=${r.toFixed(3)}`,
      value: { failed, total, ratio: r, window_minutes: rule.window_minutes },
    };
  }

  if (rule.kind === 'maps_origin_denied') {
    const m = dashboards.maps ?? {};
    const originDenied = Number(m.origin_denied ?? 0);
    const total = Number(m.total ?? 0);

    const minTotal = getNum(cfg, 'min_total', 100);
    const thresholdCount = getNum(cfg, 'threshold_count', 50);
    const thresholdRatio = getNum(cfg, 'threshold_ratio', 0.3);

    const r = ratio(originDenied, total);
    const active = total >= minTotal && (originDenied >= thresholdCount || r >= thresholdRatio);
    return {
      active,
      message: `maps: origin_denied=${originDenied} total=${total} ratio=${r.toFixed(3)}`,
      value: { origin_denied: originDenied, total, ratio: r, window_minutes: rule.window_minutes },
    };
  }

  if (rule.kind === 'db_connection_saturation') {
    const pct = Number(dbStats?.pct_used ?? 0);
    const threshold = getNum(cfg, 'threshold_ratio', 0.85);
    const active = pct >= threshold;
    return {
      active,
      message: `db: pct_used=${pct.toFixed(3)} max=${dbStats?.max_connections ?? null} current=${dbStats?.current_connections ?? null}`,
      value: { ...dbStats, threshold_ratio: threshold, window_minutes: rule.window_minutes },
    };
  }

  // Unknown rule kind: treat as disabled.
  const strict = getBool(cfg, 'strict_unknown', false);
  return {
    active: strict,
    message: `unknown kind: ${rule.kind}`,
    value: { kind: rule.kind },
  };
}

async function upsertState(service: any, rule: RuleRow, next: { active: boolean; message: string; value: Record<string, unknown> }, prev: StateRow | null) {
  const now = nowIso();

  // Basic cooldown: do not transition from inactive->active within cooldown.
  if (!prev?.is_active && next.active && inCooldown(prev, rule.cooldown_minutes)) {
    await service.from('ops_alert_state').upsert({
      rule_id: rule.id,
      is_active: false,
      last_evaluated_at: now,
      last_value: next.value,
      last_message: `${next.message} (cooldown)` ,
      updated_at: now,
    }, { onConflict: 'rule_id' });
    return { transitioned: false, event: null as null | 'triggered' | 'resolved' };
  }

  // Transition logic
  if (next.active && !prev?.is_active) {
    await service.from('ops_alert_state').upsert({
      rule_id: rule.id,
      is_active: true,
      active_since: now,
      last_evaluated_at: now,
      last_value: next.value,
      last_message: next.message,
      last_triggered_at: now,
      updated_at: now,
    }, { onConflict: 'rule_id' });

    await service.from('ops_alert_events').insert({
      rule_id: rule.id,
      occurred_at: now,
      event_type: 'triggered',
      value: next.value,
      message: next.message,
    });

    return { transitioned: true, event: 'triggered' as const };
  }

  if (!next.active && prev?.is_active) {
    await service.from('ops_alert_state').upsert({
      rule_id: rule.id,
      is_active: false,
      active_since: null,
      last_evaluated_at: now,
      last_value: next.value,
      last_message: next.message,
      last_resolved_at: now,
      updated_at: now,
    }, { onConflict: 'rule_id' });

    await service.from('ops_alert_events').insert({
      rule_id: rule.id,
      occurred_at: now,
      event_type: 'resolved',
      value: next.value,
      message: next.message,
    });

    return { transitioned: true, event: 'resolved' as const };
  }

  // No transition: update last_evaluated + last_value
  await service.from('ops_alert_state').upsert({
    rule_id: rule.id,
    is_active: !!prev?.is_active,
    active_since: prev?.active_since ?? null,
    last_evaluated_at: now,
    last_value: next.value,
    last_message: next.message,
    updated_at: now,
  }, { onConflict: 'rule_id' });

  return { transitioned: false, event: null as null | 'triggered' | 'resolved' };
}

Deno.serve(async (req) => {
  // verify_jwt=false in config.toml (cron endpoint)

  const auth = requireCronSecret(req);
  if (auth) return auth;

  return await withRequestContext('ops-alert-runner', req, async (ctx) => {
    const service = createServiceClient();

    // Load enabled rules
    const { data: rules, error: rulesErr } = await service
      .from('ops_alert_rules')
      .select('id,name,kind,severity,enabled,window_minutes,cooldown_minutes,config')
      .eq('enabled', true);

    if (rulesErr) {
      return errorJson(rulesErr.message, 500, 'DB_ERROR', undefined, ctx.headers);
    }

    // Fetch dashboards once per invocation (Session 7 assumes 15m windows).
    const dashboards = await fetchDashboards(service);

    const { data: dbStats, error: dbErr } = await service.rpc('ops_db_conn_stats');
    if (dbErr) {
      ctx.warn('ops.alert.db_stats_failed', { error: dbErr.message });
    }
    const dbRow = Array.isArray(dbStats) ? dbStats[0] : dbStats;

    const results: any[] = [];

    for (const r of (rules ?? []) as RuleRow[]) {
      // Load prior state (optional)
      const { data: st, error: stErr } = await service
        .from('ops_alert_state')
        .select('rule_id,is_active,active_since,last_triggered_at,last_resolved_at,last_message,last_value')
        .eq('rule_id', r.id)
        .maybeSingle();

      if (stErr) {
        ctx.warn('ops.alert.state_read_failed', { rule: r.name, error: stErr.message });
      }

      const prev = (st ?? null) as StateRow | null;
      const next = evalRule(r, dashboards, dbRow);

      const transition = await upsertState(service, r, next, prev);

      // Emit app_events metrics for transitions (best-effort)
      if (transition.event === 'triggered') {
        emitMetricBestEffort(ctx, {
          event_type: 'metric.ops.alert_triggered',
          level: r.severity === 'page' ? 'error' : 'warn',
          payload: { rule: r.name, kind: r.kind, severity: r.severity, ...next.value },
        });
      }
      if (transition.event === 'resolved') {
        emitMetricBestEffort(ctx, {
          event_type: 'metric.ops.alert_resolved',
          level: 'info',
          payload: { rule: r.name, kind: r.kind, severity: r.severity, ...next.value },
        });
      }

      results.push({
        rule: r.name,
        kind: r.kind,
        severity: r.severity,
        active: next.active,
        message: next.message,
        transitioned: transition.transitioned,
        event: transition.event,
      });
    }

    const triggered = results.filter((x) => x.event === 'triggered').length;
    const resolved = results.filter((x) => x.event === 'resolved').length;

    return json(
      {
        ok: true,
        evaluated_at: nowIso(),
        window_minutes: 15,
        dashboards_errors: dashboards.errors,
        counts: { rules: results.length, triggered, resolved },
        results,
      },
      200,
      ctx.headers,
    );
  });
});
