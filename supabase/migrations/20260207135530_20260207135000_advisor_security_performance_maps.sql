-- Advisor fixes for maps security/performance.
-- - Security: enable RLS for public maps tables and add explicit service_role policies.
-- - Performance: add missing FK covering index for maps_usage_daily.provider_code.

BEGIN;

-- Security: these are internal control-plane tables and should always be RLS-protected.
ALTER TABLE public.maps_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.maps_usage_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.maps_provider_capabilities ENABLE ROW LEVEL SECURITY;

-- Explicit policies prevent advisor warnings while preserving intended access:
-- Edge Functions use service_role; app users go through SECURITY DEFINER RPCs.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'maps_providers' AND policyname = 'maps_providers_service_role_all_v1'
  ) THEN
    CREATE POLICY maps_providers_service_role_all_v1
      ON public.maps_providers
      FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'maps_usage_daily' AND policyname = 'maps_usage_daily_service_role_all_v1'
  ) THEN
    CREATE POLICY maps_usage_daily_service_role_all_v1
      ON public.maps_usage_daily
      FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'maps_provider_capabilities' AND policyname = 'maps_provider_capabilities_service_role_all_v1'
  ) THEN
    CREATE POLICY maps_provider_capabilities_service_role_all_v1
      ON public.maps_provider_capabilities
      FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'geo_cache' AND policyname = 'geo_cache_service_role_all_v1'
  ) THEN
    CREATE POLICY geo_cache_service_role_all_v1
      ON public.geo_cache
      FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'maps_provider_health' AND policyname = 'maps_provider_health_service_role_all_v1'
  ) THEN
    CREATE POLICY maps_provider_health_service_role_all_v1
      ON public.maps_provider_health
      FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'maps_requests_log' AND policyname = 'maps_requests_log_service_role_all_v1'
  ) THEN
    CREATE POLICY maps_requests_log_service_role_all_v1
      ON public.maps_requests_log
      FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

-- Performance: FK lookups on provider delete/update need leading provider_code index.
CREATE INDEX IF NOT EXISTS idx_maps_usage_daily_provider_code
  ON public.maps_usage_daily (provider_code);

COMMIT;
;
