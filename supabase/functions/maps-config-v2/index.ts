import { getCorsHeadersForRequest } from "../_shared/cors.ts";
import { errorJson, json } from "../_shared/json.ts";
import { envTrim } from "../_shared/config.ts";
import { createServiceClient, requireUser } from "../_shared/supabase.ts";
import {
  buildRateLimitHeaders,
  consumeRateLimit,
  getClientIp,
} from "../_shared/rateLimit.ts";
import {
  issueTelemetryTokenV1,
  type TelemetryTokenPayloadV1,
} from "../_shared/telemetryToken.ts";
import {
  ALL_PROVIDER_CODES,
  isProviderCode,
  type ProviderCode,
} from "../_shared/geo/types.ts";
import {
  buildEnabledCapabilityMap,
  isProviderEligibleForRenderRequest,
  normalizeRequiredCapabilities,
  type RenderRequestCapability,
  type RequiredGeoCapability,
  resolveRenderRequestRequiredCapabilities,
} from "../_shared/geo/providerEligibility.ts";
import {
  providerHasClientRenderKey,
  providerHasGeoServerKey,
} from "../_shared/geo/providerKeys.ts";
import { canServeMapsConfigRequest } from "./policy.ts";

type Capability = "render" | "directions" | "geocode" | "distance_matrix";

type MapsConfigV2Response = {
  ok: true;
  capability: Capability;
  provider: ProviderCode;
  config: Record<string, unknown> & { language: string; region: string };
  fallback_order: ProviderCode[];
  // Render telemetry: a stable request_id + HMAC token so clients can
  // log render success/failure without requiring end-user auth.
  request_id?: string;
  telemetry_token?: string;
  telemetry_expires_at?: string;
  limits: {
    monthlySoftCapUnits?: number | null;
    monthlyHardCapUnits?: number | null;
  };
};

function isUuid(v: unknown): v is string {
  if (typeof v !== "string") return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(v);
}

function envTelemetrySecret(): string | null {
  return envTrim("MAPS_TELEMETRY_HMAC_SECRET");
}

