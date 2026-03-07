-- Cache controls for maps provider responses.
--
-- Important (policy / best practice):
-- Many map provider terms distinguish between "temporary" and "permanent" results.
-- When using free tiers (temporary results), providers may prohibit caching/storing responses.
--
-- This migration introduces explicit cache settings per provider and defaults them to OFF.
-- The geo edge function will only perform persistent caching when cache_enabled=true.

ALTER TABLE IF EXISTS public.maps_providers
  ADD COLUMN IF NOT EXISTS cache_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cache_ttl_seconds integer NULL;

-- Default: keep caching OFF for all providers.
UPDATE public.maps_providers
SET cache_enabled = false,
    cache_ttl_seconds = NULL
WHERE cache_enabled IS DISTINCT FROM false OR cache_ttl_seconds IS NOT NULL;

-- Admin: list provider config (v2 includes cache columns).
CREATE OR REPLACE FUNCTION public.admin_maps_provider_list_v2()
RETURNS TABLE (
  provider_code text,
  priority integer,
  enabled boolean,
  language text,
  region text,
  monthly_soft_cap_units integer,
  monthly_hard_cap_units integer,
  cache_enabled boolean,
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
    mp.cache_enabled,
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

-- Admin: upsert provider config (v2 includes cache columns).
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
  v_cache_ttl integer := p_cache_ttl_seconds;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF NOT (SELECT public.is_admin()) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  IF v_code NOT IN ('google','mapbox','here') THEN
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
  END IF;

  INSERT INTO public.maps_providers(
    provider_code,
    priority,
    enabled,
    language,
    region,
    monthly_soft_cap_units,
    monthly_hard_cap_units,
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
    cache_enabled = EXCLUDED.cache_enabled,
    cache_ttl_seconds = EXCLUDED.cache_ttl_seconds,
    note = EXCLUDED.note,
    updated_at = now();
END;
$$;
;
