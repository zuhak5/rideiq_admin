-- Enforce consistent cache invariants for maps providers.
--
-- Invariant:
-- - cache_backend = off      -> cache_enabled=false AND cache_ttl_seconds IS NULL
-- - cache_backend != off     -> cache_enabled=true  AND cache_ttl_seconds BETWEEN 60 AND 604800 (required)
--
-- Why:
-- Previously the DB/UI could represent "cache backend enabled" with a NULL TTL, but the geo
-- edge function only caches when TTL > 0. That state is ambiguous and leads to "doesn't make sense"
-- behavior (backend says on, runtime acts off).

-- 1) Normalize existing rows (defensive backfill).
UPDATE public.maps_providers
SET cache_ttl_seconds = NULL
WHERE cache_backend = 'off'::public.maps_cache_backend
  AND cache_ttl_seconds IS NOT NULL;
UPDATE public.maps_providers
SET cache_ttl_seconds = 300
WHERE cache_backend <> 'off'::public.maps_cache_backend
  AND (cache_ttl_seconds IS NULL OR cache_ttl_seconds <= 0);
UPDATE public.maps_providers
SET cache_ttl_seconds = 60
WHERE cache_backend <> 'off'::public.maps_cache_backend
  AND cache_ttl_seconds < 60;
UPDATE public.maps_providers
SET cache_ttl_seconds = 604800
WHERE cache_backend <> 'off'::public.maps_cache_backend
  AND cache_ttl_seconds > 604800;
UPDATE public.maps_providers
SET cache_enabled = (cache_backend <> 'off'::public.maps_cache_backend)
WHERE cache_enabled IS DISTINCT FROM (cache_backend <> 'off'::public.maps_cache_backend);
-- 2) Add a CHECK constraint so the invariant can't drift via direct writes.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'maps_providers_cache_backend_ttl_chk'
      AND conrelid = 'public.maps_providers'::regclass
  ) THEN
    ALTER TABLE public.maps_providers
      ADD CONSTRAINT maps_providers_cache_backend_ttl_chk
      CHECK (
        (cache_backend = 'off'::public.maps_cache_backend AND cache_enabled = false AND cache_ttl_seconds IS NULL)
        OR (cache_backend <> 'off'::public.maps_cache_backend AND cache_enabled = true AND cache_ttl_seconds BETWEEN 60 AND 604800)
      ) NOT VALID;
  END IF;
END $$;
ALTER TABLE public.maps_providers
  VALIDATE CONSTRAINT maps_providers_cache_backend_ttl_chk;
-- 3) Enforce the same rules at the RPC level (friendly errors).

-- v2 set compatible: TTL is required when cache_enabled=true.
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

  IF v_cache_enabled IS TRUE THEN
    IF v_cache_ttl IS NULL THEN
      RAISE EXCEPTION 'cache_ttl_required' USING ERRCODE = '22023';
    END IF;
    IF v_cache_ttl < 60 OR v_cache_ttl > 604800 THEN
      RAISE EXCEPTION 'invalid_cache_ttl' USING ERRCODE = '22023';
    END IF;
  ELSE
    v_cache_backend := 'off';
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
-- v3 set: TTL is required when cache_backend != off.
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

  IF v_cache_backend = 'off' THEN
    v_cache_enabled := false;
    v_cache_ttl := NULL;
  ELSE
    v_cache_enabled := true;
    IF v_cache_ttl IS NULL THEN
      RAISE EXCEPTION 'cache_ttl_required' USING ERRCODE = '22023';
    END IF;
    IF v_cache_ttl < 60 OR v_cache_ttl > 604800 THEN
      RAISE EXCEPTION 'invalid_cache_ttl' USING ERRCODE = '22023';
    END IF;
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
