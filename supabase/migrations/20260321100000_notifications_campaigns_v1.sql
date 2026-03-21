BEGIN;

ALTER TYPE public.admin_audit_action ADD VALUE IF NOT EXISTS 'driver_transition';
ALTER TYPE public.admin_audit_action ADD VALUE IF NOT EXISTS 'refund_payment';
ALTER TYPE public.admin_audit_action ADD VALUE IF NOT EXISTS 'notification_campaign_create';
ALTER TYPE public.admin_audit_action ADD VALUE IF NOT EXISTS 'notification_campaign_update';
ALTER TYPE public.admin_audit_action ADD VALUE IF NOT EXISTS 'notification_campaign_send';
ALTER TYPE public.admin_audit_action ADD VALUE IF NOT EXISTS 'notification_campaign_schedule';
ALTER TYPE public.admin_audit_action ADD VALUE IF NOT EXISTS 'notification_campaign_cancel';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = 'notification_campaign_status'
  ) THEN
    CREATE TYPE public.notification_campaign_status AS ENUM (
      'draft',
      'scheduled',
      'running',
      'completed',
      'cancelled',
      'failed'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = 'notification_campaign_category'
  ) THEN
    CREATE TYPE public.notification_campaign_category AS ENUM (
      'operational',
      'marketing'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = 'notification_route_key'
  ) THEN
    CREATE TYPE public.notification_route_key AS ENUM (
      'notification_center',
      'home',
      'wallet',
      'rider_activity',
      'driver_requests',
      'merchant_orders'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = 'notification_push_delivery_status'
  ) THEN
    CREATE TYPE public.notification_push_delivery_status AS ENUM (
      'pending',
      'sent',
      'failed',
      'suppressed',
      'skipped'
    );
  END IF;
END $$;

ALTER TABLE public.device_tokens
  ADD COLUMN IF NOT EXISTS device_id text,
  ADD COLUMN IF NOT EXISTS app_version text,
  ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone NOT NULL DEFAULT now();

UPDATE public.device_tokens
SET
  device_id = COALESCE(device_id, 'legacy-device-' || id::text),
  updated_at = COALESCE(updated_at, last_seen_at, created_at, now())
WHERE device_id IS NULL OR trim(device_id) = '';

UPDATE public.device_tokens dt
SET
  device_id = udt.device_id,
  updated_at = GREATEST(dt.updated_at, COALESCE(udt.updated_at, dt.updated_at)),
  last_seen_at = GREATEST(dt.last_seen_at, COALESCE(udt.last_seen_at, dt.last_seen_at)),
  enabled = true,
  disabled_at = NULL
FROM public.user_device_tokens udt
WHERE dt.user_id = udt.user_id
  AND dt.token = udt.token
  AND (
    dt.device_id IS NULL
    OR dt.device_id LIKE 'legacy-device-%'
  );

ALTER TABLE public.device_tokens
  ALTER COLUMN device_id SET NOT NULL;

ALTER TABLE public.device_tokens
  DROP CONSTRAINT IF EXISTS device_tokens_token_key;

CREATE UNIQUE INDEX IF NOT EXISTS device_tokens_device_id_key
  ON public.device_tokens (device_id);

CREATE INDEX IF NOT EXISTS ix_device_tokens_platform_token
  ON public.device_tokens (platform, token);

CREATE INDEX IF NOT EXISTS ix_device_tokens_user_enabled
  ON public.device_tokens (user_id, enabled)
  WHERE enabled = true AND disabled_at IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'trg_device_tokens_set_updated_at'
  ) THEN
    CREATE TRIGGER trg_device_tokens_set_updated_at
    BEFORE UPDATE ON public.device_tokens
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.user_notification_preferences (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  marketing_push_enabled boolean NOT NULL DEFAULT true,
  marketing_inapp_enabled boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.notification_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status public.notification_campaign_status NOT NULL DEFAULT 'draft',
  category public.notification_campaign_category NOT NULL,
  title text NOT NULL,
  body text,
  route_key public.notification_route_key NOT NULL DEFAULT 'notification_center',
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  audience_filter jsonb NOT NULL DEFAULT '{}'::jsonb,
  scheduled_at timestamp with time zone,
  created_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  started_at timestamp with time zone,
  completed_at timestamp with time zone,
  cancelled_at timestamp with time zone,
  last_error text,
  estimated_recipients integer,
  inbox_created integer NOT NULL DEFAULT 0,
  push_sent integer NOT NULL DEFAULT 0,
  push_failed integer NOT NULL DEFAULT 0,
  read_count integer NOT NULL DEFAULT 0,
  CONSTRAINT notification_campaigns_title_nonempty CHECK (length(trim(title)) BETWEEN 1 AND 120),
  CONSTRAINT notification_campaigns_body_len CHECK (body IS NULL OR length(body) <= 500),
  CONSTRAINT notification_campaigns_schedule_required CHECK (
    status <> 'scheduled' OR scheduled_at IS NOT NULL
  )
);

