-- 2026-02-03
-- Fix: webhook_claim_jobs SECURITY DEFINER guard
--
-- In a SECURITY DEFINER function, current_user becomes the function owner (typically postgres),
-- so checking current_user = 'service_role' will always fail.
--
-- Access control is already enforced by EXECUTE privilege (granted only to service_role)
-- and RLS policies on webhook_jobs/webhook_job_attempts.
--
-- This migration removes the incorrect guard.

begin;

CREATE OR REPLACE FUNCTION public.webhook_claim_jobs(p_limit integer DEFAULT 10, p_lock_seconds integer DEFAULT 300)
RETURNS SETOF public.webhook_jobs
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog, public'
AS $$
BEGIN
  RETURN QUERY
  WITH c AS (
    SELECT id
    FROM public.webhook_jobs
    WHERE status IN ('queued', 'failed')
      AND next_attempt_at <= now()
      AND attempt_count < max_attempts
      AND (locked_at IS NULL OR locked_at < now() - (p_lock_seconds || ' seconds')::interval)
    ORDER BY next_attempt_at ASC, created_at ASC
    LIMIT greatest(p_limit, 1)
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.webhook_jobs j
  SET locked_at = now(),
      lock_token = gen_random_uuid(),
      updated_at = now()
  FROM c
  WHERE j.id = c.id
  RETURNING j.*;
END;
$$;

ALTER FUNCTION public.webhook_claim_jobs(p_limit integer, p_lock_seconds integer) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.webhook_claim_jobs(p_limit integer, p_lock_seconds integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.webhook_claim_jobs(p_limit integer, p_lock_seconds integer) TO service_role;

commit;
;
