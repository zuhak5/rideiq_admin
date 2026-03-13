-- Convert maps_providers.cache_backend from text+CHECK to a proper ENUM type.
-- Allowed values: off | redis | supabase
--
-- Notes:
-- - Keep existing RPC signatures stable (text params) for API compatibility.
-- - Internally cast validated text -> enum on writes.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
      AND t.typname = 'maps_cache_backend'
  ) THEN
    CREATE TYPE public.maps_cache_backend AS ENUM ('off','redis','supabase');
  END IF;
END $$;
-- Drop the legacy CHECK constraint (ENUM enforces it now).
ALTER TABLE IF EXISTS public.maps_providers
  DROP CONSTRAINT IF EXISTS maps_providers_cache_backend_chk;
-- Convert column type.
ALTER TABLE IF EXISTS public.maps_providers
  ALTER COLUMN cache_backend DROP DEFAULT;
ALTER TABLE IF EXISTS public.maps_providers
  ALTER COLUMN cache_backend TYPE public.maps_cache_backend
  USING (cache_backend::public.maps_cache_backend);
ALTER TABLE IF EXISTS public.maps_providers
  ALTER COLUMN cache_backend SET DEFAULT 'off'::public.maps_cache_backend;
-- Ensure legacy boolean stays consistent (defensive).
UPDATE public.maps_providers
SET cache_enabled = (cache_backend <> 'off'::public.maps_cache_backend)
WHERE cache_enabled IS DISTINCT FROM (cache_backend <> 'off'::public.maps_cache_backend);
-- Keep v2 set compatible: cast cache_backend to enum on write.
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
-- v3 set: same signature (text) but cast to enum on write.
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
