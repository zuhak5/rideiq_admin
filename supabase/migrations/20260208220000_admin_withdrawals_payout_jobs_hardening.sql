-- Session 15: withdrawals RPC hardening + audit action enum extensions
--
-- Goals:
--  - Make withdrawal admin RPCs permission-based (admin_has_permission), not just is_admin.
--  - Fix missing hold validation in mark_paid/reject (avoid silent wallet inconsistencies).
--  - Add audit action enum values used by admin-api payout/withdraw routes.
--  - Use safe SECURITY DEFINER patterns (search_path='').

BEGIN;
-- 1) Ensure audit actions exist (used by admin-api best-effort audit inserts)
ALTER TYPE public.admin_audit_action ADD VALUE IF NOT EXISTS 'withdraw_approve';
ALTER TYPE public.admin_audit_action ADD VALUE IF NOT EXISTS 'withdraw_reject';
ALTER TYPE public.admin_audit_action ADD VALUE IF NOT EXISTS 'withdraw_mark_paid';
ALTER TYPE public.admin_audit_action ADD VALUE IF NOT EXISTS 'payout_job_create';
ALTER TYPE public.admin_audit_action ADD VALUE IF NOT EXISTS 'payout_job_retry';
ALTER TYPE public.admin_audit_action ADD VALUE IF NOT EXISTS 'payout_job_cancel';
ALTER TYPE public.admin_audit_action ADD VALUE IF NOT EXISTS 'payout_job_force_confirm';
-- 2) Harden admin_withdraw_approve: permission check + safe search_path
CREATE OR REPLACE FUNCTION public.admin_withdraw_approve(
  p_request_id uuid,
  p_note text DEFAULT NULL::text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  r record;
  v_hold record;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'not_admin' USING errcode = '42501';
  END IF;
  IF NOT public.admin_has_permission('withdrawals.approve') THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  SELECT * INTO r
  FROM public.wallet_withdraw_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'withdraw_request_not_found' USING errcode = 'P0002';
  END IF;

  IF r.status <> 'requested' THEN
    RAISE EXCEPTION 'invalid_status_transition' USING errcode = '22023';
  END IF;

  SELECT * INTO v_hold
  FROM public.wallet_holds
  WHERE withdraw_request_id = r.id
    AND status = 'active'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'withdraw_hold_missing' USING errcode = 'P0001';
  END IF;

  IF v_hold.amount_iqd < r.amount_iqd THEN
    RAISE EXCEPTION 'withdraw_hold_insufficient' USING errcode = '22023';
  END IF;

  UPDATE public.wallet_withdraw_requests
  SET status = 'approved',
      note = COALESCE(p_note, note),
      approved_at = now(),
      updated_at = now()
  WHERE id = r.id;

  PERFORM public.notify_user(
    r.user_id,
    'withdraw_approved',
    'Withdrawal approved',
    'Your withdrawal request was approved and will be paid soon.',
    jsonb_build_object('request_id', r.id, 'amount_iqd', r.amount_iqd, 'payout_kind', r.payout_kind)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_withdraw_approve(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_withdraw_approve(uuid, text) TO authenticated, service_role;
-- 3) Harden admin_withdraw_reject: permission check + require active hold
CREATE OR REPLACE FUNCTION public.admin_withdraw_reject(
  p_request_id uuid,
  p_note text DEFAULT NULL::text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  r record;
  h record;
  wa record;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'not_admin' USING errcode = '42501';
  END IF;
  IF NOT public.admin_has_permission('withdrawals.reject') THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  SELECT * INTO r
  FROM public.wallet_withdraw_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'withdraw_request_not_found' USING errcode = 'P0002';
  END IF;

  IF r.status NOT IN ('requested','approved') THEN
    RAISE EXCEPTION 'invalid_status_transition' USING errcode = '22023';
  END IF;

  SELECT * INTO h
  FROM public.wallet_holds
  WHERE withdraw_request_id = r.id AND status = 'active'
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'withdraw_hold_missing' USING errcode = 'P0001';
  END IF;

  IF h.amount_iqd < r.amount_iqd THEN
    RAISE EXCEPTION 'withdraw_hold_insufficient' USING errcode = '22023';
  END IF;

  SELECT * INTO wa FROM public.wallet_accounts WHERE user_id = r.user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'wallet_account_not_found' USING errcode = 'P0002';
  END IF;

  UPDATE public.wallet_holds
  SET status = 'released', released_at = now(), updated_at = now()
  WHERE id = h.id AND status = 'active';

  UPDATE public.wallet_accounts
  SET held_iqd = GREATEST(held_iqd - r.amount_iqd, 0),
      updated_at = now()
  WHERE user_id = r.user_id;

  UPDATE public.wallet_withdraw_requests
  SET status = 'rejected',
      note = COALESCE(p_note, note),
      rejected_at = now(),
      updated_at = now()
  WHERE id = r.id;

  PERFORM public.notify_user(
    r.user_id,
    'withdraw_rejected',
    'Withdrawal rejected',
    COALESCE(p_note, 'Your withdrawal request was rejected and funds were released.'),
    jsonb_build_object('request_id', r.id, 'amount_iqd', r.amount_iqd, 'payout_kind', r.payout_kind)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_withdraw_reject(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_withdraw_reject(uuid, text) TO authenticated, service_role;
-- 4) Harden admin_withdraw_mark_paid: permission check + require active hold
CREATE OR REPLACE FUNCTION public.admin_withdraw_mark_paid(
  p_request_id uuid,
  p_payout_reference text DEFAULT NULL::text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  r record;
  h record;
  wa record;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'not_admin' USING errcode = '42501';
  END IF;
  IF NOT public.admin_has_permission('withdrawals.mark_paid') THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  SELECT * INTO r
  FROM public.wallet_withdraw_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'withdraw_request_not_found' USING errcode = 'P0002';
  END IF;

  IF r.status <> 'approved' THEN
    RAISE EXCEPTION 'invalid_status_transition' USING errcode = '22023';
  END IF;

  SELECT * INTO h
  FROM public.wallet_holds
  WHERE withdraw_request_id = r.id AND status = 'active'
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'withdraw_hold_missing' USING errcode = 'P0001';
  END IF;

  IF h.amount_iqd < r.amount_iqd THEN
    RAISE EXCEPTION 'withdraw_hold_insufficient' USING errcode = '22023';
  END IF;

  SELECT * INTO wa FROM public.wallet_accounts WHERE user_id = r.user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'wallet_account_not_found' USING errcode = 'P0002';
  END IF;

  -- Defensive checks: balance/held should cover the withdrawal.
  IF COALESCE(wa.held_iqd, 0) < r.amount_iqd THEN
    RAISE EXCEPTION 'wallet_held_insufficient' USING errcode = '22023';
  END IF;
  IF COALESCE(wa.balance_iqd, 0) < r.amount_iqd THEN
    RAISE EXCEPTION 'wallet_balance_insufficient' USING errcode = '22023';
  END IF;

  UPDATE public.wallet_accounts
  SET held_iqd = GREATEST(held_iqd - r.amount_iqd, 0),
      balance_iqd = balance_iqd - r.amount_iqd,
      updated_at = now()
  WHERE user_id = r.user_id;

  INSERT INTO public.wallet_entries (user_id, delta_iqd, kind, memo, source_type, source_id, metadata, idempotency_key)
  VALUES (
    r.user_id,
    -r.amount_iqd,
    'withdrawal',
    'Driver withdrawal',
    'withdraw',
    r.id,
    jsonb_build_object(
      'payout_kind', r.payout_kind,
      'destination', r.destination,
      'payout_reference', p_payout_reference
    ),
    'withdraw:' || r.id::text
  )
  ON CONFLICT (idempotency_key) DO NOTHING;

  UPDATE public.wallet_holds
  SET status = 'captured', captured_at = now(), updated_at = now()
  WHERE id = h.id AND status = 'active';

  UPDATE public.wallet_withdraw_requests
  SET status = 'paid',
      payout_reference = COALESCE(p_payout_reference, payout_reference),
      paid_at = now(),
      updated_at = now()
  WHERE id = r.id;

  PERFORM public.notify_user(
    r.user_id,
    'withdraw_paid',
    'Withdrawal paid',
    CASE
      WHEN p_payout_reference IS NULL OR p_payout_reference = '' THEN 'Your withdrawal has been paid.'
      ELSE 'Your withdrawal has been paid. Reference: ' || p_payout_reference
    END,
    jsonb_build_object('request_id', r.id, 'amount_iqd', r.amount_iqd, 'payout_kind', r.payout_kind, 'payout_reference', p_payout_reference)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_withdraw_mark_paid(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_withdraw_mark_paid(uuid, text) TO authenticated, service_role;
COMMIT;
