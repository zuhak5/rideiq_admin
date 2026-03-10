import { ZodError } from 'npm:zod@3.23.8';

import { errorJson, json } from '../_shared/json.ts';
import {
  buildRateLimitHeaders,
  consumeRateLimit,
  getClientIp,
} from '../_shared/rateLimit.ts';
import { withRequestContext } from '../_shared/requestContext.ts';
import { rideRequestCreateSchema } from '../_shared/schemas.ts';
import { createUserClient, requireUser } from '../_shared/supabase.ts';

type MatchRow = {
  id?: string;
  status?: string;
  assigned_driver_id?: string | null;
  match_deadline?: string | null;
  match_attempts?: number;
  matched_at?: string | null;
};

function normalizedMessage(message: string) {
  return message.replace(/^RPC error:\s*/i, '').trim();
}

function mapCreateError(message: string) {
  const normalized = normalizedMessage(message);

  if (normalized === 'missing_fare_quote') {
    return {
      status: 400,
      code: 'MISSING_FARE_QUOTE',
      message: 'A fare quote is required before booking.',
    };
  }
  if (normalized === 'invalid_fare_quote') {
    return {
      status: 422,
      code: 'INVALID_FARE_QUOTE',
      message: 'Ride quote is invalid. Please request a new quote.',
    };
  }
  if (normalized === 'invalid_product') {
    return {
      status: 400,
      code: 'INVALID_PRODUCT',
      message: 'Selected ride product is not available.',
    };
  }
  if (normalized === 'outside_service_area') {
    return {
      status: 400,
      code: 'OUTSIDE_SERVICE_AREA',
      message: 'Pickup is outside the service area.',
    };
  }
  if (normalized === 'invalid_payment_method') {
    return {
      status: 400,
      code: 'INVALID_PAYMENT_METHOD',
      message: 'Payment method must be wallet or cash.',
    };
  }
  if (normalized === 'unauthorized') {
    return {
      status: 401,
      code: 'UNAUTHORIZED',
      message: 'Unauthorized',
    };
  }
  if (normalized === 'forbidden') {
    return {
      status: 403,
      code: 'FORBIDDEN',
      message: 'You are not allowed to create this ride request.',
    };
  }
  if (normalized === 'too_many_pending') {
    return {
      status: 409,
      code: 'TOO_MANY_PENDING',
      message: 'Too many active ride requests. Cancel an existing request first.',
    };
  }

  return {
    status: 400,
    code: 'REQUEST_CREATE_FAILED',
    message: normalized || 'Failed to create ride request.',
  };
}

function mapMatchError(message: string) {
  const normalized = normalizedMessage(message);

  if (normalized === 'insufficient_wallet_balance') {
    return {
      status: 409,
      code: 'INSUFFICIENT_FUNDS',
      message: 'Insufficient wallet balance. Please top up and try again.',
    };
  }
  if (normalized === 'ride_request_not_found') {
    return {
      status: 404,
      code: 'RIDE_REQUEST_NOT_FOUND',
      message: 'Ride request not found.',
    };
  }
  if (normalized === 'forbidden') {
    return {
      status: 403,
      code: 'FORBIDDEN',
      message: 'You are not allowed to match this ride request.',
    };
  }
  if (normalized === 'invalid_quote') {
    return {
      status: 422,
      code: 'INVALID_QUOTE',
      message: 'Ride quote is invalid. Please request a new quote.',
    };
  }

  return {
    status: 400,
    code: 'DISPATCH_ERROR',
    message: normalized || 'Unable to match ride request.',
  };
}

