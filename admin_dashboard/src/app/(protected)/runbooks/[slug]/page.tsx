import Link from 'next/link';

import { requirePermission } from '@/lib/auth/guards';

type Runbook = {
  title: string;
  summary: string;
  steps: Array<{ heading: string; bullets: string[] }>;
};

const RUNBOOKS: Record<string, Runbook> = {
  errors: {
    title: 'Runbook: Error spikes',
    summary: 'Use correlation IDs and recent app_events to narrow the failing component quickly.',
    steps: [
      {
        heading: '1) Confirm scope & blast radius',
        bullets: [
          'Check Observability → "Error spike (15m)" alert state and compare with Ops alerts.',
          'Confirm whether failures are localized (one edge function / one provider) or global.',
          'If customer-impacting: pause high-risk automated jobs (webhook dispatcher, payout job runner) until triage completes.'
        ],
      },
      {
        heading: '2) Correlate to request IDs',
        bullets: [
          'In Observability → Recent warnings/errors, copy a request_id from a fresh error.',
          'Search edge function logs for that request_id; follow trace_id / correlation_id in log payloads.',
          'If the error is from an external provider, validate request signature, API key, and response body.'
        ],
      },
      {
        heading: '3) Validate data integrity',
        bullets: [
          'For transactional flows (payments/payouts), confirm idempotency keys and job status transitions.',
          'For user state changes, check recent admin audit log entries for potentially related admin actions.',
          'If DB errors: look for RLS denies, constraint violations, or missing indexes.'
        ],
      },
      {
        heading: '4) Mitigation options',
        bullets: [
          'Roll back the last deployment / disable feature flags tied to the failing path.',
          'Temporarily reduce concurrency for cron runners to limit cascading failures.',
          'If provider outage: fail fast with clear errors and retry with backoff via job queue.'
        ],
      },
      {
        heading: '5) Post-incident',
        bullets: [
          'Add/adjust app_events metrics for the failing component (duration/error counters).',
          'Add an Ops alert rule if the failure mode is actionable (threshold + runbook).',
          'Write a short incident report: timeline, root cause, fixes, and follow-ups.'
        ],
      },
    ],
  },
  webhooks: {
    title: 'Runbook: Webhook failures',
    summary: 'Diagnose webhook authentication problems and delivery pipeline health.',
    steps: [
      {
        heading: '1) Identify failure mode',
        bullets: [
          'Observability → Signals (15m): check webhook internal errors and auth failures.',
          'Ops → Webhook health: inspect active rules / recent events for a matching provider.',
          'Confirm the failing provider (e.g., payment/withdraw) and whether it is inbound webhook or outbound delivery.'
        ],
      },
      {
        heading: '2) Inbound webhook verification',
        bullets: [
          'Validate signature header name/value against the provider docs and configured secret in Vault.',
          'Check that raw body is used for HMAC verification (no JSON re-serialization differences).',
          'Confirm clock skew requirements if timestamps are part of the signature scheme.'
        ],
      },
      {
        heading: '3) Outbound delivery (dispatcher / jobs)',
        bullets: [
          'Check job queue backlog and failure rates (webhook_jobs, webhook_job_attempts).',
          'Ensure retry/backoff is bounded and idempotency keys are stable per event.',
          'If endpoints are returning 4xx/5xx, coordinate with the consumer or apply circuit-breaker behavior.'
        ],
      },
      {
        heading: '4) Remediation',
        bullets: [
          'Rotate secrets if compromise suspected; update Vault and provider console together.',
          'If provider changed signature algorithm/version, update parsing and add regression tests.',
          'Replay failed jobs cautiously (avoid duplicates) using idempotency keys and status guards.'
        ],
      },
    ],
  },
  maps: {
    title: 'Runbook: Maps misconfiguration',
    summary: 'Resolve provider config drift causing maps failures and degraded ETA/routing.',
    steps: [
      {
        heading: '1) Confirm impact',
        bullets: [
          'Observability → Signals (15m): maps misconfigured count > 0 indicates configuration validation failures.',
          'Ops → Maps: inspect provider health and recent error codes.',
          'Determine if only one capability is affected (geocode, route, reverse geocode, ...).'
        ],
      },
      {
        heading: '2) Check configuration',
        bullets: [
          'Validate provider is enabled and has required capabilities in admin settings.',
          'Confirm API keys exist in Vault and are scoped correctly (domain/IP restrictions, quotas).',
          'Verify fallback provider order in case of partial outages.'
        ],
      },
      {
        heading: '3) Remediation',
        bullets: [
          'Fix the config via admin maps pages; ensure audit log captures the change.',
          'Add a smoke test request for each capability and ensure it records a success metric.',
          'If quota exceeded: increase quota or throttle high-volume callers (dispatch, geofence jobs).'
        ],
      },
    ],
  },
};

export default async function RunbookPage({ params }: { params: { slug: string } }) {
  await requirePermission('observability.view');

  const rb = RUNBOOKS[params.slug];
  if (!rb) {
    return (
      <div className="space-y-2">
        <h1 className="text-xl font-semibold">Runbook not found</h1>
        <Link href="/runbooks" className="text-sm text-neutral-600 hover:underline">
          Back to runbooks
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-xl font-semibold">{rb.title}</h1>
          <Link href="/runbooks" className="text-sm text-neutral-600 hover:underline">
            All runbooks
          </Link>
        </div>
        <div className="mt-1 text-sm text-neutral-600">{rb.summary}</div>
      </div>

      <div className="space-y-3">
        {rb.steps.map((s) => (
          <div key={s.heading} className="rounded-xl border bg-white p-4">
            <div className="text-sm font-medium">{s.heading}</div>
            <ul className="mt-2 list-disc pl-5 space-y-1 text-xs text-neutral-700">
              {s.bullets.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
