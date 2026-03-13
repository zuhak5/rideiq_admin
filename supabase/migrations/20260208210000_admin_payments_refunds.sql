-- Admin Payments: refund idempotency + permission hardening
--
-- Adds:
--  - admin_audit_action: refund_payment
--  - payment_refund_idempotency table
--  - admin_record_ride_refund_v2 RPC with idempotency + payments.refund permission

BEGIN;
-- 1) Ensure audit action exists
ALTER TYPE public.admin_audit_action ADD VALUE IF NOT EXISTS 'refund_payment';
-- 2) Refund idempotency table
CREATE TABLE IF NOT EXISTS public.payment_refund_idempotency (
  key          text PRIMARY KEY,
  ride_id       uuid NOT NULL REFERENCES public.rides(id) ON DELETE RESTRICT,
  payment_id    uuid REFERENCES public.payments(id) ON DELETE SET NULL,
  actor_id      uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  params_hash   text NOT NULL,
  response      jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.payment_refund_idempotency ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='payment_refund_idempotency' AND policyname='payment_refund_idempotency_service_role_all'
  ) THEN
    EXECUTE $policy$CREATE POLICY payment_refund_idempotency_service_role_all ON public.payment_refund_idempotency
      TO service_role USING (true) WITH CHECK (true);$policy$;
  END IF;
END$$;
-- 3) V2 refund RPC with idempotency + permission
CREATE OR REPLACE FUNCTION public.admin_record_ride_refund_v2(
  p_ride_id uuid,
  p_refund_amount_iqd integer DEFAULT NULL,
  p_reason text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_uid uuid;
  v_key text;
  v_hash text;
  v_existing public.payment_refund_idempotency%rowtype;
  v_resp jsonb;
  v_payment_id uuid;
BEGIN
  v_uid := auth.uid();

  -- authz
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'not_admin' USING errcode = '42501';
  END IF;

  IF NOT public.admin_has_permission('payments.refund') THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  v_key := NULLIF(trim(coalesce(p_idempotency_key, '')), '');
  IF v_key IS NULL OR length(v_key) > 255 THEN
    RAISE EXCEPTION 'invalid_idempotency_key' USING errcode = '22023';
  END IF;

  v_hash := md5(
    coalesce(p_ride_id::text,'') || '|' ||
    coalesce(p_refund_amount_iqd::text,'') || '|' ||
    coalesce(trim(coalesce(p_reason,'')),'')
  );

  -- Insert idempotency record if not present.
  INSERT INTO public.payment_refund_idempotency(key, ride_id, actor_id, params_hash)
  VALUES (v_key, p_ride_id, v_uid, v_hash)
  ON CONFLICT (key) DO NOTHING;

  SELECT * INTO v_existing
  FROM public.payment_refund_idempotency
  WHERE key = v_key
  FOR UPDATE;

  IF NOT FOUND THEN
    -- should be impossible due to insert above
    RAISE EXCEPTION 'idempotency_insert_failed' USING errcode = 'P0001';
  END IF;

  IF v_existing.params_hash <> v_hash THEN
    RAISE EXCEPTION 'idempotency_key_reuse_params_mismatch' USING errcode = '22023';
  END IF;

  IF v_existing.response IS NOT NULL THEN
    RETURN v_existing.response;
  END IF;

  -- Perform refund logic using existing v1 implementation (which is transactional + row locks)
  v_resp := public.admin_record_ride_refund(p_ride_id, p_refund_amount_iqd, p_reason);

  -- Best effort: store payment_id in idempotency record (if present)
  BEGIN
    v_payment_id := NULLIF((v_resp->>'payment_id')::text, '')::uuid;
  EXCEPTION WHEN others THEN
    v_payment_id := NULL;
  END;

  UPDATE public.payment_refund_idempotency
  SET response = v_resp,
      payment_id = v_payment_id,
      updated_at = now()
  WHERE key = v_key;

  RETURN v_resp;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_record_ride_refund_v2(uuid, integer, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_record_ride_refund_v2(uuid, integer, text, text) TO authenticated, service_role;
COMMIT;
