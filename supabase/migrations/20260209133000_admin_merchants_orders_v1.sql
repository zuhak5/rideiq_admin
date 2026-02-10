-- Admin: Merchants + Orders module (Next Admin)
--
-- Adds admin-safe RPCs for:
--  - listing merchants
--  - merchant detail summary
--  - merchant status updates
--  - listing orders
--  - order detail summary
--  - order status updates
--
-- Notes:
--  - RPCs are SECURITY DEFINER and gated by admin RBAC (merchants.* / orders.*).
--  - RPC outputs are intentionally "view-like" to keep Next Admin simple and stable.

BEGIN;

-- ------------------------------------------------------------
-- 1) Admin audit actions (extend enum)
-- ------------------------------------------------------------

ALTER TYPE public.admin_audit_action ADD VALUE IF NOT EXISTS 'merchant_status_update';
ALTER TYPE public.admin_audit_action ADD VALUE IF NOT EXISTS 'order_status_update';

-- ------------------------------------------------------------
-- 2) Merchants
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_merchants_list_v1(
  p_q text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_limit integer DEFAULT 25,
  p_offset integer DEFAULT 0
)
RETURNS TABLE(
  merchant_id uuid,
  business_name text,
  business_type text,
  status public.merchant_status,
  owner_profile_id uuid,
  owner_display_name text,
  owner_phone text,
  orders_count bigint,
  last_order_at timestamptz,
  created_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  q text := NULLIF(btrim(COALESCE(p_q, '')), '');
  st text := NULLIF(btrim(COALESCE(p_status, '')), '');
  lim integer := LEAST(200, GREATEST(1, COALESCE(p_limit, 25)));
  off integer := GREATEST(0, COALESCE(p_offset, 0));
BEGIN
  IF NOT public.admin_has_permission('merchants.read') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    m.id AS merchant_id,
    m.business_name,
    m.business_type,
    m.status,
    m.owner_profile_id,
    p.display_name AS owner_display_name,
    COALESCE(NULLIF(p.phone_e164, ''), p.phone) AS owner_phone,
    COALESCE(os.orders_count, 0) AS orders_count,
    os.last_order_at,
    m.created_at
  FROM public.merchants m
  LEFT JOIN public.profiles p ON p.id = m.owner_profile_id
  LEFT JOIN LATERAL (
    SELECT
      count(*)::bigint AS orders_count,
      max(o.created_at) AS last_order_at
    FROM public.merchant_orders o
    WHERE o.merchant_id = m.id
  ) os ON TRUE
  WHERE
    (q IS NULL OR (
      m.business_name ILIKE '%' || q || '%'
      OR m.business_type ILIKE '%' || q || '%'
      OR COALESCE(p.display_name, '') ILIKE '%' || q || '%'
      OR COALESCE(p.phone, '') ILIKE '%' || q || '%'
      OR COALESCE(p.phone_e164, '') ILIKE '%' || q || '%'
    ))
    AND (st IS NULL OR m.status::text = st)
  ORDER BY m.created_at DESC
  OFFSET off
  LIMIT lim;
END;
$$;


CREATE OR REPLACE FUNCTION public.admin_merchant_get_v1(
  p_merchant_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  v_m public.merchants;
  v_owner public.profiles;
  v_orders_count bigint;
  v_last_order_at timestamptz;
  v_recent jsonb;
  v_audits jsonb;
BEGIN
  IF NOT public.admin_has_permission('merchants.read') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_m
  FROM public.merchants m
  WHERE m.id = p_merchant_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'merchant_not_found');
  END IF;

  SELECT * INTO v_owner
  FROM public.profiles p
  WHERE p.id = v_m.owner_profile_id;

  SELECT
    count(*)::bigint,
    max(o.created_at)
  INTO v_orders_count, v_last_order_at
  FROM public.merchant_orders o
  WHERE o.merchant_id = v_m.id;

  v_recent := (
    SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.created_at DESC), '[]'::jsonb)
    FROM (
      SELECT
        o.id,
        o.status,
        o.total_iqd,
        o.created_at,
        jsonb_build_object(
          'display_name', p.display_name,
          'phone', COALESCE(NULLIF(p.phone_e164, ''), p.phone)
        ) AS customer
      FROM public.merchant_orders o
      LEFT JOIN public.profiles p ON p.id = o.customer_id
      WHERE o.merchant_id = v_m.id
      ORDER BY o.created_at DESC
      LIMIT 10
    ) t
  );

  v_audits := (
    SELECT COALESCE(jsonb_agg(row_to_json(a) ORDER BY a.created_at DESC), '[]'::jsonb)
    FROM (
      SELECT
        l.id,
        l.from_status,
        l.to_status,
        l.note,
        l.actor_id,
        l.created_at
      FROM public.merchant_status_audit_log l
      WHERE l.merchant_id = v_m.id
      ORDER BY l.created_at DESC
      LIMIT 50
    ) a
  );

  RETURN jsonb_build_object(
    'ok', true,
    'merchant', jsonb_build_object(
      'id', v_m.id,
      'owner_profile_id', v_m.owner_profile_id,
      'business_name', v_m.business_name,
      'business_type', v_m.business_type,
      'status', v_m.status,
      'contact_phone', v_m.contact_phone,
      'address_text', v_m.address_text,
      -- UI expects these keys; most data is stored either in address_text or metadata.
      'address', v_m.address_text,
      'city', NULLIF(v_m.metadata->>'city', ''),
      'area', NULLIF(v_m.metadata->>'area', ''),
      'location', v_m.metadata->'location'
    ),
    'owner', CASE WHEN v_owner.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', v_owner.id,
      'display_name', v_owner.display_name,
      'phone', COALESCE(NULLIF(v_owner.phone_e164, ''), v_owner.phone)
    ) END,
    'stats', jsonb_build_object(
      'orders_count', COALESCE(v_orders_count, 0),
      'last_order_at', v_last_order_at
    ),
    'audits', v_audits,
    'recent_orders', v_recent
  );
