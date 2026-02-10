-- Session 8: Latency/SLO aggregation helpers (p50/p95/p99) over app_events

CREATE OR REPLACE FUNCTION public.ops_metric_latency_summary_v1(
  p_since timestamptz,
  p_limit integer DEFAULT 50
)
RETURNS TABLE (
  component text,
  event_type text,
  total bigint,
  errors bigint,
  p50_ms numeric,
  p95_ms numeric,
  p99_ms numeric,
  avg_ms numeric,
  max_ms numeric
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH base AS (
    SELECT
      COALESCE((payload ->> 'component'), 'unknown') AS component,
      event_type,
      NULLIF(payload ->> 'duration_ms', '')::numeric AS duration_ms,
      COALESCE(payload ->> 'outcome', 'ok') AS outcome
    FROM public.app_events
    WHERE created_at >= p_since
      AND event_type LIKE 'metric.%_latency'
      AND (payload ? 'duration_ms')
  ),
  filtered AS (
    SELECT *
    FROM base
    WHERE duration_ms IS NOT NULL
      AND duration_ms >= 0
  )
  SELECT
    component,
    event_type,
    COUNT(*)::bigint AS total,
    SUM(CASE WHEN outcome = 'error' THEN 1 ELSE 0 END)::bigint AS errors,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_ms) AS p50_ms,
    percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95_ms,
    percentile_cont(0.99) WITHIN GROUP (ORDER BY duration_ms) AS p99_ms,
    AVG(duration_ms) AS avg_ms,
    MAX(duration_ms) AS max_ms
  FROM filtered
  GROUP BY component, event_type
  ORDER BY total DESC
  LIMIT GREATEST(1, LEAST(p_limit, 200));
$$;

ALTER FUNCTION public.ops_metric_latency_summary_v1(timestamptz, integer) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.ops_metric_latency_summary_v1(timestamptz, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ops_metric_latency_summary_v1(timestamptz, integer) TO service_role;
