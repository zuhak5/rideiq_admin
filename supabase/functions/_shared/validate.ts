import { z } from 'npm:zod@3.23.8';

import { errorJson } from './json.ts';
import type { RequestContext } from './requestContext.ts';

export type ValidationResult<T> = { ok: true; data: T } | { ok: false; res: Response };

export function requireMethod(req: Request, ctx: RequestContext, method: 'GET' | 'POST') {
  if (req.method !== method) {
    return errorJson('Method not allowed', 405, 'METHOD_NOT_ALLOWED', { allowed: method }, ctx.headers);
  }
  return null;
}

export function getQuery(req: Request): Record<string, string> {
  const url = new URL(req.url);
  const out: Record<string, string> = {};
  for (const [k, v] of url.searchParams.entries()) out[k] = v;
  return out;
}

async function readJsonBody(req: Request): Promise<unknown> {
  // Deno will throw on empty body; treat it as {}.
  return await req.json().catch(() => ({}));
}

function zodIssues(err: z.ZodError): Array<{ path: string; message: string }> {
  return err.issues.map((i) => ({
    path: i.path.map(String).join('.') || '(root)',
    message: i.message,
  }));
}

export async function validateJsonBody<S extends z.ZodTypeAny>(
  req: Request,
  ctx: RequestContext,
  schema: S,
): Promise<ValidationResult<z.infer<S>>> {
  const raw = await readJsonBody(req);
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      res: errorJson(
        'Validation error',
        400,
        'VALIDATION_ERROR',
        { issues: zodIssues(parsed.error) },
        ctx.headers,
      ),
    };
  }
  return { ok: true, data: parsed.data };
}

export function validateQuery<S extends z.ZodTypeAny>(
  req: Request,
  ctx: RequestContext,
  schema: S,
): ValidationResult<z.infer<S>> {
  const raw = getQuery(req);
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      res: errorJson(
        'Validation error',
        400,
        'VALIDATION_ERROR',
        { issues: zodIssues(parsed.error) },
        ctx.headers,
      ),
    };
  }
  return { ok: true, data: parsed.data };
}
