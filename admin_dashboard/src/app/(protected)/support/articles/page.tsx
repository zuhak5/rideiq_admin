import Link from 'next/link';
import { getAdminContext } from '@/lib/auth/guards';
import { listSupportArticles, listSupportSections } from '@/lib/admin/support';
import { upsertSectionAction } from './actions';

function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function buildQuery(params: Record<string, string | number | boolean | undefined | null>): string {
  const qp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    qp.set(k, String(v));
  }
  const s = qp.toString();
  return s ? `?${s}` : '';
}

export default async function SupportArticlesPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const ctx = await getAdminContext();

  if (!ctx.guard.can('support.read')) {
    return <div className="p-6 text-sm text-red-600">Forbidden</div>;
  }

  const q = asString(searchParams.q);
  const section_id = asString(searchParams.section_id) || '';
  const enabledRaw = asString(searchParams.enabled);
  const enabled =
    enabledRaw === 'true' ? true : enabledRaw === 'false' ? false : null;

  const offset = Number(asString(searchParams.offset) || '0') || 0;
  const limit = 50;

  const [{ sections }, { articles, page }] = await Promise.all([
    listSupportSections(ctx.supabase),
    listSupportArticles(ctx.supabase, { q, section_id: section_id || null, enabled, limit, offset }),
  ]);

  const nextOffset = offset + limit;
  const prevOffset = Math.max(0, offset - limit);

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold">Help Center</h1>
          <p className="text-sm text-gray-500">Manage support sections and knowledge base articles.</p>
        </div>
        {ctx.guard.can('support.manage') ? (
          <Link className="rounded bg-black px-3 py-2 text-sm text-white" href="/support/articles/new">
            New article
          </Link>
        ) : null}
      </div>

      <form className="rounded border bg-white p-4 space-y-3" method="GET" action="/support/articles">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <div className="md:col-span-2">
            <label className="text-xs text-gray-600">Search</label>
            <input
              name="q"
              defaultValue={q}
              placeholder="Title or slug…"
              className="mt-1 w-full rounded border px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label className="text-xs text-gray-600">Section</label>
            <select
              name="section_id"
              defaultValue={section_id}
              className="mt-1 w-full rounded border px-3 py-2 text-sm"
            >
              <option value="">All</option>
              {sections.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs text-gray-600">Enabled</label>
            <select
              name="enabled"
              defaultValue={enabledRaw}
              className="mt-1 w-full rounded border px-3 py-2 text-sm"
            >
              <option value="">All</option>
              <option value="true">Enabled</option>
              <option value="false">Disabled</option>
            </select>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div className="text-xs text-gray-500">Returned: {page.returned}</div>
          <div className="flex items-center gap-2">
            <button className="rounded bg-black px-3 py-2 text-sm text-white" type="submit">
              Apply
            </button>
            <Link className="rounded border px-3 py-2 text-sm" href="/support/articles">
              Reset
            </Link>
          </div>
        </div>
      </form>

      <div className="rounded border bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-600">
              <tr>
                <th className="px-4 py-3 text-left">Updated</th>
                <th className="px-4 py-3 text-left">Enabled</th>
                <th className="px-4 py-3 text-left">Section</th>
                <th className="px-4 py-3 text-left">Title</th>
                <th className="px-4 py-3 text-left">Slug</th>
                <th className="px-4 py-3 text-left">Tags</th>
              </tr>
            </thead>
            <tbody>
              {articles.length === 0 ? (
                <tr>
                  <td className="px-4 py-6 text-center text-gray-500" colSpan={6}>
                    No articles found.
                  </td>
                </tr>
              ) : (
                articles.map((a) => (
                  <tr key={a.id} className="border-t hover:bg-gray-50">
                    <td className="px-4 py-3 text-xs text-gray-500">{new Date(a.updated_at).toLocaleString()}</td>
                    <td className="px-4 py-3">
                      <span className="rounded border px-2 py-1 text-xs">{a.enabled ? 'Yes' : 'No'}</span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600">{a.section_title ?? '—'}</td>
                    <td className="px-4 py-3">
                      <Link className="font-medium hover:underline" href={`/support/articles/${a.id}`}>
                        {a.title}
                      </Link>
                      {a.summary ? <div className="text-xs text-gray-500 line-clamp-1">{a.summary}</div> : null}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600">{a.slug}</td>
                    <td className="px-4 py-3 text-xs text-gray-600">
                      {Array.isArray(a.tags) && a.tags.length > 0 ? a.tags.join(', ') : '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between border-t p-3 text-sm">
          <Link
            className={`rounded border px-3 py-1 ${offset === 0 ? 'pointer-events-none opacity-50' : ''}`}
            href={`/support/articles${buildQuery({ q, section_id, enabled: enabledRaw, offset: prevOffset })}`}
          >
            Prev
          </Link>
          <div className="text-xs text-gray-500">
            Offset {offset} • Limit {limit}
          </div>
          <Link
            className={`rounded border px-3 py-1 ${page.returned < limit ? 'pointer-events-none opacity-50' : ''}`}
            href={`/support/articles${buildQuery({ q, section_id, enabled: enabledRaw, offset: nextOffset })}`}
          >
            Next
          </Link>
        </div>
      </div>

      {ctx.guard.can('support.manage') ? (
        <div className="rounded border bg-white p-4 space-y-3">
          <div>
            <div className="text-sm font-medium">Sections</div>
            <div className="text-xs text-gray-500">Add or update help center sections.</div>
          </div>

          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {sections.map((s) => (
              <div key={s.id} className="rounded border p-3">
                <div className="text-sm font-medium">{s.title}</div>
                <div className="text-xs text-gray-500">
                  key={s.key} • sort={s.sort_order} • {s.enabled ? 'enabled' : 'disabled'}
                </div>
              </div>
            ))}
          </div>

          <form action={upsertSectionAction} className="grid grid-cols-1 gap-3 md:grid-cols-5">
            <div className="md:col-span-1">
              <label className="text-xs text-gray-600">Key</label>
              <input name="key" className="mt-1 w-full rounded border px-3 py-2 text-sm" placeholder="billing" required />
            </div>
            <div className="md:col-span-2">
              <label className="text-xs text-gray-600">Title</label>
              <input name="title" className="mt-1 w-full rounded border px-3 py-2 text-sm" placeholder="Billing" required />
            </div>
            <div className="md:col-span-1">
              <label className="text-xs text-gray-600">Sort order</label>
              <input
                name="sort_order"
                className="mt-1 w-full rounded border px-3 py-2 text-sm"
                placeholder="0"
                inputMode="numeric"
              />
            </div>
            <div className="md:col-span-1 flex items-end gap-2">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="enabled" defaultChecked />
                Enabled
              </label>
              <button type="submit" className="ml-auto rounded bg-black px-3 py-2 text-sm text-white">
                Save
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
