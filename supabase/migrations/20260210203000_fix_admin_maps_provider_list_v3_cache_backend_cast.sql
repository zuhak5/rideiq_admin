-- Fix admin_maps_provider_list_v3 after converting maps_providers.cache_backend to ENUM.
-- The RPC returns cache_backend as text for API stability.

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
    mp.cache_backend::text AS cache_backend,
    mp.cache_ttl_seconds,
    mp.note,
    COALESCE((SELECT SUM(units) FROM public.maps_usage_daily mu WHERE mu.provider_code=mp.provider_code AND mu.day>=v_month_start AND mu.capability='render'),0)::int AS mtd_render,
    COALESCE((SELECT SUM(units) FROM public.maps_usage_daily mu WHERE mu.provider_code=mp.provider_code AND mu.day>=v_month_start AND mu.capability='directions'),0)::int AS mtd_directions,
    COALESCE((SELECT SUM(units) FROM public.maps_usage_daily mu WHERE mu.provider_code=mp.provider_code AND mu.day>=v_month_start AND mu.capability='geocode'),0)::int AS mtd_geocode,
    COALESCE((SELECT SUM(units) FROM public.maps_usage_daily mu WHERE mu.provider_code=mp.provider_code AND mu.day>=v_month_start AND mu.capability='distance_matrix'),0)::int AS mtd_distance_matrix,
    mp.updated_at
  FROM public.maps_providers mp
  ORDER BY mp.priority DESC;
END;
$$;
