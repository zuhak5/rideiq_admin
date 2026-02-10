-- Maps: soft-cap provider cutover + admin request stats + secure RPC privileges.
--
-- Session 7 goals:
-- 1) Proactively avoid providers as they approach free-tier limits using monthly_soft_cap_units.
-- 2) Improve observability: show request counts (1h/24h) per provider/capability in Admin.
-- 3) Apply deny-by-default EXECUTE privileges for service-only RPCs added after the P0 hardening migration.

-- Picker v4: like v3 but also excludes providers whose *month-to-date* usage for the capability
-- has reached the provider's monthly_soft_cap_units (or monthly_hard_cap_units).
CREATE OR REPLACE FUNCTION public.maps_pick_provider_v4(
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
  LEFT JOIN LATERAL (
    SELECT COALESCE(SUM(mu.units), 0) AS mtd_units
    FROM public.maps_usage_daily mu
    WHERE mu.provider_code = mp.provider_code
      AND mu.capability = p_capability
      AND mu.day >= v_month_start
  ) u ON true
  WHERE mp.enabled = true
    AND mp.provider_code <> ALL(COALESCE(p_exclude, '{}'::text[]))
    AND (mh.disabled_until IS NULL OR mh.disabled_until <= now())
    -- Soft cap: cut over before hard failures.
    AND (mp.monthly_soft_cap_units IS NULL OR u.mtd_units < mp.monthly_soft_cap_units)
    -- Hard cap: never exceed.
    AND (mp.monthly_hard_cap_units IS NULL OR u.mtd_units < mp.monthly_hard_cap_units)
  ORDER BY mp.priority DESC
  LIMIT 1;

  RETURN v_provider;
END;
$$;

-- Admin: request stats over recent windows (1h + 24h).
CREATE OR REPLACE FUNCTION public.admin_maps_requests_stats_v1()
RETURNS TABLE (
  provider_code text,
  capability text,
  requests_1h integer,
  requests_24h integer,
  billed_units_1h bigint,
  billed_units_24h bigint,
  cache_hits_1h integer,
  cache_hits_24h integer,
  errors_1h integer,
  errors_24h integer,
  rate_limited_1h integer,
  rate_limited_24h integer
)
LANGUAGE plpgsql SECURITY DEFINER
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
    mc.provider_code,
    mc.capability,
    COALESCE(COUNT(l.*) FILTER (WHERE l.created_at >= now() - interval '1 hour'), 0)::int AS requests_1h,
    COALESCE(COUNT(l.*), 0)::int AS requests_24h,
    COALESCE(SUM(l.billed_units) FILTER (WHERE l.created_at >= now() - interval '1 hour'), 0)::bigint AS billed_units_1h,
    COALESCE(SUM(l.billed_units), 0)::bigint AS billed_units_24h,
    COALESCE(COUNT(l.*) FILTER (WHERE l.created_at >= now() - interval '1 hour' AND l.cache_hit = true), 0)::int AS cache_hits_1h,
    COALESCE(COUNT(l.*) FILTER (WHERE l.cache_hit = true), 0)::int AS cache_hits_24h,
    COALESCE(COUNT(l.*) FILTER (WHERE l.created_at >= now() - interval '1 hour' AND l.http_status >= 400), 0)::int AS errors_1h,
    COALESCE(COUNT(l.*) FILTER (WHERE l.http_status >= 400), 0)::int AS errors_24h,
    COALESCE(COUNT(l.*) FILTER (WHERE l.created_at >= now() - interval '1 hour' AND l.http_status = 429), 0)::int AS rate_limited_1h,
    COALESCE(COUNT(l.*) FILTER (WHERE l.http_status = 429), 0)::int AS rate_limited_24h
  FROM public.maps_provider_capabilities mc
  JOIN public.maps_providers mp ON mp.provider_code = mc.provider_code
  LEFT JOIN public.maps_requests_log l
    ON l.provider_code = mc.provider_code
   AND l.capability = mc.capability
   AND l.created_at >= now() - interval '24 hours'
  GROUP BY mc.provider_code, mc.capability
  ORDER BY mc.provider_code, mc.capability;
END;
$$;

-- SECURITY: deny-by-default EXECUTE on service-only RPCs.
-- (Functions added after the P0 hardening migration would otherwise be executable by PUBLIC.)

-- Provider picker: service_role only.
REVOKE ALL ON FUNCTION public.maps_pick_provider_v1(text, text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.maps_pick_provider_v2(text, text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.maps_pick_provider_v3(text, text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.maps_pick_provider_v4(text, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.maps_pick_provider_v1(text, text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.maps_pick_provider_v2(text, text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.maps_pick_provider_v3(text, text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.maps_pick_provider_v4(text, text[]) TO service_role;

-- Usage + cache + health: service_role only.
REVOKE ALL ON FUNCTION public.maps_usage_increment_v1(text, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.maps_usage_increment_v1(text, text, integer) TO service_role;

REVOKE ALL ON FUNCTION public.geo_cache_get_v1(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.geo_cache_put_v1(text, text, text, jsonb, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.geo_cache_get_v1(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.geo_cache_put_v1(text, text, text, jsonb, integer) TO service_role;

REVOKE ALL ON FUNCTION public.maps_provider_health_on_failure_v1(text, text, integer, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.maps_provider_health_on_success_v1(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.maps_provider_health_on_failure_v1(text, text, integer, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.maps_provider_health_on_success_v1(text, text) TO service_role;

-- Admin stats: authenticated only (admins enforced in function body).
REVOKE ALL ON FUNCTION public.admin_maps_requests_stats_v1() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_maps_requests_stats_v1() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_maps_requests_stats_v1() TO service_role;
;
