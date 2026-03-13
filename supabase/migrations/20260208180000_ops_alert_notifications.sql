-- Session 8: Ops alert notification bookkeeping + escalation fields

-- Add notification fields to ops_alert_events
ALTER TABLE public.ops_alert_events
  ADD COLUMN IF NOT EXISTS notify_status text,
  ADD COLUMN IF NOT EXISTS notified_at timestamptz,
  ADD COLUMN IF NOT EXISTS notified_attempts integer DEFAULT 0 NOT NULL,
  ADD COLUMN IF NOT EXISTS notified_error text,
  ADD COLUMN IF NOT EXISTS notified_channels jsonb DEFAULT '{}'::jsonb NOT NULL;
-- Constrain status values (nullable means never attempted)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ops_alert_events_notify_status_ck'
  ) THEN
    ALTER TABLE public.ops_alert_events
      ADD CONSTRAINT ops_alert_events_notify_status_ck
      CHECK (notify_status IS NULL OR notify_status = ANY (ARRAY['sending','sent','failed','dead']));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS ops_alert_events_notify_pending_idx
  ON public.ops_alert_events (occurred_at)
  WHERE notify_status IS NULL;
CREATE INDEX IF NOT EXISTS ops_alert_events_notify_failed_idx
  ON public.ops_alert_events (occurred_at)
  WHERE notify_status = 'failed';
-- Add escalation fields to ops_alert_state
ALTER TABLE public.ops_alert_state
  ADD COLUMN IF NOT EXISTS escalated_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_escalation_notified_at timestamptz;
