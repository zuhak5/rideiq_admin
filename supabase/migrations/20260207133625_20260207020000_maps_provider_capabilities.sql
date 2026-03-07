-- Provider capability matrix for multi-provider maps.
--
-- Why:
--  - Not every provider supports every capability.
--  - Provider selection must consider capability support to avoid selecting an unusable provider.
--  - Track unit semantics per provider/capability (map loads vs tile requests vs transactions).

CREATE TABLE IF NOT EXISTS public.maps_provider_capabilities (
  provider_code text NOT NULL REFERENCES public.maps_providers(provider_code) ON DELETE CASCADE,
  capability text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  unit_label text NOT NULL DEFAULT 'units',
  note text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider_code, capability),
  CONSTRAINT maps_provider_capability_chk CHECK (capability IN ('render','directions','geocode','distance_matrix'))
);

DROP TRIGGER IF EXISTS trg_maps_provider_capabilities_updated_at ON public.maps_provider_capabilities;
CREATE TRIGGER trg_maps_provider_capabilities_updated_at
BEFORE UPDATE ON public.maps_provider_capabilities
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

-- Seed capability defaults (idempotent).
-- Notes:
--  - "render" unit semantics differ per provider. We use a unit_label so Admin can interpret counts.
--  - "distance_matrix" is disabled by default for providers we don't implement yet.
INSERT INTO public.maps_provider_capabilities (provider_code, capability, enabled, unit_label, note)
VALUES
  -- Google: all enabled (server-side use requires separate keys per API; selection is capability-based).
  ('google', 'render', true, 'map_load_approx', 'Approx: 1 per map init (client-side)')
 ,('google', 'directions', true, 'request', 'Server-side request count')
 ,('google', 'geocode', true, 'request', 'Server-side request count')
 ,('google', 'distance_matrix', true, 'request', 'Server-side request count')

  -- Mapbox: render + web services (directions/geocoding). Matrix not enabled by default.
 ,('mapbox', 'render', true, 'map_load', '1 per Mapbox GL JS Map init (Mapbox definition)')
 ,('mapbox', 'directions', true, 'request', 'Server-side request count')
 ,('mapbox', 'geocode', true, 'request', 'Server-side request count')
 ,('mapbox', 'distance_matrix', false, 'request', 'Disabled until implemented')

  -- HERE: render + routing + geocoding. Matrix disabled until implemented.
 ,('here', 'render', true, 'session_or_tile', 'Depends on HERE product (tiles/sessions/transactions)')
 ,('here', 'directions', true, 'transaction', 'Server-side transaction count')
 ,('here', 'geocode', true, 'transaction', 'Server-side transaction count')
 ,('here', 'distance_matrix', false, 'transaction', 'Disabled until implemented')
ON CONFLICT (provider_code, capability)
DO UPDATE SET
  enabled = EXCLUDED.enabled,
  unit_label = EXCLUDED.unit_label,
  note = EXCLUDED.note,
  updated_at = now();

-- Pick the active provider based on order, provider enabled flag, capability enabled flag,
-- and hard-cap (month-to-date).
CREATE OR REPLACE FUNCTION public.maps_pick_provider_v2(
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

-- Admin: list capability settings (so UI can show what is actually selectable per capability).
CREATE OR REPLACE FUNCTION public.admin_maps_provider_capability_list_v1()
RETURNS TABLE (
  provider_code text,
  capability text,
  enabled boolean,
  unit_label text,
  note text,
  updated_at timestamptz
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
  SELECT mc.provider_code, mc.capability, mc.enabled, mc.unit_label, mc.note, mc.updated_at
  FROM public.maps_provider_capabilities mc
  ORDER BY mc.provider_code, mc.capability;
END;
$$;

-- Admin: upsert capability setting.
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

  IF v_provider NOT IN ('google','mapbox','here') THEN
    RAISE EXCEPTION 'invalid_provider_code';
  END IF;
  IF v_cap NOT IN ('render','directions','geocode','distance_matrix') THEN
    RAISE EXCEPTION 'invalid_capability';
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
;
