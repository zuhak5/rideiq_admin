'use client';

import { useEffect, useMemo, useState } from 'react';
import { useActionState } from 'react';
import { useRouter } from 'next/navigation';
import { saveArticleAction } from './actions';

type Section = { id: string; title: string; key: string; enabled: boolean; sort_order: number };
type Article =
  | {
      id: string;
      section_id: string | null;
      slug: string;
      title: string;
      summary: string | null;
      body_md: string;
      tags: string[];
      enabled: boolean;
    }
  | null;

function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 120);
}

export default function ArticleEditorClient({ sections, article }: { sections: Section[]; article: Article }) {
  const router = useRouter();

  const initial = useMemo(() => {
    return {
      ok: true as const,
      id: article?.id ?? null,
      error: null as string | null,
    };
  }, [article?.id]);

  const [state, action] = useActionState(saveArticleAction as any, initial);

  const [title, setTitle] = useState(article?.title ?? '');
  const [slug, setSlug] = useState(article?.slug ?? '');
  const [summary, setSummary] = useState(article?.summary ?? '');
  const [bodyMd, setBodyMd] = useState(article?.body_md ?? '');
  const [tags, setTags] = useState((article?.tags ?? []).join(', '));
  const [sectionId, setSectionId] = useState(article?.section_id ?? '');
  const [enabled, setEnabled] = useState(article?.enabled ?? true);

  useEffect(() => {
    if (!slug && title) setSlug(slugify(title));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title]);

  useEffect(() => {
    if (state?.ok && state?.id) {
      router.push(`/support/articles/${state.id}`);
      router.refresh();
    }
  }, [state, router]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">{article ? 'Edit Article' : 'New Article'}</h1>
        <p className="text-sm text-gray-500">Write and publish knowledge base content for the customer app.</p>
      </div>

      {state?.error ? <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{state.error}</div> : null}

      <form action={action} className="rounded border bg-white p-4 space-y-4">
        <input type="hidden" name="id" value={article?.id ?? ''} />

        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="md:col-span-2">
            <label className="text-xs text-gray-600">Title</label>
            <input
              name="title"
              className="mt-1 w-full rounded border px-3 py-2 text-sm"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
          </div>

          <div>
            <label className="text-xs text-gray-600">Section</label>
            <select
              name="section_id"
              className="mt-1 w-full rounded border px-3 py-2 text-sm"
              value={sectionId}
              onChange={(e) => setSectionId(e.target.value)}
            >
              <option value="">None</option>
              {sections.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="md:col-span-2">
            <label className="text-xs text-gray-600">Slug</label>
            <input
              name="slug"
              className="mt-1 w-full rounded border px-3 py-2 text-sm"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              required
            />
            <div className="text-xs text-gray-500 mt-1">Used in URLs. Lowercase letters, numbers, and hyphens.</div>
          </div>

          <div className="flex items-end gap-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="enabled"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
              />
              Enabled
            </label>
          </div>
        </div>

        <div>
          <label className="text-xs text-gray-600">Summary</label>
          <input
            name="summary"
            className="mt-1 w-full rounded border px-3 py-2 text-sm"
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder="Optional short description…"
          />
        </div>

        <div>
          <label className="text-xs text-gray-600">Body (Markdown)</label>
          <textarea
            name="body_md"
            className="mt-1 w-full rounded border px-3 py-2 font-mono text-sm"
            rows={16}
            value={bodyMd}
            onChange={(e) => setBodyMd(e.target.value)}
            placeholder="Markdown supported…"
          />
        </div>

        <div>
          <label className="text-xs text-gray-600">Tags</label>
          <input
            name="tags"
            className="mt-1 w-full rounded border px-3 py-2 text-sm"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="comma,separated,tags"
          />
        </div>

        <div className="flex items-center justify-end gap-2">
          <button type="submit" className="rounded bg-black px-4 py-2 text-sm text-white">
            Save
          </button>
        </div>
      </form>
    </div>
  );
}
