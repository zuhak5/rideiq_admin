-- Session 2: API rate limiting primitives (table + RPCs)
-- Purpose:
-- - Provide a small fixed-window counter for Edge Functions to throttle requests.
-- - Keep access restricted to service_role (Edge Functions) via RLS + grants.
--
-- Notes:
-- - The Edge function helper uses `public.rate_limit_consume(p_key, p_window_seconds, p_limit)`.
-- - This migration makes the RPC available in fresh environments (it existed in schema.sql but was not in migrations).

set lock_timeout = '5s';
set statement_timeout = '60s';

-- Table: public.api_rate_limits
CREATE TABLE IF NOT EXISTS public.api_rate_limits (
  key text NOT NULL,
  window_start timestamptz NOT NULL,
  window_seconds integer NOT NULL,
  count integer NOT NULL DEFAULT 0
);

-- Primary key (needed for ON CONFLICT in the consume function).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'api_rate_limits'
      AND c.conname = 'api_rate_limits_pkey'
  ) THEN
    ALTER TABLE ONLY public.api_rate_limits
      ADD CONSTRAINT api_rate_limits_pkey PRIMARY KEY (key, window_start, window_seconds);
  END IF;
END $$;

-- RLS: deny all to anon/authenticated; allow service_role (Edge Functions).
ALTER TABLE public.api_rate_limits ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'api_rate_limits'
      AND policyname = 'rls_deny_all'
  ) THEN
    CREATE POLICY rls_deny_all
      ON public.api_rate_limits
      FOR ALL
      TO authenticated, anon
      USING (false)
      WITH CHECK (false);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'api_rate_limits'
      AND policyname = 'rls_service_role_all'
  ) THEN
    CREATE POLICY rls_service_role_all
      ON public.api_rate_limits
      FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

REVOKE ALL ON TABLE public.api_rate_limits FROM PUBLIC;
REVOKE ALL ON TABLE public.api_rate_limits FROM anon;
REVOKE ALL ON TABLE public.api_rate_limits FROM authenticated;
GRANT ALL ON TABLE public.api_rate_limits TO service_role;

-- RPC: public.rate_limit_consume
CREATE OR REPLACE FUNCTION public.rate_limit_consume(
  p_key text,
  p_window_seconds integer,
  p_limit integer
) RETURNS TABLE(allowed boolean, remaining integer, reset_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog, public'
AS $$
DECLARE
  now_ts timestamptz := now();
  epoch bigint := floor(extract(epoch from now_ts));
  start_epoch bigint;
  win_start timestamptz;
  new_count integer;
BEGIN
  IF p_window_seconds <= 0 OR p_limit <= 0 THEN
    allowed := true;
    remaining := 0;
    reset_at := now_ts;
    RETURN NEXT;
    RETURN;
  END IF;

  start_epoch := (epoch / p_window_seconds) * p_window_seconds;
  win_start := to_timestamp(start_epoch);

  INSERT INTO public.api_rate_limits(key, window_start, window_seconds, count)
  VALUES (p_key, win_start, p_window_seconds, 1)
  ON CONFLICT (key, window_start, window_seconds)
  DO UPDATE SET count = public.api_rate_limits.count + 1
  RETURNING count INTO new_count;

  allowed := new_count <= p_limit;
  remaining := greatest(p_limit - new_count, 0);
  reset_at := win_start + make_interval(secs => p_window_seconds);
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.rate_limit_consume(text, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rate_limit_consume(text, integer, integer) FROM anon;
REVOKE ALL ON FUNCTION public.rate_limit_consume(text, integer, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.rate_limit_consume(text, integer, integer) TO service_role;

-- Housekeeping RPC: delete expired windows (run via cron/ops).
CREATE OR REPLACE FUNCTION public.rate_limit_prune(
  p_grace_seconds integer DEFAULT 300
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog, public'
AS $$
DECLARE
  grace integer := greatest(coalesce(p_grace_seconds, 300), 0);
  deleted_count integer := 0;
BEGIN
  DELETE FROM public.api_rate_limits
  WHERE (window_start + make_interval(secs => window_seconds)) < (now() - make_interval(secs => grace));

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

REVOKE ALL ON FUNCTION public.rate_limit_prune(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rate_limit_prune(integer) FROM anon;
REVOKE ALL ON FUNCTION public.rate_limit_prune(integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.rate_limit_prune(integer) TO service_role;
;
