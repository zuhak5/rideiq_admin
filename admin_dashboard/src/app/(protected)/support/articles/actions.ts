'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { getAdminContext } from '@/lib/auth/guards';
import { upsertSupportSection, upsertSupportArticle } from '@/lib/admin/support';

const uuid = z.string().uuid();

function cleanOptionalText(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : '';
  return s ? s : null;
}

export async function upsertSectionAction(formData: FormData): Promise<void> {
  const ctx = await getAdminContext();
  if (!ctx.guard.can('support.manage')) throw new Error('Forbidden');

  const key = z.string().min(1).max(80).parse(String(formData.get('key') ?? '').trim());
  const title = z.string().min(1).max(120).parse(String(formData.get('title') ?? '').trim());
  const sortOrderRaw = cleanOptionalText(formData.get('sort_order'));
  const sort_order = sortOrderRaw ? Number(sortOrderRaw) : 0;
  const enabled = formData.get('enabled') ? true : false;

  await upsertSupportSection(ctx.supabase, { key, title, sort_order, enabled });

  revalidatePath('/support/articles');
}

export async function saveArticleAction(
  _prevState: any,
  formData: FormData,
): Promise<{ ok: boolean; id?: string | null; error?: string | null }> {
  const ctx = await getAdminContext();
  if (!ctx.guard.can('support.manage')) return { ok: false, error: 'Forbidden' };

  try {
    const idRaw = cleanOptionalText(formData.get('id'));
    const id = idRaw ? uuid.parse(idRaw) : null;
    const sectionRaw = cleanOptionalText(formData.get('section_id'));
    const section_id = sectionRaw ? uuid.parse(sectionRaw) : null;

    const slug = z.string().min(1).max(120).parse(String(formData.get('slug') ?? '').trim());
    const title = z.string().min(1).max(180).parse(String(formData.get('title') ?? '').trim());
    const summary = cleanOptionalText(formData.get('summary'));
    const body_md = String(formData.get('body_md') ?? '');
    const enabled = formData.get('enabled') ? true : false;

    const tagsRaw = cleanOptionalText(formData.get('tags'));
    const tags = tagsRaw
      ? tagsRaw
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean)
          .slice(0, 50)
      : [];

    const { article } = await upsertSupportArticle(ctx.supabase, {
      id,
      section_id,
      slug,
      title,
      summary,
      body_md,
      tags,
      enabled,
    });

    revalidatePath('/support/articles');
    revalidatePath(`/support/articles/${article.id}`);

    return { ok: true, id: article.id, error: null };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'Failed to save' };
  }
}
