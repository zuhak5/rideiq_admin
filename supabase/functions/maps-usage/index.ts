import {
  getConfiguredOriginAllowlist,
  getCorsHeadersForRequest,
} from "../_shared/cors.ts";
import { errorJson, json } from "../_shared/json.ts";
import { envTrim } from "../_shared/config.ts";
import { createServiceClient, requireUser } from "../_shared/supabase.ts";
import {
  buildRateLimitHeaders,
  consumeRateLimit,
  getClientIp,
} from "../_shared/rateLimit.ts";
import { verifyTelemetryTokenV1 } from "../_shared/telemetryToken.ts";
import {
  ALL_PROVIDER_CODES,
  isProviderCode,
  type ProviderCode,
} from "../_shared/geo/types.ts";
import {
  isAllowedMapsUsageOrigin,
  isTelemetryOriginSatisfied,
} from "./policy.ts";

type Capability = "render";
type RenderEvent = "render_success" | "render_failure";

function envTelemetrySecret(): string | null {
  return envTrim("MAPS_TELEMETRY_HMAC_SECRET");
}

function isUuid(v: unknown): v is string {
  if (typeof v !== "string") return false;
  // Basic UUID validation (accept hyphenated RFC 4122 forms).
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(v);
}

function isRenderEvent(v: unknown): v is RenderEvent {
  return v === "render_success" || v === "render_failure";
}

function getAllowedOrigins(): string[] {
  return getConfiguredOriginAllowlist([envTrim("ALLOWED_ORIGINS")]);
}

function enforceOrigin(req: Request, allowed: string[]) {
  const origin = req.headers.get("origin");
  if (!isAllowedMapsUsageOrigin(origin, allowed)) {
    throw new Error("origin_not_allowed");
  }
}

