-- Maps provider cache backend selection:
--  - off (no persistent cache)
--  - redis (Redis JSON cache; Postgres geo_cache_* as fallback if Redis unavailable)
--  - supabase (Postgres geo_cache_* only)
--
-- This is additive and keeps the legacy cache_enabled boolean for backward compatibility.

ALTER TABLE IF EXISTS public.maps_providers
  ADD COLUMN IF NOT EXISTS cache_backend text NOT NULL DEFAULT 'off';
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'maps_providers_cache_backend_chk'
      AND conrelid = 'public.maps_providers'::regclass
  ) THEN
    ALTER TABLE public.maps_providers
      ADD CONSTRAINT maps_providers_cache_backend_chk
      CHECK (cache_backend IN ('off','redis','supabase'));
  END IF;
END $$;
-- Backfill: existing cache_enabled=true becomes cache_backend='redis' (best practice default).
UPDATE public.maps_providers
SET cache_backend = 'redis'
WHERE cache_enabled IS TRUE
  AND cache_backend = 'off';
-- Keep legacy boolean broadly consistent with backend.
UPDATE public.maps_providers
SET cache_enabled = (cache_backend <> 'off')
WHERE cache_enabled IS DISTINCT FROM (cache_backend <> 'off');
-- v2 list stays stable; it continues to return a boolean cache_enabled.
-- v2 set maps cache_enabled=true to cache_backend='redis'.
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

  IF v_code NOT IN ('google','mapbox','here','thunderforest') THEN
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
    v_cache_backend,
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
-- v3 list/set include cache_backend explicitly.
CREATE OR REPLACE FUNCTION public.admin_maps_provider_list_v3()
RETURNS TABLE (
  provider_code text,
  priority integer,
  enabled boolean,
  language text,
  region text,
  monthly_soft_cap_units integer,
  monthly_hard_cap_units integer,
  cache_backend text,
  cache_ttl_seconds integer,
  note text,
  mtd_render integer,
  mtd_directions integer,
  mtd_geocode integer,
  mtd_distance_matrix integer,
  updated_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_month_start date := date_trunc('month', (now() AT TIME ZONE 'UTC'))::date;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF NOT (SELECT public.is_admin()) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  RETURN QUERY
  SELECT
    mp.provider_code,
    mp.priority,
    mp.enabled,
    mp.language,
    mp.region,
    mp.monthly_soft_cap_units,
    mp.monthly_hard_cap_units,
    mp.cache_backend,
    mp.cache_ttl_seconds,
    mp.note,
    COALESCE((SELECT SUM(units) FROM public.maps_usage_daily mu WHERE mu.provider_code=mp.provider_code AND mu.day>=v_month_start AND mu.capability='render'),0) AS mtd_render,
    COALESCE((SELECT SUM(units) FROM public.maps_usage_daily mu WHERE mu.provider_code=mp.provider_code AND mu.day>=v_month_start AND mu.capability='directions'),0) AS mtd_directions,
    COALESCE((SELECT SUM(units) FROM public.maps_usage_daily mu WHERE mu.provider_code=mp.provider_code AND mu.day>=v_month_start AND mu.capability='geocode'),0) AS mtd_geocode,
    COALESCE((SELECT SUM(units) FROM public.maps_usage_daily mu WHERE mu.provider_code=mp.provider_code AND mu.day>=v_month_start AND mu.capability='distance_matrix'),0) AS mtd_distance_matrix,
    mp.updated_at
  FROM public.maps_providers mp
  ORDER BY mp.priority DESC;
END;
$$;
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

  IF v_code NOT IN ('google','mapbox','here','thunderforest') THEN
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
    v_cache_backend,
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
