import Link from 'next/link';

import { requirePermission } from '@/lib/auth/guards';

const RUNBOOKS = [
  { slug: 'errors', title: 'Error spikes', description: 'Triage elevated error rates and correlate request IDs.' },
  { slug: 'webhooks', title: 'Webhook failures', description: 'Investigate signature/auth issues and dispatcher/job backlog.' },
  { slug: 'maps', title: 'Maps misconfiguration', description: 'Resolve provider/keys/config drift causing maps failures.' },
];

export default async function RunbooksIndexPage() {
  await requirePermission('ops.view');

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Runbooks</h1>
        <div className="text-xs text-neutral-500">Incident response playbooks for common operational issues.</div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {RUNBOOKS.map((rb) => (
          <Link
            key={rb.slug}
            href={`/runbooks/${rb.slug}`}
            className="rounded-xl border bg-white p-4 hover:bg-neutral-50 transition-colors"
          >
            <div className="text-sm font-medium">{rb.title}</div>
            <div className="mt-1 text-xs text-neutral-600">{rb.description}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
