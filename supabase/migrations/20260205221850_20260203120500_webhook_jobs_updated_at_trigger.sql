-- 2026-02-03
-- Session 3 follow-up: ensure webhook_jobs.updated_at is maintained consistently
--
-- Rationale:
-- The webhook job queue relies on updates (status transitions, retries, locks).
-- Using the shared public.set_updated_at() trigger keeps updated_at accurate
-- without requiring every code path to remember to set it.

begin;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'webhook_jobs_set_updated_at'
  ) THEN
    CREATE TRIGGER webhook_jobs_set_updated_at
    BEFORE UPDATE ON public.webhook_jobs
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at();
  END IF;
END$$;

commit;
;
