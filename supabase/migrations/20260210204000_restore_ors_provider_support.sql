-- Restore OpenRouteService (ORS) support in the maps control plane.
--
-- Why:
-- - Edge Functions and docs include ORS as a server-side fallback provider.
-- - Some later migrations replaced baseline functions and validations without including ORS,
--   and ORS was not seeded into maps_providers/capabilities.

-- Seed ORS provider row (idempotent).
INSERT INTO public.maps_providers (
  provider_code,
  priority,
  enabled,
  language,
  region,
  monthly_soft_cap_units,
  monthly_hard_cap_units,
  note,
  cache_backend,
  cache_enabled,
  cache_ttl_seconds
)
VALUES (
  'ors',
  75, -- between HERE (80) and Thunderforest (70)
  true,
  'ar',
  'IQ',
  NULL,
  NULL,
  'OpenRouteService (server-side directions/geocode/matrix fallback)',
  'off'::public.maps_cache_backend,
  false,
  NULL
)
ON CONFLICT (provider_code) DO NOTHING;
-- Seed ORS capabilities (render disabled; server-side capabilities enabled).
INSERT INTO public.maps_provider_capabilities (provider_code, capability, enabled, unit_label, note)
VALUES
  ('ors', 'render', false, 'n/a', 'Not supported (server-side only)'),
  ('ors', 'directions', true, 'request', 'Server-side request count'),
  ('ors', 'geocode', true, 'request', 'Server-side request count'),
  ('ors', 'distance_matrix', true, 'request', 'Server-side request count')
