import { withRequestContext } from '../_shared/requestContext.ts';
import { fareEngine } from '../_shared/fareEngine.ts';
import { errorJson } from '../_shared/json.ts';
import { requireUser } from '../_shared/supabase.ts';

/**
 * Stable entrypoint for the pricing system.
 *
 * This function is deployed with verify_jwt=false (config.toml) to avoid legacy gateway JWT verification
 * issues with JWT Signing Keys. We therefore MUST enforce auth explicitly here.
 */
Deno.serve((req) =>
  withRequestContext('fare-engine', req, async (ctx) => {
    // Skip auth for preflight only
    if (req.method !== 'OPTIONS') {
      const { user, error } = await requireUser(req);
      if (!user) {
        return errorJson(
          'Unauthorized',
          401,
          'UNAUTHORIZED',
          error ? { detail: error } : undefined,
          ctx.headers,
        );
      }
      ctx.setUserId(user.id);
      return fareEngine(req, ctx, 'fare-engine-v1', { id: user.id });
    }

    return fareEngine(req, ctx, 'fare-engine-v1');
  }),
);
