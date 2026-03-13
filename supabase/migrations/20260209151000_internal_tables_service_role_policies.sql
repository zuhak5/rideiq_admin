-- Security Advisor (rls_enabled_no_policy):
-- Add explicit RLS policies for internal/admin tables that are not meant to be
-- directly accessible by end users. These tables are accessed via service role
-- (Edge Functions / server-side jobs) or SECURITY DEFINER functions.

BEGIN;
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'admin_action_throttle',
    'admin_role_change_requests',
    'agent_daily_counters',
    'cash_agents',
    'cashbox_daily_closings',
    'edge_webhook_outbox',
    'merchant_commission_configs',
    'settlement_accounts',
    'settlement_entries',
    'settlement_payment_requests',
    'settlement_payout_requests',
    'settlement_payouts',
    'settlement_receipts'
  ]
  LOOP
    -- Defensive: allow migrations to run in partial schemas without failing.
    IF to_regclass(format('public.%I', t)) IS NULL THEN
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

    -- Keep policies minimal: the default for other roles is DENY (no matching policy).
    IF NOT EXISTS (
      SELECT 1
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = t
        AND policyname = 'service_role_all'
    ) THEN
      EXECUTE format(
        'CREATE POLICY service_role_all ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
        t
      );
    END IF;
  END LOOP;
END $$;
COMMIT;
