import { createUserClient } from '../../_shared/supabase.ts';
import { requirePermission } from '../../_shared/admin.ts';
import { json, errorJson } from '../../_shared/json.ts';
import { requireMethod, validateJsonBody } from '../../_shared/validate.ts';
import { adminSupportArticleUpsertBodySchema } from '../../_shared/schemas.ts';

export async function handle(req: Request, ctx: any): Promise<Response> {
  const methodErr = requireMethod(req, ctx, 'POST');
  if (methodErr) return methodErr;

  const guard = await requirePermission(req, ctx, 'support.manage');
  if ('res' in guard) return guard.res;

  const body = await validateJsonBody(req, ctx, adminSupportArticleUpsertBodySchema);
  if (!body.ok) return body.res;

  const supabase = createUserClient(req);
  const b = body.data;

  const { data, error } = await supabase.rpc('admin_support_article_upsert_v1', {
    p_id: b.id ?? null,
    p_section_id: b.section_id ?? null,
    p_slug: b.slug,
    p_title: b.title,
    p_summary: b.summary ?? null,
    p_body_md: b.body_md ?? '',
    p_tags: b.tags ?? [],
    p_enabled: b.enabled ?? true,
  });

  if (error) {
    ctx?.error?.('admin_support.article_upsert.rpc_error', { error: error.message });
    return errorJson('RPC error', 500, 'RPC_ERROR', { error: error.message }, ctx.headers);
  }

  return json(data ?? { ok: true }, 200, ctx.headers);
}
