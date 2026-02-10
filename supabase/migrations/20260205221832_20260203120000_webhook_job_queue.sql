-- 2026-02-03
-- Webhook job queue for async processing + replay protection (idempotent inbox)
--
-- Pattern:
-- - Webhook endpoints verify integrity (HMAC/JWT/SecureHash) then insert into public.provider_events
--   (already has unique index on (provider_code, provider_event_id)) for replay/dedupe.
-- - They then enqueue a job in public.webhook_jobs keyed by dedupe_key.
-- - A cron-protected Edge Function claims jobs using FOR UPDATE SKIP LOCKED.

begin;

-- 1) Status enum
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'webhook_job_status' AND n.nspname = 'public'
  ) THEN
    CREATE TYPE public.webhook_job_status AS ENUM ('queued', 'failed', 'succeeded', 'dead');
  END IF;
END$$;

-- 2) Job table
CREATE TABLE IF NOT EXISTS public.webhook_jobs (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  provider_code text NOT NULL,
  provider_event_id text NOT NULL,
  provider_event_pk bigint,
  job_kind text NOT NULL, -- e.g. 'topup_webhook', 'withdraw_webhook'
  correlation_id uuid,   -- optional: topup_intents.id or wallet_withdraw_requests.id

  status public.webhook_job_status DEFAULT 'queued'::public.webhook_job_status NOT NULL,
  last_error text,

  attempt_count integer DEFAULT 0 NOT NULL,
  max_attempts integer DEFAULT 10 NOT NULL,
  next_attempt_at timestamp with time zone DEFAULT now() NOT NULL,
  last_attempt_at timestamp with time zone,

  locked_at timestamp with time zone,
  lock_token uuid,

  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,

  dedupe_key text NOT NULL,

  CONSTRAINT webhook_jobs_pkey PRIMARY KEY (id),
  CONSTRAINT webhook_jobs_attempt_count_check CHECK (attempt_count >= 0),
  CONSTRAINT webhook_jobs_max_attempts_check CHECK (max_attempts > 0)
);

-- Optional FK (best-effort) to provider_events
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_schema = 'public'
      AND table_name = 'webhook_jobs'
      AND constraint_name = 'webhook_jobs_provider_event_pk_fkey'
  ) THEN
    ALTER TABLE public.webhook_jobs
      ADD CONSTRAINT webhook_jobs_provider_event_pk_fkey
      FOREIGN KEY (provider_event_pk) REFERENCES public.provider_events(id)
      ON DELETE SET NULL;
  END IF;
END$$;

-- Deduping and hot-path indexes
CREATE UNIQUE INDEX IF NOT EXISTS webhook_jobs_dedupe_key_key ON public.webhook_jobs (dedupe_key);
CREATE INDEX IF NOT EXISTS webhook_jobs_status_next_attempt_idx ON public.webhook_jobs (status, next_attempt_at);
CREATE INDEX IF NOT EXISTS webhook_jobs_provider_event_idx ON public.webhook_jobs (provider_code, provider_event_id);

-- 3) Attempts table (for debugging/ops)
CREATE TABLE IF NOT EXISTS public.webhook_job_attempts (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  job_id uuid NOT NULL,
  attempt_no integer NOT NULL,
  status text NOT NULL, -- 'succeeded' | 'failed'
  error_message text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT webhook_job_attempts_pkey PRIMARY KEY (id),
  CONSTRAINT webhook_job_attempts_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.webhook_jobs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS webhook_job_attempts_job_id_idx ON public.webhook_job_attempts (job_id, attempt_no);

-- 4) Claim function (service_role only)
CREATE OR REPLACE FUNCTION public.webhook_claim_jobs(p_limit integer DEFAULT 10, p_lock_seconds integer DEFAULT 300)
RETURNS SETOF public.webhook_jobs
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog, public'
AS $$
BEGIN
  IF current_user <> 'service_role' THEN
    RAISE EXCEPTION 'not_allowed';
  END IF;

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

-- 5) RLS (belt-and-suspenders)
ALTER TABLE public.webhook_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_job_attempts ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='webhook_jobs' AND policyname='rls_service_role_all'
  ) THEN
    CREATE POLICY rls_service_role_all ON public.webhook_jobs TO service_role USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='webhook_job_attempts' AND policyname='rls_service_role_all'
  ) THEN
    CREATE POLICY rls_service_role_all ON public.webhook_job_attempts TO service_role USING (true) WITH CHECK (true);
  END IF;
END$$;

commit;
;
