-- Enhance maps request logs for better observability.
--
-- Adds:
-- - cache_hit: whether response came from DB cache
-- - attempt_number: which attempt this row corresponds to in fallback sequence
-- - fallback_reason: why this attempt failed and fell back (rate_limit/timeout/etc)

ALTER TABLE public.maps_requests_log
  ADD COLUMN IF NOT EXISTS cache_hit boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS attempt_number int NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS fallback_reason text NULL;

CREATE INDEX IF NOT EXISTS idx_maps_requests_log_cache_hit
  ON public.maps_requests_log (cache_hit, created_at DESC);

-- Admin: list recent provider calls (v2, includes new fields).
CREATE OR REPLACE FUNCTION public.admin_maps_requests_list_v2(
  p_limit int DEFAULT 200,
  p_provider_code text DEFAULT NULL,
  p_capability text DEFAULT NULL
) RETURNS TABLE (
  created_at timestamptz,
  request_id uuid,
  actor_user_id uuid,
  client_renderer text,
  action text,
  provider_code text,
  capability text,
  http_status int,
  latency_ms int,
  billed_units int,
  error_code text,
  error_detail text,
  tried_providers text[],
  cache_hit boolean,
  attempt_number int,
  fallback_reason text,
  request_summary jsonb,
  response_summary jsonb
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_limit int := greatest(1, least(coalesce(p_limit, 200), 1000));
  v_provider text := NULLIF(lower(btrim(p_provider_code)), '');
  v_cap text := NULLIF(lower(btrim(p_capability)), '');
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF NOT (SELECT public.is_admin()) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  RETURN QUERY
  SELECT
    l.created_at,
    l.request_id,
    l.actor_user_id,
    l.client_renderer,
    l.action,
    l.provider_code,
    l.capability,
    l.http_status,
    l.latency_ms,
    l.billed_units,
    l.error_code,
    l.error_detail,
    l.tried_providers,
    l.cache_hit,
    l.attempt_number,
    l.fallback_reason,
    l.request_summary,
    l.response_summary
  FROM public.maps_requests_log l
  WHERE (v_provider IS NULL OR l.provider_code = v_provider)
    AND (v_cap IS NULL OR l.capability = v_cap)
  ORDER BY l.created_at DESC
  LIMIT v_limit;
END;
$$;
;