END;
$$;


CREATE OR REPLACE FUNCTION public.admin_set_merchant_status_v1(
  p_merchant_id uuid,
  p_new_status public.merchant_status,
  p_note text DEFAULT NULL
)
RETURNS public.merchants
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  actor uuid := auth.uid();
  v_owner_id uuid;
  v_row public.merchants;
BEGIN
  IF NOT public.admin_has_permission('merchants.manage') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT m.owner_profile_id INTO v_owner_id
  FROM public.merchants m
  WHERE m.id = p_merchant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'merchant_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- Reuse existing status update semantics (and its triggers/audit table).
  v_row := public.admin_set_merchant_status(p_merchant_id, p_new_status, p_note);

  -- Structured audit log entry (admin_audit_log is user-oriented, so target_owner is used).
  INSERT INTO public.admin_audit_log(actor_id, action, target_user_id, note, details)
  VALUES (
    actor,
    'merchant_status_update'::public.admin_audit_action,
    v_owner_id,
    NULLIF(btrim(COALESCE(p_note, '')), ''),
    jsonb_build_object('merchant_id', p_merchant_id, 'to_status', p_new_status)
  );

  RETURN v_row;
END;
$$;

-- ------------------------------------------------------------
-- 3) Orders
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_orders_list_v1(
  p_q text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_merchant_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 25,
  p_offset integer DEFAULT 0
)
RETURNS TABLE(
  order_id uuid,
  merchant_id uuid,
  merchant_name text,
  customer_id uuid,
  customer_name text,
  customer_phone text,
  status public.merchant_order_status,
  total_iqd bigint,
  payment_method text,
  payment_status text,
  delivery_status text,
  created_at timestamptz,
  status_changed_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  q text := NULLIF(btrim(COALESCE(p_q, '')), '');
  st text := NULLIF(btrim(COALESCE(p_status, '')), '');
  lim integer := LEAST(200, GREATEST(1, COALESCE(p_limit, 25)));
  off integer := GREATEST(0, COALESCE(p_offset, 0));
BEGIN
  IF NOT public.admin_has_permission('orders.read') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    o.id AS order_id,
    o.merchant_id,
    m.business_name AS merchant_name,
    o.customer_id,
    p.display_name AS customer_name,
    COALESCE(NULLIF(p.phone_e164, ''), p.phone) AS customer_phone,
    o.status,
    o.total_iqd,
    o.payment_method::text AS payment_method,
    o.payment_status::text AS payment_status,
    d.status::text AS delivery_status,
    o.created_at,
    o.status_changed_at
  FROM public.merchant_orders o
  JOIN public.merchants m ON m.id = o.merchant_id
  LEFT JOIN public.profiles p ON p.id = o.customer_id
  LEFT JOIN LATERAL (
    SELECT dd.status
    FROM public.merchant_order_deliveries dd
    WHERE dd.order_id = o.id
    ORDER BY dd.created_at DESC
    LIMIT 1
  ) d ON TRUE
  WHERE
    (p_merchant_id IS NULL OR o.merchant_id = p_merchant_id)
    AND (st IS NULL OR o.status::text = st)
    AND (q IS NULL OR (
      o.id::text ILIKE '%' || q || '%'
      OR m.business_name ILIKE '%' || q || '%'
      OR COALESCE(p.display_name, '') ILIKE '%' || q || '%'
      OR COALESCE(p.phone, '') ILIKE '%' || q || '%'
      OR COALESCE(p.phone_e164, '') ILIKE '%' || q || '%'
    ))
  ORDER BY o.created_at DESC
  OFFSET off
  LIMIT lim;
END;
$$;


CREATE OR REPLACE FUNCTION public.admin_order_get_v1(
  p_order_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  v_o public.merchant_orders;
  v_m public.merchants;
  v_customer public.profiles;
  v_items jsonb;
  v_events jsonb;
  v_delivery jsonb;
BEGIN
  IF NOT public.admin_has_permission('orders.read') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_o
  FROM public.merchant_orders o
  WHERE o.id = p_order_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'order_not_found');
  END IF;

  SELECT * INTO v_m
  FROM public.merchants m
  WHERE m.id = v_o.merchant_id;

  SELECT * INTO v_customer
  FROM public.profiles p
  WHERE p.id = v_o.customer_id;

  v_items := (
    SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.created_at ASC), '[]'::jsonb)
    FROM (
      SELECT
        i.id,
        i.name_snapshot AS name,
        i.qty,
        i.unit_price_iqd,
        i.line_total_iqd AS subtotal_iqd,
        i.created_at
      FROM public.merchant_order_items i
      WHERE i.order_id = v_o.id
      ORDER BY i.created_at ASC
    ) t
  );

  v_events := (
    SELECT COALESCE(jsonb_agg(row_to_json(e) ORDER BY e.created_at DESC), '[]'::jsonb)
    FROM (
      SELECT
        s.id,
        s.actor_id,
        s.from_status,
        s.to_status,
        s.note,
        s.created_at
      FROM public.merchant_order_status_events s
      WHERE s.order_id = v_o.id
      ORDER BY s.created_at DESC
      LIMIT 100
    ) e
  );

  v_delivery := (
    SELECT COALESCE(to_jsonb(d), 'null'::jsonb)
    FROM (
      SELECT
        d1.id,
        d1.status,
        d1.driver_id,
        d1.pickup_snapshot,
        d1.dropoff_snapshot,
        d1.fee_iqd,
        d1.assigned_at,
        d1.picked_up_at,
        d1.delivered_at,
        d1.cancelled_at,
        d1.created_at,
        d1.updated_at,
        d1.cod_expected_amount_iqd,
        d1.cod_collected_amount_iqd,
        d1.cod_change_given_iqd
      FROM public.merchant_order_deliveries d1
      WHERE d1.order_id = v_o.id
      ORDER BY d1.created_at DESC
      LIMIT 1
    ) d
  );

  RETURN jsonb_build_object(
    'ok', true,
    'order', jsonb_build_object(
      'id', v_o.id,
      'merchant_id', v_o.merchant_id,
      'customer_id', v_o.customer_id,
      'status', v_o.status,
      'subtotal_iqd', v_o.subtotal_iqd,
      'discount_iqd', v_o.discount_iqd,
      'delivery_fee_iqd', v_o.delivery_fee_iqd,
      'fee_iqd', COALESCE((v_delivery->>'fee_iqd')::bigint, v_o.delivery_fee_iqd),
      'total_iqd', v_o.total_iqd,
      'payment_method', v_o.payment_method,
      'payment_status', v_o.payment_status,
      'payment_reference', NULL,
      'status_changed_at', v_o.status_changed_at,
      'created_at', v_o.created_at,
      'delivery_address', v_o.address_snapshot
    ),
    'merchant', CASE WHEN v_m.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', v_m.id,
      'business_name', v_m.business_name,
      'business_type', v_m.business_type,
      'contact_phone', v_m.contact_phone
    ) END,
    'customer', CASE WHEN v_customer.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', v_customer.id,
      'display_name', v_customer.display_name,
      'phone', COALESCE(NULLIF(v_customer.phone_e164, ''), v_customer.phone)
    ) END,
    'items', v_items,
    'status_events', v_events,
    'delivery', v_delivery
  );
