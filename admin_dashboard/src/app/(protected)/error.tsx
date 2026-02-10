'use client';

import Link from 'next/link';

export default function ProtectedError(
  props: {
    error: Error & { digest?: string };
    reset: () => void;
  },
) {
  const { error, reset } = props;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 px-6 py-10">
      <h2 className="text-xl font-semibold">This section failed to load</h2>
      <p className="text-sm text-slate-600">
        The request failed or returned an unexpected response. Try again, or go back to a safe page.
      </p>

      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => reset()}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
        >
          Retry
        </button>
        <Link
          href="/"
          className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium hover:border-slate-400"
        >
          Back to dashboard
        </Link>
      </div>

      <details className="rounded-md border border-slate-200 bg-slate-50 p-4">
        <summary className="cursor-pointer text-sm text-slate-700">Technical details</summary>
        <pre className="mt-3 overflow-auto text-xs text-slate-800">{String(error?.message || error)}</pre>
      </details>
    </div>
  );
}