CREATE TABLE IF NOT EXISTS public.notification_campaign_recipients (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  campaign_id uuid NOT NULL REFERENCES public.notification_campaigns(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  user_notification_id uuid REFERENCES public.user_notifications(id) ON DELETE SET NULL,
  push_status public.notification_push_delivery_status NOT NULL DEFAULT 'pending',
  push_reason text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  push_sent_at timestamp with time zone,
  push_failed_at timestamp with time zone,
  UNIQUE (campaign_id, user_id)
);

CREATE INDEX IF NOT EXISTS ix_notification_campaigns_status_schedule
  ON public.notification_campaigns (status, scheduled_at, created_at);

CREATE INDEX IF NOT EXISTS ix_notification_campaigns_created_by
  ON public.notification_campaigns (created_by, created_at DESC);

CREATE INDEX IF NOT EXISTS ix_notification_campaign_recipients_campaign_id
  ON public.notification_campaign_recipients (campaign_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ix_notification_campaign_recipients_user_notification
  ON public.notification_campaign_recipients (user_notification_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'trg_notification_campaigns_set_updated_at'
  ) THEN
    CREATE TRIGGER trg_notification_campaigns_set_updated_at
    BEFORE UPDATE ON public.notification_campaigns
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'trg_user_notification_preferences_set_updated_at'
  ) THEN
    CREATE TRIGGER trg_user_notification_preferences_set_updated_at
    BEFORE UPDATE ON public.user_notification_preferences
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $$;

ALTER TABLE public.user_notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_campaign_recipients ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'user_notification_preferences'
      AND policyname = 'user_notification_preferences_self_select'
  ) THEN
    CREATE POLICY user_notification_preferences_self_select
      ON public.user_notification_preferences
      FOR SELECT
      TO authenticated
      USING (user_id = auth.uid());
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'user_notification_preferences'
      AND policyname = 'user_notification_preferences_self_insert'
  ) THEN
    CREATE POLICY user_notification_preferences_self_insert
      ON public.user_notification_preferences
      FOR INSERT
      TO authenticated
      WITH CHECK (user_id = auth.uid());
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'user_notification_preferences'
      AND policyname = 'user_notification_preferences_self_update'
  ) THEN
    CREATE POLICY user_notification_preferences_self_update
      ON public.user_notification_preferences
      FOR UPDATE
      TO authenticated
      USING (user_id = auth.uid())
      WITH CHECK (user_id = auth.uid());
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'user_notification_preferences'
      AND policyname = 'user_notification_preferences_service_role_all'
  ) THEN
    CREATE POLICY user_notification_preferences_service_role_all
      ON public.user_notification_preferences
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'notification_campaigns'
      AND policyname = 'notification_campaigns_service_role_all'
  ) THEN
    CREATE POLICY notification_campaigns_service_role_all
      ON public.notification_campaigns
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'notification_campaign_recipients'
      AND policyname = 'notification_campaign_recipients_service_role_all'
  ) THEN
    CREATE POLICY notification_campaign_recipients_service_role_all
      ON public.notification_campaign_recipients
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.user_notification_preferences_upsert_self(
  p_marketing_push_enabled boolean,
  p_marketing_inapp_enabled boolean
) RETURNS public.user_notification_preferences
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.user_notification_preferences;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  INSERT INTO public.user_notification_preferences (
    user_id,
    marketing_push_enabled,
    marketing_inapp_enabled
  )
  VALUES (
    v_uid,
    COALESCE(p_marketing_push_enabled, true),
    COALESCE(p_marketing_inapp_enabled, true)
  )
  ON CONFLICT (user_id) DO UPDATE
  SET
    marketing_push_enabled = EXCLUDED.marketing_push_enabled,
    marketing_inapp_enabled = EXCLUDED.marketing_inapp_enabled,
    updated_at = now()
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.notification_campaign_claim_due(
  p_limit integer DEFAULT 10
) RETURNS TABLE (
  id uuid,
  status public.notification_campaign_status,
  category public.notification_campaign_category,
  title text,
  body text,
  route_key public.notification_route_key,
  data jsonb,
  audience_filter jsonb,
  scheduled_at timestamp with time zone,
  created_by uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
BEGIN
  RETURN QUERY
  WITH picked AS (
    SELECT c.id
    FROM public.notification_campaigns c
    WHERE c.status = 'scheduled'
      AND c.scheduled_at IS NOT NULL
      AND c.scheduled_at <= now()
    ORDER BY c.scheduled_at ASC, c.created_at ASC
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 10), 100))
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.notification_campaigns c
  SET
    status = 'running',
    started_at = COALESCE(c.started_at, now()),
    updated_at = now(),
    last_error = NULL
  WHERE c.id IN (SELECT id FROM picked)
  RETURNING
    c.id,
    c.status,
    c.category,
    c.title,
    c.body,
    c.route_key,
    c.data,
    c.audience_filter,
    c.scheduled_at,
    c.created_by;
END;
$$;

INSERT INTO public.admin_permissions (key, name, description)
VALUES
  ('notifications.read', 'Read notifications', 'View notification campaigns, recipients, and delivery status'),
  ('notifications.manage', 'Manage notifications', 'Create, schedule, send, and cancel notification campaigns')
ON CONFLICT (key) DO NOTHING;

WITH r AS (
  SELECT id, key FROM public.admin_roles
),
p AS (
  SELECT id, key FROM public.admin_permissions
)
INSERT INTO public.admin_role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM r
JOIN p ON (
  (r.key IN ('super_admin', 'legacy_admin') AND p.key IN ('notifications.read', 'notifications.manage'))
  OR (r.key = 'growth_admin' AND p.key IN ('notifications.read', 'notifications.manage'))
  OR (r.key = 'support_admin' AND p.key IN ('notifications.read'))
)
ON CONFLICT DO NOTHING;

GRANT EXECUTE ON FUNCTION public.user_notification_preferences_upsert_self(boolean, boolean)
  TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.notification_campaign_claim_due(integer)
  TO service_role;

COMMIT;