Deno.serve((req) =>
  withRequestContext('ride-request-create', req, async (ctx) => {
    if (req.method !== 'POST') {
      return errorJson(
        'Method not allowed',
        405,
        'METHOD_NOT_ALLOWED',
        undefined,
        ctx.headers,
      );
    }

    const { user, error: authError } = await requireUser(req, ctx);
    if (!user) {
      return errorJson(
        String(authError ?? 'Unauthorized'),
        401,
        'UNAUTHORIZED',
        undefined,
        ctx.headers,
      );
    }

    ctx.setUserId(user.id);

    const ip = getClientIp(req);
    const rateLimit = await consumeRateLimit({
      key: `ride_request_create:${user.id}:${ip ?? 'noip'}`,
      windowSeconds: 60,
      limit: 10,
    });
    const rateHeaders = buildRateLimitHeaders({
      limit: 10,
      remaining: rateLimit.remaining,
      resetAt: rateLimit.resetAt,
    });

    if (!rateLimit.allowed) {
      return json(
        {
          error: 'Rate limit exceeded',
          code: 'RATE_LIMITED',
          remaining: rateLimit.remaining,
          reset_at: rateLimit.resetAt,
        },
        429,
        { ...ctx.headers, ...rateHeaders },
      );
    }

    let input: ReturnType<typeof rideRequestCreateSchema.parse>;
    try {
      input = rideRequestCreateSchema.parse(await req.json());
    } catch (error) {
      if (error instanceof ZodError) {
        const firstIssue = error.issues[0];
        const field = firstIssue?.path.join('.') || 'unknown';
        return errorJson(
          `${field}: ${firstIssue?.message ?? 'Validation failed'}`,
          400,
          'VALIDATION_ERROR',
          { issues: error.issues },
          { ...ctx.headers, ...rateHeaders },
        );
      }
      if (error instanceof SyntaxError) {
        return errorJson(
          'Invalid JSON body',
          400,
          'INVALID_JSON',
          undefined,
          { ...ctx.headers, ...rateHeaders },
        );
      }
      throw error;
    }

    const supabase = createUserClient(req);

    const { data: createData, error: createError } = await supabase.rpc(
      'ride_request_create_user_v1',
      {
        p_pickup_lat: input.pickup_lat,
        p_pickup_lng: input.pickup_lng,
        p_dropoff_lat: input.dropoff_lat,
        p_dropoff_lng: input.dropoff_lng,
        p_pickup_address: input.pickup_address ?? null,
        p_dropoff_address: input.dropoff_address ?? null,
        p_product_code: input.product_code,
        p_preferences: input.preferences,
        p_payment_method: input.payment_method,
        p_fare_quote_id: input.fare_quote_id,
        p_request_id: input.request_id ?? null,
      },
    );

    if (createError || !createData) {
      const mapped = mapCreateError(createError?.message ?? '');
      return errorJson(
        mapped.message,
        mapped.status,
        mapped.code,
        undefined,
        { ...ctx.headers, ...rateHeaders },
      );
    }

    const createResult = createData as Record<string, unknown>;
    const rideRequest = createResult['ride_request'] as
      | Record<string, unknown>
      | undefined;
    const rideRequestId = String(rideRequest?.['id'] ?? '').trim();
    ctx.setCorrelationId(rideRequestId);

    if (!rideRequestId) {
      return errorJson(
        'Ride request was created without an id.',
        500,
        'REQUEST_CREATE_FAILED',
        undefined,
        { ...ctx.headers, ...rateHeaders },
      );
    }

    const { data: matchData, error: matchError } = await supabase.rpc(
      'dispatch_match_ride_user',
      {
        p_request_id: rideRequestId,
      },
    );

    if (matchError) {
      const mapped = mapMatchError(matchError.message ?? '');
      return errorJson(
        mapped.message,
        mapped.status,
        mapped.code,
        {
          ride_request: rideRequest,
          already_exists: Boolean(createResult['already_exists']),
        },
        { ...ctx.headers, ...rateHeaders },
      );
    }

    const matchResult = (Array.isArray(matchData)
      ? matchData[0]
      : matchData) as MatchRow | undefined;

    return json(
      {
        ride_request: rideRequest,
        already_exists: Boolean(createResult['already_exists']),
        match_result: matchResult ?? null,
        rate_limit: {
          remaining: rateLimit.remaining,
          reset_at: rateLimit.resetAt,
        },
      },
      200,
      { ...ctx.headers, ...rateHeaders },
    );
  }),
);
