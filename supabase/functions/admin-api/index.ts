import { withRequestContext } from '../_shared/requestContext.ts';
import { errorJson, json } from '../_shared/json.ts';
import { getRouteFromRequest, ROUTES } from './router.ts';

Deno.serve((req) => {
  const route = getRouteFromRequest(req);

  if (!route) {
    // Helpful landing for debugging.
    return json(
      {
        ok: true,
        function: 'admin-api',
        routes: Object.keys(ROUTES).sort(),
      },
      200,
    );
  }

  const handler = ROUTES[route];
  if (!handler) {
    return errorJson('Not found', 404, 'NOT_FOUND');
  }

  return withRequestContext(route, req, async (ctx) => {
    try {
      return await handler(req, ctx);
    } catch (err) {
      ctx?.error?.('admin_api.unhandled', { route, error: String((err as any)?.message ?? err) });
      return errorJson('Internal error', 500, 'UNHANDLED', undefined, ctx?.headers ?? {});
    }
  }).catch((err) => errorJson(String((err as any)?.message ?? err ?? 'Internal error'), 500));
});