Deno.serve(async (req) => {
  const responseHeaders = getCorsHeadersForRequest(req);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: responseHeaders });
  }
  if (req.method !== "POST") {
    return errorJson(
      "method_not_allowed",
      405,
      "method_not_allowed",
      undefined,
      responseHeaders,
    );
  }

  try {
    // Abuse control: this endpoint can be hit on every page load / map init.
    // When rate-limited, we drop the event but still return 200 to avoid breaking UI flows.
    const ip = getClientIp(req) ?? "unknown";
    const limit = 180;
    const windowSeconds = 60;
    const rl = await consumeRateLimit({
      key: `maps-usage:${ip}`,
      windowSeconds,
      limit,
      failOpen: true,
    });
    if (!rl.allowed) {
      return json(
        { ok: true, dropped: true, reason: "rate_limited" },
        200,
        {
          ...responseHeaders,
          ...buildRateLimitHeaders({
            limit,
            remaining: rl.remaining,
            resetAt: rl.resetAt,
          }),
        },
      );
    }
    enforceOrigin(req, getAllowedOrigins());

    // Optional auth: render telemetry may be sent by unauthenticated clients using a short-lived
    // HMAC token minted by maps-config-v2. If an end-user JWT is present, we attach it as the actor.
    const { user } = await requireUser(req);

    const body = (await req.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;

    const provider_code = body["provider_code"];
    const capability = body["capability"] as Capability | undefined;

    if (!isProviderCode(provider_code)) {
      return errorJson(
        "invalid_provider_code",
        400,
        "invalid_provider_code",
        { allowed: [...ALL_PROVIDER_CODES] },
        responseHeaders,
      );
    }

    if (capability !== "render") {
      // Intentionally limited to render events from the web client.
      return errorJson("invalid_capability", 400, "invalid_capability", {
        allowed: ["render"],
      }, responseHeaders);
    }

    const eventRaw = body["event"];
    const event: RenderEvent = isRenderEvent(eventRaw)
      ? eventRaw
      : "render_success";

    // Render usage is counted as 1 "map load" per successful initialization.
    const billed_units = event === "render_success" ? 1 : 0;

    const requestIdRaw = body["request_id"];
    const providedRequestId = isUuid(requestIdRaw) ? requestIdRaw : null;

    const telemetryTokenRaw = body["telemetry_token"];
    const telemetry_token = typeof telemetryTokenRaw === "string"
      ? telemetryTokenRaw
      : null;

    // Require either an authenticated user OR a valid telemetry token.
    // Token binds the request_id and (optionally) the browser origin.
    let tokenPayload: { request_id: string; origin?: string | null } | null =
      null;
    if (telemetry_token) {
      const secret = envTelemetrySecret();
      if (secret) {
        const res = await verifyTelemetryTokenV1(telemetry_token, secret);
        if (res.ok) {
          tokenPayload = {
            request_id: res.payload.request_id,
            origin: res.payload.origin ?? null,
          };

          const origin = req.headers.get("origin") || null;
          if (tokenPayload.origin && origin && tokenPayload.origin !== origin) {
            return errorJson(
              "invalid_telemetry_token",
              401,
              "invalid_telemetry_token",
              undefined,
              responseHeaders,
            );
          }
        }
      }
    }

    const request_id = providedRequestId ?? tokenPayload?.request_id ??
      crypto.randomUUID();
    const tokenVerified = Boolean(
      tokenPayload && tokenPayload.request_id === request_id,
    );
    const requestOrigin = req.headers.get("origin") || null;

    if (!tokenVerified && !user?.id) {
      return errorJson(
        "unauthorized",
        401,
        "unauthorized",
        undefined,
        responseHeaders,
      );
    }

    if (
      !isTelemetryOriginSatisfied({
        requestOrigin,
        tokenOrigin: tokenPayload?.origin ?? null,
        hasAuthenticatedUser: Boolean(user?.id),
      })
    ) {
      return errorJson(
        "invalid_telemetry_token",
        401,
        "invalid_telemetry_token",
        undefined,
        responseHeaders,
      );
    }

    const attempt_number_raw = body["attempt_number"];
    const attempt_number = typeof attempt_number_raw === "number" &&
        Number.isFinite(attempt_number_raw)
      ? Math.max(1, Math.floor(attempt_number_raw))
      : null;

    const tried_providers_raw = body["tried_providers"];
    const tried_providers = Array.isArray(tried_providers_raw)
      ? tried_providers_raw.filter((p) => isProviderCode(p))
      : null;

    const latency_ms_raw = body["latency_ms"];
    const latency_ms =
      typeof latency_ms_raw === "number" && Number.isFinite(latency_ms_raw)
        ? Math.max(0, Math.floor(latency_ms_raw))
        : null;

    const error_detail_raw = body["error_detail"];
    const error_detail = typeof error_detail_raw === "string"
      ? error_detail_raw.slice(0, 2000)
      : null;

    const supabase = createServiceClient();

    // Basic per-request_id event throttling (prevents token re-use abuse).
    // Allow some failures + one success per render session.
    try {
      const since = new Date(Date.now() - 15 * 60 * 1000).toISOString();
      const { count } = await supabase
        .from("maps_requests_log")
        .select("id", { count: "exact", head: true })
        .eq("request_id", request_id)
        .eq("action", "render")
        .gte("created_at", since);
      if (typeof count === "number" && count > 25) {
        return errorJson("too_many_events", 429, "too_many_events", {
          request_id,
        }, responseHeaders);
      }
    } catch {
      // ignore (best-effort defense)
    }

    // Insert detailed request log (Admin live view).
    await supabase.from("maps_requests_log").insert({
      request_id,
      action: "render",
      capability: "render",
      provider_code,
      http_status: event === "render_success" ? 200 : 502,
      latency_ms,
      billed_units,
      actor_user_id: user?.id ?? null,
      client_renderer: provider_code,
      tried_providers,
      attempt_number,
      fallback_reason: event === "render_failure" ? "render_failure" : null,
      error_code: event === "render_failure" ? "render_failure" : null,
      error_detail,
      request_summary: {
        event,
        token_verified: tokenVerified,
      },
      response_summary: null,
    });

    // Only successful render events count toward usage caps.
    if (event === "render_success") {
      await supabase.rpc("maps_usage_increment_v1", {
        p_provider_code: provider_code,
        p_capability: capability,
        p_units: billed_units,
      });
    }

    return json(
      { ok: true, request_id, provider_code, capability, event, billed_units },
      200,
      responseHeaders,
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown_error";
    const status = msg === "origin_not_allowed" ? 403 : 500;
    return errorJson(msg, status, msg, undefined, responseHeaders);
  }
});