END;
$$;


CREATE OR REPLACE FUNCTION public.admin_order_set_status_v1(
  p_order_id uuid,
  p_new_status public.merchant_order_status,
  p_note text DEFAULT NULL
)
RETURNS public.merchant_orders
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  actor uuid := auth.uid();
  v_row public.merchant_orders;
  v_target uuid;
BEGIN
  IF NOT public.admin_has_permission('orders.manage') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT o.customer_id INTO v_target
  FROM public.merchant_orders o
  WHERE o.id = p_order_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- Reuse existing authz + status-change triggers.
  PERFORM public.merchant_order_set_status(p_order_id, p_new_status, COALESCE(p_note, ''));

  SELECT * INTO v_row
  FROM public.merchant_orders o
  WHERE o.id = p_order_id;

  INSERT INTO public.admin_audit_log(actor_id, action, target_user_id, note, details)
  VALUES (
    actor,
    'order_status_update'::public.admin_audit_action,
    v_target,
    NULLIF(btrim(COALESCE(p_note, '')), ''),
    jsonb_build_object('order_id', p_order_id, 'to_status', p_new_status)
  );

  RETURN v_row;
END;
$$;

-- ------------------------------------------------------------
-- 4) Grants (keep RPCs callable via PostgREST for authenticated users)
-- ------------------------------------------------------------

REVOKE ALL ON FUNCTION public.admin_merchants_list_v1(text, text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_merchants_list_v1(text, text, integer, integer) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.admin_merchant_get_v1(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_merchant_get_v1(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.admin_set_merchant_status_v1(uuid, public.merchant_status, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_merchant_status_v1(uuid, public.merchant_status, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.admin_orders_list_v1(text, text, uuid, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_orders_list_v1(text, text, uuid, integer, integer) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.admin_order_get_v1(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_order_get_v1(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.admin_order_set_status_v1(uuid, public.merchant_order_status, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_order_set_status_v1(uuid, public.merchant_order_status, text) TO authenticated, service_role;

COMMIT;