function parseCsv(input: string | null): string[] {
  if (!input) return [];
  return input
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function getAllowedOrigins(): string[] {
  // Backwards-compatible: allow either ALLOWED_ORIGINS (legacy for this function)
  // or the shared CORS_ALLOW_ORIGINS used by our CORS helper.
  const fromEnv = envTrim("ALLOWED_ORIGINS") || envTrim("CORS_ALLOW_ORIGINS") ||
    "";
  const configuredOrigins = fromEnv
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((v) => {
      try {
        return new URL(v).origin;
      } catch {
        return v;
      }
    });
  return Array.from(
    new Set<string>([
      ...configuredOrigins,
      "https://rideiqadmin.vercel.app",
      "http://127.0.0.1:3000",
      "http://127.0.0.1:3001",
      "http://127.0.0.1:5173",
      "http://localhost:3000",
      "http://localhost:3001",
      "http://localhost:5173",
    ]),
  );
}

function buildClientConfig(
  p: ProviderCode,
  opts: { language: string; region: string },
) {
  const language = opts.language;
  const region = opts.region;
  switch (p) {
    case "google": {
      const apiKey = envTrim("GOOGLE_MAPS_CLIENT_KEY") ||
        envTrim("MAPS_CLIENT_KEY");
      const mapId = envTrim("GOOGLE_MAP_ID"); // optional
      return { apiKey, mapId, language, region };
    }
    case "mapbox": {
      const token = envTrim("MAPBOX_PUBLIC_TOKEN");
      const styleUrl = envTrim("MAPBOX_STYLE_URL") ||
        "mapbox://styles/mapbox/standard";
      return { token, styleUrl, language, region };
    }
    case "here": {
      const apiKey = envTrim("HERE_API_KEY");
      const style = envTrim("HERE_STYLE") || "normal.day";
      return { apiKey, style, language, region };
    }
  }
}

Deno.serve(async (req) => {
  const responseHeaders = getCorsHeadersForRequest(req);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: responseHeaders });
  }
  if (req.method !== "GET" && req.method !== "POST") {
    return errorJson(
      "method_not_allowed",
      405,
      "method_not_allowed",
      undefined,
      responseHeaders,
    );
  }

  try {
    // Basic anonymous rate limit (per IP).
    const ip = getClientIp(req) ?? "unknown";
    const limit = 120;
    const windowSeconds = 60;
    const rl = await consumeRateLimit({
      key: `maps-config-v2:${ip}`,
      windowSeconds,
      limit,
      failOpen: true,
    });
    if (!rl.allowed) {
      return errorJson(
        "rate_limited",
        429,
        "rate_limited",
        undefined,
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

    const allowedOrigins = getAllowedOrigins();
    const origin = req.headers.get("origin");
    let hasAuthenticatedUser = false;

    if (
      !canServeMapsConfigRequest({
        origin,
        allowedOrigins,
        hasAuthenticatedUser,
      })
    ) {
      const { user } = await requireUser(req);
      hasAuthenticatedUser = Boolean(user?.id);
    }

    if (
      !canServeMapsConfigRequest({
        origin,
        allowedOrigins,
        hasAuthenticatedUser,
      })
    ) {
      throw new Error("origin_not_allowed");
    }

    let capability: Capability = "render";
    let exclude: ProviderCode[] = [];
    let supported: ProviderCode[] = [];
    let requiredCapabilities: RequiredGeoCapability[] = [];
    let requestId: string | null = null;

    if (req.method === "GET") {
      const url = new URL(req.url);
      capability =
        (url.searchParams.get("capability") || "render") as Capability;
      exclude = parseCsv(url.searchParams.get("exclude")) as ProviderCode[];
      supported = parseCsv(url.searchParams.get("supported")) as ProviderCode[];
      requiredCapabilities = normalizeRequiredCapabilities(
        parseCsv(url.searchParams.get("required_capabilities")),
      );
      const rid = url.searchParams.get("request_id");
      if (rid && isUuid(rid)) requestId = rid;
    } else {
      const body = (await req.json().catch(() => ({}))) as Record<
        string,
        unknown
      >;
      const cap = body["capability"];
      if (typeof cap === "string" && cap) capability = cap as Capability;

      const ex = body["exclude"];
      if (Array.isArray(ex)) exclude = ex.map(String) as ProviderCode[];
      else if (typeof ex === "string") exclude = parseCsv(ex) as ProviderCode[];

      const sup = body["supported"];
      if (Array.isArray(sup)) supported = sup.map(String) as ProviderCode[];
      else if (typeof sup === "string") {
        supported = parseCsv(sup) as ProviderCode[];
      }
      requiredCapabilities = normalizeRequiredCapabilities(
        body["required_capabilities"],
      );

      const rid = body["request_id"];
      if (isUuid(rid)) requestId = rid;
    }

    requiredCapabilities = resolveRenderRequestRequiredCapabilities({
      capability,
      requiredCapabilities,
      origin,
    });

    if (
      !["render", "directions", "geocode", "distance_matrix"].includes(
        capability,
      )
    ) {
      return errorJson(
        "invalid_capability",
        400,
        "invalid_capability",
        undefined,
        responseHeaders,
      );
    }

    const supportedSet = new Set<ProviderCode>(
      (supported.length ? supported : [...ALL_PROVIDER_CODES])
        .filter((provider): provider is ProviderCode =>
          isProviderCode(provider)
        ),
    );

    const supabase = createServiceClient();
    const capabilityMatrix = new Map<
      ProviderCode,
      Set<RenderRequestCapability>
    >();

    if (requiredCapabilities.length > 0) {
      const { data: capabilityRows, error: capabilityErr } = await supabase
        .from("maps_provider_capabilities")
        .select("provider_code, capability, enabled")
        .in("provider_code", [...supportedSet])
        .in("capability", ["render", ...requiredCapabilities]);

      if (capabilityErr) {
        return errorJson(
          "failed_to_load_provider_capabilities",
          500,
          "failed_to_load_provider_capabilities",
          { details: capabilityErr.message },
          responseHeaders,
        );
      }

      for (
        const [provider, enabledCapabilities] of buildEnabledCapabilityMap(
          capabilityRows ?? [],
        )
      ) {
        capabilityMatrix.set(provider, enabledCapabilities);
      }
    }

    const isEligibleForRenderRequest = (provider: ProviderCode) =>
      isProviderEligibleForRenderRequest({
        provider,
        supportedProviders: supportedSet,
        requiredCapabilities,
        enabledCapabilities: capabilityMatrix,
        hasRenderKey: providerHasClientRenderKey,
        hasGeoServerKey: providerHasGeoServerKey,
      });

    // Attempt to pick a provider, skipping any providers without keys configured
    // or unsupported by the requesting client.
    const tried: string[] = exclude.filter((
      provider,
    ): provider is ProviderCode => isProviderCode(provider));
    let selected: ProviderCode | null = null;

    for (let i = 0; i < ALL_PROVIDER_CODES.length + 2; i += 1) {
      const { data, error } = await supabase.rpc("maps_pick_provider_v4", {
        p_capability: capability,
        p_exclude: tried,
      });

      if (error) {
        return errorJson(
          "failed_to_pick_provider",
          500,
          "failed_to_pick_provider",
          { details: error.message },
          responseHeaders,
        );
      }

      const candidate = typeof data === "string"
        ? data.trim().toLowerCase()
        : null;
      if (!candidate) break;
      if (!isProviderCode(candidate)) {
        tried.push(candidate);
        continue;
      }

      if (!supportedSet.has(candidate)) {
        tried.push(candidate);
        continue;
      }
      if (!isEligibleForRenderRequest(candidate)) {
        tried.push(candidate);
        continue;
      }

      selected = candidate;
      break;
    }

    if (!selected) {
      return errorJson("no_available_provider", 503, "no_available_provider", {
        capability,
        required_capabilities: requiredCapabilities.length
          ? requiredCapabilities
          : undefined,
      }, responseHeaders);
    }

    const { data: providerRow, error: providerRowErr } = await supabase
      .from("maps_providers")
      .select(
        "provider_code,language,region,monthly_soft_cap_units,monthly_hard_cap_units",
      )
      .eq("provider_code", selected)
      .maybeSingle();

    if (providerRowErr) {
      return errorJson(
        "failed_to_load_provider_config",
        500,
        "failed_to_load_provider_config",
        { details: providerRowErr.message },
        responseHeaders,
      );
    }

    const language = providerRow?.language || "ar";
    const region = providerRow?.region || "IQ";

    // Compute fallback order, filtered to supported providers and configured keys.
    const { data: orderRows, error: orderErr } = await supabase
      .from("maps_providers")
      .select("provider_code,priority,enabled")
      .eq("enabled", true)
      .order("priority", { ascending: false });

    if (orderErr) {
      return errorJson(
        "failed_to_load_provider_order",
        500,
        "failed_to_load_provider_order",
        { details: orderErr.message },
        responseHeaders,
      );
    }

    const fallback_order = (orderRows || [])
      .map((
        r,
      ) => (typeof r.provider_code === "string"
        ? r.provider_code.trim().toLowerCase()
        : null)
      )
      .filter((provider): provider is ProviderCode => isProviderCode(provider))
      .filter((p) => p !== selected)
      .filter((p) => isEligibleForRenderRequest(p));

    const out: MapsConfigV2Response = {
      ok: true,
      capability,
      provider: selected,
      config: buildClientConfig(selected, { language, region }),
      fallback_order,
      limits: {
        monthlySoftCapUnits: providerRow?.monthly_soft_cap_units ?? null,
        monthlyHardCapUnits: providerRow?.monthly_hard_cap_units ?? null,
      },
    };

    if (capability === "render") {
      const rid = requestId ?? crypto.randomUUID();
      out.request_id = rid;

      const secret = envTelemetrySecret();
      if (secret) {
        const now = Math.floor(Date.now() / 1000);
        const exp = now + 10 * 60; // 10 minutes
        const origin = req.headers.get("origin") || null;

        const payload: TelemetryTokenPayloadV1 = {
          v: 1,
          request_id: rid,
          capability: "render",
          iat: now,
          exp,
          origin,
        };
        out.telemetry_token = await issueTelemetryTokenV1(payload, secret);
        out.telemetry_expires_at = new Date(exp * 1000).toISOString();
      }
    }

    // Render usage is logged by the client after a successful renderer initialization.
    return json(out, 200, responseHeaders);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown_error";
    const status = msg === "origin_not_allowed" ? 403 : 500;
    return errorJson(msg, status, msg, undefined, responseHeaders);
  }
});
