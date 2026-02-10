-- Geo API: server-side routing + geocoding orchestrator with provider fallback,
-- request logging, and short-lived caching.
--
-- Design goals
-- - Centralize all map web-service calls behind Edge Functions so provider keys stay server-side.
-- - Support provider fallback based on admin-configured capability matrix + monthly quotas.
-- - Provide admin observability: recent requests, latency, errors.
-- - Keep cache TTL short and provider-aware (respecting Google caching limits).

-- Request logs (service role writes, admin reads via SECURITY DEFINER RPC).
CREATE TABLE IF NOT EXISTS public.maps_requests_log (
  id bigserial PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  request_id uuid NOT NULL DEFAULT gen_random_uuid(),
  actor_user_id uuid NULL,
  client_renderer text NULL,
  action text NOT NULL,
  provider_code text NOT NULL,
  capability text NOT NULL,
  http_status int NOT NULL,
  latency_ms int NOT NULL,
  billed_units int NOT NULL DEFAULT 1,
  error_code text NULL,
  error_detail text NULL,
  tried_providers text[] NULL,
  request_summary jsonb NULL,
  response_summary jsonb NULL,
  CONSTRAINT maps_requests_log_provider_chk CHECK (provider_code IN ('google','mapbox','here','thunderforest')),
  CONSTRAINT maps_requests_log_cap_chk CHECK (capability IN ('directions','geocode','distance_matrix')),
  CONSTRAINT maps_requests_log_action_chk CHECK (action IN ('route','geocode','reverse','matrix'))
);

CREATE INDEX IF NOT EXISTS idx_maps_requests_log_created_at ON public.maps_requests_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_maps_requests_log_provider ON public.maps_requests_log (provider_code, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_maps_requests_log_capability ON public.maps_requests_log (capability, created_at DESC);

ALTER TABLE public.maps_requests_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.maps_requests_log FROM anon, authenticated;

-- Short-lived cache to reduce duplicate requests (service role only).
CREATE TABLE IF NOT EXISTS public.geo_cache (
  cache_key text PRIMARY KEY,
  provider_code text NOT NULL,
  capability text NOT NULL,
  response_json jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT geo_cache_provider_chk CHECK (provider_code IN ('google','mapbox','here','thunderforest')),
  CONSTRAINT geo_cache_cap_chk CHECK (capability IN ('directions','geocode','distance_matrix'))
);

CREATE INDEX IF NOT EXISTS idx_geo_cache_expires_at ON public.geo_cache (expires_at);

DROP TRIGGER IF EXISTS trg_geo_cache_updated_at ON public.geo_cache;
CREATE TRIGGER trg_geo_cache_updated_at
BEFORE UPDATE ON public.geo_cache
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.geo_cache ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.geo_cache FROM anon, authenticated;

-- Cache helpers (service role via Edge only; no RLS policies).
CREATE OR REPLACE FUNCTION public.geo_cache_get_v1(
  p_cache_key text
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  v_now timestamptz := now();
  v_json jsonb;
BEGIN
  SELECT gc.response_json
  INTO v_json
  FROM public.geo_cache gc
  WHERE gc.cache_key = p_cache_key
    AND gc.expires_at > v_now;

  RETURN v_json;
END;
$$;

CREATE OR REPLACE FUNCTION public.geo_cache_put_v1(
  p_cache_key text,
  p_provider_code text,
  p_capability text,
  p_response jsonb,
  p_ttl_seconds int
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  v_provider text := lower(btrim(p_provider_code));
  v_cap text := lower(btrim(p_capability));
  v_ttl int := greatest(1, least(coalesce(p_ttl_seconds, 300), 2592000)); -- max 30 days
  v_expires timestamptz := now() + make_interval(secs => v_ttl);
BEGIN
  IF v_provider NOT IN ('google','mapbox','here','thunderforest') THEN
    RAISE EXCEPTION 'invalid_provider_code';
  END IF;
  IF v_cap NOT IN ('directions','geocode','distance_matrix') THEN
    RAISE EXCEPTION 'invalid_capability';
  END IF;

  INSERT INTO public.geo_cache(cache_key, provider_code, capability, response_json, expires_at)
  VALUES (p_cache_key, v_provider, v_cap, p_response, v_expires)
  ON CONFLICT (cache_key)
  DO UPDATE SET
    provider_code = EXCLUDED.provider_code,
    capability = EXCLUDED.capability,
    response_json = EXCLUDED.response_json,
    expires_at = EXCLUDED.expires_at,
    updated_at = now();
END;
$$;

-- Admin: list recent provider calls (observability).
CREATE OR REPLACE FUNCTION public.admin_maps_requests_list_v1(
  p_limit int DEFAULT 200,
  p_provider_code text DEFAULT NULL,
  p_capability text DEFAULT NULL
) RETURNS TABLE (
  created_at timestamptz,
  request_id uuid,
  actor_user_id uuid,
  client_renderer text,
  action text,
  provider_code text,
  capability text,
  http_status int,
  latency_ms int,
  billed_units int,
  error_code text,
  tried_providers text[],
  request_summary jsonb,
  response_summary jsonb
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_limit int := greatest(1, least(coalesce(p_limit, 200), 1000));
  v_provider text := NULLIF(lower(btrim(p_provider_code)), '');
  v_cap text := NULLIF(lower(btrim(p_capability)), '');
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF NOT (SELECT public.is_admin()) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  RETURN QUERY
  SELECT
    l.created_at,
    l.request_id,
    l.actor_user_id,
    l.client_renderer,
    l.action,
    l.provider_code,
    l.capability,
    l.http_status,
    l.latency_ms,
    l.billed_units,
    l.error_code,
    l.tried_providers,
    l.request_summary,
    l.response_summary
  FROM public.maps_requests_log l
  WHERE (v_provider IS NULL OR l.provider_code = v_provider)
    AND (v_cap IS NULL OR l.capability = v_cap)
  ORDER BY l.created_at DESC
  LIMIT v_limit;
END;
$$;
;
