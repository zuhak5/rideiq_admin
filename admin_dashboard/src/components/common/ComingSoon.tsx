import Link from 'next/link';

export function ComingSoon({
  title,
  description,
  ownerHint,
}: {
  title: string;
  description: string;
  ownerHint?: string;
}) {
  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-semibold text-neutral-900">{title}</h1>
      <p className="mt-2 text-sm text-neutral-600">{description}</p>

      <div className="mt-6 rounded-2xl border bg-white p-4">
        <div className="text-sm font-medium text-neutral-900">Status</div>
        <p className="mt-1 text-sm text-neutral-600">
          This module is scaffolded and permission-gated, but not implemented yet.
        </p>

        {ownerHint ? (
          <p className="mt-2 text-xs text-neutral-500">
            Owner: <span className="font-medium">{ownerHint}</span>
          </p>
        ) : null}

        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/runbooks" className="text-xs rounded-md border px-2 py-1 hover:bg-neutral-50">
            Runbooks
          </Link>
          <Link href="/ops" className="text-xs rounded-md border px-2 py-1 hover:bg-neutral-50">
            Ops
          </Link>
          <Link href="/audit" className="text-xs rounded-md border px-2 py-1 hover:bg-neutral-50">
            Audit Log
          </Link>
        </div>
      </div>
    </div>
  );
}
