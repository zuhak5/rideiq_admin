# Rate limiting (API cost / abuse control)

This project uses a lightweight Postgres-backed fixed-window counter to rate-limit Edge Functions.

## Components

- Table: `public.api_rate_limits`
- RPC: `public.rate_limit_consume(p_key, p_window_seconds, p_limit)`
- Housekeeping RPC: `public.rate_limit_prune(p_grace_seconds := 300)`
- Cron Edge Function: `rate-limit-prune` (requires `CRON_SECRET`)

The Edge Function helper lives in `supabase/functions/_shared/rateLimit.ts`.

## When to use

Rate limiting should be applied to:
- public endpoints (`verify_jwt = false`) that can be called from the browser
- endpoints that trigger paid resources (AI, SMS, voice, maps, push)
- endpoints that can be abused for enumeration (OTP / PIN verification)

See OWASP API4:2023 (Unrestricted Resource Consumption) for guidance on why rate limiting matters.

## Tuning guidelines

Use two layers where possible:
1) per-user limits (protect account-level abuse)
2) per-IP limits (protect anonymous abuse / botnets)

For expensive endpoints (AI/SMS/voice), prefer **fail-closed** when the rate-limit RPC fails to avoid unbounded spend.

## Troubleshooting

### Symptom: AI endpoints always return 429 / deny
- Confirm `public.rate_limit_consume` exists in fresh databases (migration applied).
- Confirm Edge Functions are using the service role key (required to bypass RLS).

### Symptom: `api_rate_limits` table grows without bound
- Schedule `rate-limit-prune` every 5–15 minutes.
- Verify `CRON_SECRET` is set in Edge secrets and in the scheduler headers.

Example schedule using `pg_cron` + `pg_net`:

```sql
select cron.schedule(
  'rate-limit-prune-5m',
  '*/5 * * * *',
  $$
    select net.http_post(
      url := 'https://<project-ref>.supabase.co/functions/v1/rate-limit-prune',
      headers := jsonb_build_object('x-cron-secret', '<CRON_SECRET>'),
      body := '{}'::jsonb
    );
  $$
);
```

### Quick sanity checks

```sql
-- Should be service-role only
select has_function_privilege('anon', 'public.rate_limit_consume(text,int,int)', 'execute');
select has_function_privilege('authenticated', 'public.rate_limit_consume(text,int,int)', 'execute');

-- Inspect current buckets
select *
from public.api_rate_limits
order by window_start desc
limit 50;
```
