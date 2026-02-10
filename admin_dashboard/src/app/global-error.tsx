'use client';

import Link from 'next/link';

export default function GlobalError(
  props: {
    error: Error & { digest?: string };
    reset: () => void;
  },
) {
  const { error, reset } = props;

  return (
    <html>
      <body className="min-h-screen bg-slate-950 text-slate-100">
        <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center px-6 py-12">
          <h1 className="text-2xl font-semibold">Something went wrong</h1>
          <p className="mt-3 text-sm text-slate-300">
            An unexpected error occurred. You can retry, or return to the dashboard.
          </p>

          <div className="mt-6 flex gap-3">
            <button
              type="button"
              onClick={() => reset()}
              className="rounded-md bg-slate-100 px-4 py-2 text-sm font-medium text-slate-900 hover:bg-white"
            >
              Retry
            </button>
            <Link
              href="/"
              className="rounded-md border border-slate-700 px-4 py-2 text-sm font-medium hover:border-slate-500"
            >
              Go to dashboard
            </Link>
          </div>

          <details className="mt-8 rounded-md border border-slate-800 bg-slate-900/40 p-4">
            <summary className="cursor-pointer text-sm text-slate-300">Technical details</summary>
            <pre className="mt-3 overflow-auto text-xs text-slate-200">
              {String(error?.message || error)}
              {error?.digest ? `\nDigest: ${error.digest}` : ''}
            </pre>
          </details>
        </main>
      </body>
    </html>
  );
}
