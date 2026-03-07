-- Provider health / circuit breaker for maps providers.
--
-- Purpose:
-- - Avoid repeatedly calling a provider that is currently failing (rate-limited, auth/quota, transient outage).
-- - Enable automatic fallback to the next provider in priority order.
-- - Give admins visibility + manual reset controls.

CREATE TABLE IF NOT EXISTS public.maps_provider_health (
  provider_code text NOT NULL,
  capability text NOT NULL,
  consecutive_failures int NOT NULL DEFAULT 0,
  disabled_until timestamptz NULL,
  last_http_status int NULL,
  last_error_code text NULL,
  last_failure_at timestamptz NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider_code, capability),
  CONSTRAINT mph_provider_chk CHECK (provider_code IN ('google','mapbox','here')),
  CONSTRAINT mph_cap_chk CHECK (capability IN ('render','directions','geocode','distance_matrix'))
);

CREATE INDEX IF NOT EXISTS idx_maps_provider_health_disabled_until
  ON public.maps_provider_health (disabled_until);

ALTER TABLE public.maps_provider_health ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.maps_provider_health FROM anon, authenticated;

-- Service role updates health on failures.
CREATE OR REPLACE FUNCTION public.maps_provider_health_on_failure_v1(
  p_provider_code text,
  p_capability text,
  p_http_status int DEFAULT NULL,
  p_error_code text DEFAULT NULL,
  p_base_cooldown_seconds int DEFAULT 60
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  v_provider text := lower(btrim(p_provider_code));
  v_cap text := lower(btrim(p_capability));
  v_now timestamptz := now();
  v_base int := greatest(0, least(coalesce(p_base_cooldown_seconds, 60), 86400));
  v_new_failures int;
  v_effective int;
BEGIN
  IF v_provider NOT IN ('google','mapbox','here') THEN
    RAISE EXCEPTION 'invalid_provider_code';
  END IF;
  IF v_cap NOT IN ('render','directions','geocode','distance_matrix') THEN
    RAISE EXCEPTION 'invalid_capability';
  END IF;

  INSERT INTO public.maps_provider_health(provider_code, capability)
  VALUES (v_provider, v_cap)
  ON CONFLICT (provider_code, capability)
  DO NOTHING;

  -- Increment failures.
  UPDATE public.maps_provider_health
  SET
    consecutive_failures = consecutive_failures + 1,
    last_http_status = p_http_status,
    last_error_code = left(coalesce(p_error_code, ''), 120),
    last_failure_at = v_now,
    updated_at = v_now
  WHERE provider_code = v_provider AND capability = v_cap
  RETURNING consecutive_failures INTO v_new_failures;

  -- Exponential backoff capped at 24h.
  v_effective := LEAST(86400, v_base * power(2, GREATEST(0, v_new_failures - 1))::int);

  UPDATE public.maps_provider_health
  SET disabled_until = GREATEST(coalesce(disabled_until, v_now), v_now + make_interval(secs => v_effective)),
      updated_at = v_now
  WHERE provider_code = v_provider AND capability = v_cap;
END;
$$;

-- Service role resets health on success.
CREATE OR REPLACE FUNCTION public.maps_provider_health_on_success_v1(
  p_provider_code text,
  p_capability text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  v_provider text := lower(btrim(p_provider_code));
  v_cap text := lower(btrim(p_capability));
BEGIN
  IF v_provider NOT IN ('google','mapbox','here') THEN
    RAISE EXCEPTION 'invalid_provider_code';
  END IF;
  IF v_cap NOT IN ('render','directions','geocode','distance_matrix') THEN
    RAISE EXCEPTION 'invalid_capability';
  END IF;

  INSERT INTO public.maps_provider_health(provider_code, capability)
  VALUES (v_provider, v_cap)
  ON CONFLICT (provider_code, capability)
  DO UPDATE SET
    consecutive_failures = 0,
    disabled_until = NULL,
    updated_at = now();
END;
$$;

-- Picker v3: like v2 but excludes providers that are currently in cooldown.
CREATE OR REPLACE FUNCTION public.maps_pick_provider_v3(
  p_capability text,
  p_exclude text[] DEFAULT '{}'::text[]
) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  v_month_start date := date_trunc('month', (now() AT TIME ZONE 'UTC'))::date;
  v_provider text;
BEGIN
  IF p_capability NOT IN ('render','directions','geocode','distance_matrix') THEN
    RAISE EXCEPTION 'unknown_capability';
  END IF;

  SELECT mp.provider_code
  INTO v_provider
  FROM public.maps_providers mp
  JOIN public.maps_provider_capabilities mc
    ON mc.provider_code = mp.provider_code
   AND mc.capability = p_capability
   AND mc.enabled = true
  LEFT JOIN public.maps_provider_health mh
    ON mh.provider_code = mp.provider_code
   AND mh.capability = p_capability
  WHERE mp.enabled = true
    AND mp.provider_code <> ALL(COALESCE(p_exclude, '{}'::text[]))
    AND (mh.disabled_until IS NULL OR mh.disabled_until <= now())
    AND (
      mp.monthly_hard_cap_units IS NULL
      OR (
        COALESCE(
          (SELECT SUM(mu.units)
           FROM public.maps_usage_daily mu
           WHERE mu.provider_code = mp.provider_code
             AND mu.capability = p_capability
             AND mu.day >= v_month_start),
          0
        ) < mp.monthly_hard_cap_units
      )
    )
  ORDER BY mp.priority DESC
  LIMIT 1;

  RETURN v_provider;
END;
$$;

-- Admin: view provider health (live ops).
CREATE OR REPLACE FUNCTION public.admin_maps_provider_health_list_v1()
RETURNS TABLE (
  provider_code text,
  capability text,
  consecutive_failures int,
  disabled_until timestamptz,
  last_http_status int,
  last_error_code text,
  last_failure_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF NOT (SELECT public.is_admin()) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  RETURN QUERY
  SELECT
    h.provider_code,
    h.capability,
    h.consecutive_failures,
    h.disabled_until,
    h.last_http_status,
    h.last_error_code,
    h.last_failure_at,
    h.updated_at
  FROM public.maps_provider_health h
  ORDER BY h.provider_code, h.capability;
END;
$$;

-- Admin: manually reset (useful if you fix keys or quotas).
CREATE OR REPLACE FUNCTION public.admin_maps_provider_health_reset_v1(
  p_provider_code text,
  p_capability text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_provider text := lower(btrim(p_provider_code));
  v_cap text := lower(btrim(p_capability));
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF NOT (SELECT public.is_admin()) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  IF v_provider NOT IN ('google','mapbox','here') THEN
    RAISE EXCEPTION 'invalid_provider_code';
  END IF;
  IF v_cap NOT IN ('render','directions','geocode','distance_matrix') THEN
    RAISE EXCEPTION 'invalid_capability';
  END IF;

  INSERT INTO public.maps_provider_health(provider_code, capability)
  VALUES (v_provider, v_cap)
  ON CONFLICT (provider_code, capability)
  DO UPDATE SET
    consecutive_failures = 0,
    disabled_until = NULL,
    updated_at = now();
END;
$$;
;
