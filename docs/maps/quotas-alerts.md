# Maps quotas, budgets, and alerting

This repo treats `MAPS_CLIENT_KEY` as public. Cost safety relies on:
1) tight API allowlists,
2) conservative quotas, and
3) billing budgets + alerting.

## Quotas (per API)

### Maps JavaScript API (client key)
Start with conservative daily caps and increase after observing baseline usage.

Suggested starting points:
- Staging: 5,000 loads/day
- Production: 100,000 loads/day

Alert thresholds:
- Warning at 50% of daily quota
- Critical at 80% of daily quota

If your traffic is materially different, adjust these numbers after measuring a week of normal usage.

## Billing budgets (GCP billing account)
Create monthly budgets and alerting (example):
- Staging: $25/month (alert at 50%, 80%, 100%)
- Production: $500/month (alert at 50%, 80%, 100%)

## Usage spike monitoring
Enable Cloud Monitoring metrics dashboards and alerts for:
- API request count spikes (per minute / per hour)
- Error rate spikes (4xx/5xx)

Escalation guidance:
1) Verify referrer restrictions and API allowlist are still intact.
2) Temporarily reduce quotas to stop runaway spend.
3) Rotate the compromised key.
4) Investigate traffic sources and tighten referrer allowlist if needed.
