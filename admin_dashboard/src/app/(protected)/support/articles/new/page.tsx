import Link from 'next/link';
import { getAdminContext } from '@/lib/auth/guards';
import { listSupportSections } from '@/lib/admin/support';
import ArticleEditorClient from '../articleEditorClient';

export default async function NewSupportArticlePage() {
  const ctx = await getAdminContext();
  if (!ctx.guard.can('support.manage')) {
    return <div className="p-6 text-sm text-red-600">Forbidden</div>;
  }

  const { sections } = await listSupportSections(ctx.supabase);

  return (
    <div className="p-6 space-y-4">
      <Link className="text-sm text-gray-600 hover:underline" href="/support/articles">
        ← Back to articles
      </Link>
      <ArticleEditorClient sections={sections} article={null} />
    </div>
  );
}
