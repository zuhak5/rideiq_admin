-- Harden admin_record_ride_refund
--  - Enforce RBAC permission payments.refund
--  - Ensure payment.status is set to 'refunded' when fully refunded
--  - Pin SECURITY DEFINER search_path and schema-qualify references

BEGIN;

CREATE OR REPLACE FUNCTION public.admin_record_ride_refund(
  p_ride_id uuid,
  p_refund_amount_iqd integer DEFAULT NULL,
  p_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_receipt public.ride_receipts%rowtype;
  v_payment public.payments%rowtype;
  v_total integer;
  v_prev_refunded integer;
  v_add integer;
  v_new_total integer;
  v_ref_id text;
  v_new_status public.payment_status;
BEGIN
  -- authz
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'not_admin' USING errcode = '42501';
  END IF;

  IF NOT public.admin_has_permission('payments.refund') THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  -- lock receipt
  SELECT * INTO v_receipt
  FROM public.ride_receipts
  WHERE ride_id = p_ride_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'receipt_not_found' USING errcode = 'P0002';
  END IF;

  v_total := COALESCE(v_receipt.total_iqd, 0);
  v_prev_refunded := COALESCE(v_receipt.refunded_iqd, 0);

  IF p_refund_amount_iqd IS NULL THEN
    v_add := GREATEST(v_total - v_prev_refunded, 0);
  ELSE
    v_add := GREATEST(LEAST(p_refund_amount_iqd, v_total - v_prev_refunded), 0);
  END IF;

  IF v_add <= 0 THEN
    RETURN jsonb_build_object(
      'ride_id', p_ride_id,
      'refunded_iqd', v_prev_refunded,
      'added_iqd', 0,
      'status', 'no_op',
      'reason', p_reason
    );
  END IF;

  v_new_total := v_prev_refunded + v_add;

  -- lock latest succeeded payment
  SELECT * INTO v_payment
  FROM public.payments
  WHERE ride_id = p_ride_id AND status IN ('succeeded'::public.payment_status, 'refunded'::public.payment_status)
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'payment_not_found' USING errcode = 'P0002';
  END IF;

  v_ref_id := COALESCE(v_payment.provider_refund_id, 'manual_refund:' || extensions.gen_random_uuid()::text);

  v_new_status := CASE
    WHEN v_payment.amount_iqd IS NOT NULL AND v_new_total >= v_payment.amount_iqd THEN 'refunded'::public.payment_status
    ELSE v_payment.status
  END;

  UPDATE public.payments
  SET provider_refund_id = v_ref_id,
      refunded_at = now(),
      refund_amount_iqd = v_new_total,
      status = v_new_status,
      updated_at = now()
  WHERE id = v_payment.id;

  RETURN jsonb_build_object(
    'ride_id', p_ride_id,
    'payment_id', v_payment.id,
    'provider_refund_id', v_ref_id,
    'added_iqd', v_add,
    'refunded_iqd', v_new_total,
    'payment_status', v_new_status,
    'reason', p_reason
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_record_ride_refund(uuid, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_record_ride_refund(uuid, integer, text) TO authenticated, service_role;

COMMIT;