ON CONFLICT (provider_code, capability) DO NOTHING;
-- Admin: upsert provider config (v1) - include ORS.
CREATE OR REPLACE FUNCTION public.admin_maps_provider_set_v1(
  p_provider_code text,
  p_priority integer,
  p_enabled boolean,
  p_language text,
  p_region text,
  p_monthly_soft_cap_units integer,
  p_monthly_hard_cap_units integer,
  p_note text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_code text := lower(btrim(p_provider_code));
  v_priority integer := COALESCE(p_priority, 0);
  v_enabled boolean := COALESCE(p_enabled, true);
  v_lang text := COALESCE(nullif(btrim(p_language), ''), 'ar');
  v_region text := COALESCE(nullif(btrim(p_region), ''), 'IQ');
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF NOT (SELECT public.is_admin()) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  IF v_code NOT IN ('google','mapbox','here','thunderforest','ors') THEN
    RAISE EXCEPTION 'invalid_provider_code';
  END IF;

  IF v_priority < 0 OR v_priority > 1000 THEN
    RAISE EXCEPTION 'invalid_priority';
  END IF;

  IF p_monthly_soft_cap_units IS NOT NULL AND p_monthly_soft_cap_units < 0 THEN
    RAISE EXCEPTION 'invalid_soft_cap';
  END IF;
  IF p_monthly_hard_cap_units IS NOT NULL AND p_monthly_hard_cap_units < 0 THEN
    RAISE EXCEPTION 'invalid_hard_cap';
  END IF;

  INSERT INTO public.maps_providers(
    provider_code,
    priority,
    enabled,
    language,
    region,
    monthly_soft_cap_units,
    monthly_hard_cap_units,
    note
  )
  VALUES (
    v_code,
    v_priority,
    v_enabled,
    v_lang,
    v_region,
    p_monthly_soft_cap_units,
    p_monthly_hard_cap_units,
    p_note
  )
  ON CONFLICT (provider_code)
  DO UPDATE SET
    priority = EXCLUDED.priority,
    enabled = EXCLUDED.enabled,
    language = EXCLUDED.language,
    region = EXCLUDED.region,
    monthly_soft_cap_units = EXCLUDED.monthly_soft_cap_units,
    monthly_hard_cap_units = EXCLUDED.monthly_hard_cap_units,
    note = EXCLUDED.note,
    updated_at = now();
END;
$$;
-- v2 set compatible: include ORS.
CREATE OR REPLACE FUNCTION public.admin_maps_provider_set_v2(
  p_provider_code text,
  p_priority integer,
  p_enabled boolean,
  p_language text,
  p_region text,
  p_monthly_soft_cap_units integer,
  p_monthly_hard_cap_units integer,
  p_cache_enabled boolean DEFAULT false,
  p_cache_ttl_seconds integer DEFAULT NULL,
  p_note text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_code text := lower(btrim(p_provider_code));
  v_priority integer := COALESCE(p_priority, 0);
  v_enabled boolean := COALESCE(p_enabled, true);
  v_lang text := COALESCE(nullif(btrim(p_language), ''), 'ar');
  v_region text := COALESCE(nullif(btrim(p_region), ''), 'IQ');
  v_cache_enabled boolean := COALESCE(p_cache_enabled, false);
  v_cache_backend text := CASE WHEN v_cache_enabled THEN 'redis' ELSE 'off' END;
  v_cache_ttl integer := p_cache_ttl_seconds;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF NOT (SELECT public.is_admin()) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  IF v_code NOT IN ('google','mapbox','here','thunderforest','ors') THEN
    RAISE EXCEPTION 'invalid_provider_code';
  END IF;

  IF v_priority < 0 OR v_priority > 1000 THEN
    RAISE EXCEPTION 'invalid_priority';
  END IF;

  IF p_monthly_soft_cap_units IS NOT NULL AND p_monthly_soft_cap_units < 0 THEN
    RAISE EXCEPTION 'invalid_soft_cap';
  END IF;
  IF p_monthly_hard_cap_units IS NOT NULL AND p_monthly_hard_cap_units < 0 THEN
    RAISE EXCEPTION 'invalid_hard_cap';
  END IF;

  IF v_cache_ttl IS NOT NULL AND v_cache_ttl <= 0 THEN
    -- Treat non-positive TTL as "disable".
    v_cache_ttl := NULL;
    v_cache_enabled := false;
    v_cache_backend := 'off';
  END IF;

  INSERT INTO public.maps_providers(
    provider_code,
    priority,
    enabled,
    language,
    region,
    monthly_soft_cap_units,
    monthly_hard_cap_units,
    cache_backend,
    cache_enabled,
    cache_ttl_seconds,
    note
  )
  VALUES (
    v_code,
    v_priority,
    v_enabled,
    v_lang,
    v_region,
    p_monthly_soft_cap_units,
    p_monthly_hard_cap_units,
    v_cache_backend::public.maps_cache_backend,
    v_cache_enabled,
    v_cache_ttl,
    p_note
  )
  ON CONFLICT (provider_code)
  DO UPDATE SET
    priority = EXCLUDED.priority,
    enabled = EXCLUDED.enabled,
    language = EXCLUDED.language,
    region = EXCLUDED.region,
    monthly_soft_cap_units = EXCLUDED.monthly_soft_cap_units,
    monthly_hard_cap_units = EXCLUDED.monthly_hard_cap_units,
    cache_backend = EXCLUDED.cache_backend,
    cache_enabled = EXCLUDED.cache_enabled,
    cache_ttl_seconds = EXCLUDED.cache_ttl_seconds,
    note = EXCLUDED.note,
    updated_at = now();
END;
$$;
-- v3 set: include ORS.
CREATE OR REPLACE FUNCTION public.admin_maps_provider_set_v3(
  p_provider_code text,
  p_priority integer,
  p_enabled boolean,
  p_language text,
  p_region text,
  p_monthly_soft_cap_units integer,
  p_monthly_hard_cap_units integer,
  p_cache_backend text DEFAULT 'off',
  p_cache_ttl_seconds integer DEFAULT NULL,
  p_note text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_code text := lower(btrim(p_provider_code));
  v_priority integer := COALESCE(p_priority, 0);
  v_enabled boolean := COALESCE(p_enabled, true);
  v_lang text := COALESCE(nullif(btrim(p_language), ''), 'ar');
  v_region text := COALESCE(nullif(btrim(p_region), ''), 'IQ');
  v_cache_backend text := COALESCE(nullif(lower(btrim(p_cache_backend)), ''), 'off');
  v_cache_enabled boolean := (v_cache_backend <> 'off');
  v_cache_ttl integer := p_cache_ttl_seconds;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF NOT (SELECT public.is_admin()) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  IF v_code NOT IN ('google','mapbox','here','thunderforest','ors') THEN
    RAISE EXCEPTION 'invalid_provider_code';
  END IF;

  IF v_priority < 0 OR v_priority > 1000 THEN
    RAISE EXCEPTION 'invalid_priority';
  END IF;

  IF p_monthly_soft_cap_units IS NOT NULL AND p_monthly_soft_cap_units < 0 THEN
    RAISE EXCEPTION 'invalid_soft_cap';
  END IF;
  IF p_monthly_hard_cap_units IS NOT NULL AND p_monthly_hard_cap_units < 0 THEN
    RAISE EXCEPTION 'invalid_hard_cap';
  END IF;

  IF v_cache_backend NOT IN ('off','redis','supabase') THEN
    RAISE EXCEPTION 'invalid_cache_backend';
  END IF;

  IF v_cache_ttl IS NOT NULL AND v_cache_ttl <= 0 THEN
    v_cache_ttl := NULL;
  END IF;

  IF v_cache_backend = 'off' THEN
    v_cache_enabled := false;
    v_cache_ttl := NULL;
  END IF;

  INSERT INTO public.maps_providers(
    provider_code,
    priority,
    enabled,
    language,
    region,
    monthly_soft_cap_units,
    monthly_hard_cap_units,
    cache_backend,
    cache_enabled,
    cache_ttl_seconds,
    note
  )
  VALUES (
    v_code,
    v_priority,
    v_enabled,
    v_lang,
    v_region,
    p_monthly_soft_cap_units,
    p_monthly_hard_cap_units,
    v_cache_backend::public.maps_cache_backend,
    v_cache_enabled,
    v_cache_ttl,
    p_note
  )
  ON CONFLICT (provider_code)
  DO UPDATE SET
    priority = EXCLUDED.priority,
    enabled = EXCLUDED.enabled,
    language = EXCLUDED.language,
    region = EXCLUDED.region,
    monthly_soft_cap_units = EXCLUDED.monthly_soft_cap_units,
    monthly_hard_cap_units = EXCLUDED.monthly_hard_cap_units,
    cache_backend = EXCLUDED.cache_backend,
    cache_enabled = EXCLUDED.cache_enabled,
    cache_ttl_seconds = EXCLUDED.cache_ttl_seconds,
    note = EXCLUDED.note,
    updated_at = now();
END;
$$;
-- Capabilities admin setter: include ORS and prevent ORS-as-renderer misconfiguration.
CREATE OR REPLACE FUNCTION public.admin_maps_provider_capability_set_v1(
  p_provider_code text,
  p_capability text,
  p_enabled boolean,
  p_unit_label text,
  p_note text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_provider text := lower(btrim(p_provider_code));
  v_cap text := lower(btrim(p_capability));
  v_enabled boolean := COALESCE(p_enabled, true);
  v_label text := COALESCE(nullif(btrim(p_unit_label), ''), 'units');
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF NOT (SELECT public.is_admin()) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  IF v_provider NOT IN ('google','mapbox','here','thunderforest','ors') THEN
    RAISE EXCEPTION 'invalid_provider_code';
  END IF;
  IF v_cap NOT IN ('render','directions','geocode','distance_matrix') THEN
    RAISE EXCEPTION 'invalid_capability';
  END IF;

  -- ORS is server-side only; never allow it to be enabled for rendering.
  IF v_provider = 'ors' AND v_cap = 'render' AND v_enabled IS TRUE THEN
    RAISE EXCEPTION 'invalid_provider_capability';
  END IF;

  INSERT INTO public.maps_provider_capabilities(provider_code, capability, enabled, unit_label, note)
  VALUES (v_provider, v_cap, v_enabled, v_label, p_note)
  ON CONFLICT (provider_code, capability)
  DO UPDATE SET
    enabled = EXCLUDED.enabled,
    unit_label = EXCLUDED.unit_label,
    note = EXCLUDED.note,
    updated_at = now();
END;
$$;
-- Cache helper: accept ORS provider code.
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
  IF v_provider NOT IN ('google','mapbox','here','thunderforest','ors') THEN
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
-- Provider health: accept ORS so circuit breaker works for ORS calls.
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
  IF v_provider NOT IN ('google','mapbox','here','thunderforest','ors') THEN
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
  IF v_provider NOT IN ('google','mapbox','here','thunderforest','ors') THEN
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

  IF v_provider NOT IN ('google','mapbox','here','thunderforest','ors') THEN
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
