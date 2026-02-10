import { createServiceClient } from '../_shared/supabase.ts';
import { errorJson, json } from '../_shared/json.ts';
import { requireCronSecret } from '../_shared/cronAuth.ts';
import { withRequestContext } from '../_shared/requestContext.ts';

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function startOfWeekUTC(date: Date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay(); // 0=Sun
  // ISO week starts Monday. Convert: Mon=1..Sun=7
  const isoDow = day === 0 ? 7 : day;
  d.setUTCDate(d.getUTCDate() - (isoDow - 1));
  return d;
}

function startOfMonthUTC(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

type Body = {
  // Optional override (YYYY-MM-DD)
  week_start?: string;
  month_start?: string;
  limit?: number;
};

Deno.serve((req) =>
  withRequestContext('stats-rollup', req, async (_ctx) => {

  if (req.method !== 'POST') return errorJson('Method not allowed', 405);

  const cronAuth = requireCronSecret(req);
  if (cronAuth) return cronAuth;
  const body: Body = await req.json().catch(() => ({}));
  const limit = Math.max(1, Math.min(Number(body.limit ?? 200), 500));

  const now = new Date();
  const weekStart = body.week_start?.trim() || isoDate(startOfWeekUTC(now));
  const monthStart = body.month_start?.trim() || isoDate(startOfMonthUTC(now));

  const service = createServiceClient();

  const results: Record<string, unknown> = {
    week_start: weekStart,
    month_start: monthStart,
    limit,
  };

  const week = await service.rpc('refresh_driver_rank_snapshots', {
    p_period: 'weekly',
    p_period_start: weekStart,
    p_limit: limit,
  });
  if (week.error) return errorJson(week.error.message, 400, 'DB_ERROR');
  results.week = week.data;

  const month = await service.rpc('refresh_driver_rank_snapshots', {
    p_period: 'monthly',
    p_period_start: monthStart,
    p_limit: limit,
  });
  if (month.error) return errorJson(month.error.message, 400, 'DB_ERROR');
  results.month = month.data;

  return json({ ok: true, ...results });
  }),
);
