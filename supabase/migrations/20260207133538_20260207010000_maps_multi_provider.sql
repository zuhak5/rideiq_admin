-- Multi-provider maps control plane (Google â†’ Mapbox â†’ HERE â†’ Thunderforest).
-- Adds:
--  - maps_providers: admin-configurable provider order, locale, caps
--  - maps_usage_daily: internal counters (approx) to automate fallback when caps are hit
--  - admin RPCs for managing providers & viewing usage

CREATE TABLE IF NOT EXISTS public.maps_providers (
  provider_code text PRIMARY KEY,
  priority integer NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  language text NOT NULL DEFAULT 'ar',
  region text NOT NULL DEFAULT 'IQ',
  monthly_soft_cap_units integer NULL,
  monthly_hard_cap_units integer NULL,
  note text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT maps_providers_provider_code_chk CHECK (provider_code IN ('google','mapbox','here','thunderforest'))
);

CREATE TABLE IF NOT EXISTS public.maps_usage_daily (
  day date NOT NULL,
  provider_code text NOT NULL REFERENCES public.maps_providers(provider_code) ON DELETE CASCADE,
  capability text NOT NULL,
  units integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (day, provider_code, capability),
  CONSTRAINT maps_usage_capability_chk CHECK (capability IN ('render','directions','geocode','distance_matrix'))
);

-- Simple updated_at trigger helper (if not already present).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname='public' AND p.proname='set_updated_at'
  ) THEN
    CREATE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $fn$
    BEGIN
      NEW.updated_at = now();
      RETURN NEW;
    END;
    $fn$;
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_maps_providers_updated_at ON public.maps_providers;
CREATE TRIGGER trg_maps_providers_updated_at
BEFORE UPDATE ON public.maps_providers
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_maps_usage_daily_updated_at ON public.maps_usage_daily;
CREATE TRIGGER trg_maps_usage_daily_updated_at
BEFORE UPDATE ON public.maps_usage_daily
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

-- Seed provider order (idempotent).
INSERT INTO public.maps_providers (provider_code, priority, enabled, language, region, monthly_soft_cap_units, monthly_hard_cap_units, note)
VALUES
  ('google', 100, true, 'ar', 'IQ', 15000, 20000, 'Primary provider (Dynamic Maps map loads approximation)'),
  ('mapbox',  90, true, 'ar', 'IQ', 45000, 50000, 'Fallback (Mapbox map loads: 50k free tier)'),
  ('here',    80, true, 'ar', 'IQ', 25000, 30000, 'Fallback (transactions; set per plan)'),
  ('thunderforest', 70, true, 'ar', 'IQ', 140000, 150000, 'Fallback (tile requests; approx)')
ON CONFLICT (provider_code) DO UPDATE
SET priority = EXCLUDED.priority,
    enabled = EXCLUDED.enabled,
    language = EXCLUDED.language,
    region = EXCLUDED.region,
    monthly_soft_cap_units = EXCLUDED.monthly_soft_cap_units,
    monthly_hard_cap_units = EXCLUDED.monthly_hard_cap_units,
    note = EXCLUDED.note;

-- Increment usage (called from Edge Functions).
CREATE OR REPLACE FUNCTION public.maps_usage_increment_v1(
  p_provider_code text,
  p_capability text,
  p_units integer DEFAULT 1
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  v_units integer := COALESCE(p_units, 1);
  v_day date := (now() AT TIME ZONE 'UTC')::date;
BEGIN
  IF v_units <= 0 THEN
    RAISE EXCEPTION 'invalid_units';
  END IF;

  -- Validate provider & capability.
  IF NOT EXISTS (SELECT 1 FROM public.maps_providers WHERE provider_code = p_provider_code) THEN
    RAISE EXCEPTION 'unknown_provider';
  END IF;
  IF p_capability NOT IN ('render','directions','geocode','distance_matrix') THEN
    RAISE EXCEPTION 'unknown_capability';
  END IF;

  INSERT INTO public.maps_usage_daily(day, provider_code, capability, units)
  VALUES (v_day, p_provider_code, p_capability, v_units)
  ON CONFLICT (day, provider_code, capability)
  DO UPDATE SET units = public.maps_usage_daily.units + EXCLUDED.units,
                updated_at = now();
END;
$$;

-- Pick the active provider based on order, enabled flag, and hard-cap (month-to-date).
CREATE OR REPLACE FUNCTION public.maps_pick_provider_v1(
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
  WHERE mp.enabled = true
    AND mp.provider_code <> ALL(COALESCE(p_exclude, '{}'::text[]))
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

-- Admin: list provider configs with month-to-date usage by capability.
CREATE OR REPLACE FUNCTION public.admin_maps_provider_list_v1()
RETURNS TABLE (
  provider_code text,
  priority integer,
  enabled boolean,
  language text,
  region text,
  monthly_soft_cap_units integer,
  monthly_hard_cap_units integer,
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

-- Admin: upsert provider config.
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

  INSERT INTO public.maps_providers(provider_code, priority, enabled, language, region, monthly_soft_cap_units, monthly_hard_cap_units, note)
  VALUES (v_code, v_priority, v_enabled, v_lang, v_region, p_monthly_soft_cap_units, p_monthly_hard_cap_units, p_note)
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
;
