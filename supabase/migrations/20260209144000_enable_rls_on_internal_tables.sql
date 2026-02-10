-- Security hardening: enable RLS on internal tables that must never be directly
-- accessible to client roles (anon/authenticated).
--
-- Supabase's default privilege model commonly grants table privileges broadly
-- and relies on RLS for access control. If RLS is disabled, tables can become
-- publicly queryable/mutable via PostgREST.

BEGIN;

ALTER TABLE public.agent_daily_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cashbox_daily_closings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.edge_webhook_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.merchant_commission_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settlement_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settlement_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settlement_payment_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settlement_payout_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settlement_payouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settlement_receipts ENABLE ROW LEVEL SECURITY;

COMMIT;

