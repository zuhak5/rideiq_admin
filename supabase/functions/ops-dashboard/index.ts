import { errorJson } from '../_shared/json.ts';
import { withRequestContext } from '../_shared/requestContext.ts';
import { handleOpsDashboard } from './handler.ts';

Deno.serve((req) =>
  withRequestContext('ops-dashboard', req, (ctx) => handleOpsDashboard(req, ctx)).catch((err) => {
    // withRequestContext should catch; this is only for catastrophic failures.
    return errorJson(String((err as any)?.message ?? err ?? 'Internal error'), 500);
  })
);
