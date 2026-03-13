BEGIN;
-- Session 6: rate limiting + request lifecycle improvements for privileged role changes
-- Goals:
--  - Add a lightweight, DB-enforced per-admin action throttle (defense-in-depth)
--  - Improve role change request UX with a richer list RPC and an explicit reject RPC
--  - Add request expiry checks (server-side) for role-change approvals

-- 1) DB-enforced throttling table
CREATE TABLE IF NOT EXISTS public.admin_action_throttle (
  user_id uuid NOT NULL,
  action_key text NOT NULL,
  bucket_start timestamptz NOT NULL,
  count integer NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, action_key, bucket_start)
);
ALTER TABLE public.admin_action_throttle ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.admin_action_throttle FROM PUBLIC;
REVOKE ALL ON TABLE public.admin_action_throttle FROM anon;
REVOKE ALL ON TABLE public.admin_action_throttle FROM authenticated;
GRANT ALL ON TABLE public.admin_action_throttle TO service_role;
-- 2) Throttle function (SECURITY DEFINER)
-- Uses fixed buckets for simplicity: bucket_start = floor(now/window)*window.
CREATE OR REPLACE FUNCTION public.admin_throttle_action_v1(
  p_action_key text,
  p_limit integer,
  p_window_seconds integer
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  actor uuid := auth.uid();
  win integer := GREATEST(1, COALESCE(p_window_seconds, 60));
  lim integer := LEAST(10000, GREATEST(1, COALESCE(p_limit, 60)));
  bucket timestamptz;
  next_count integer;
BEGIN
  IF actor IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;

  IF p_action_key IS NULL OR btrim(p_action_key) = '' THEN
    RAISE EXCEPTION 'p_action_key is required' USING ERRCODE = '22004';
  END IF;

  bucket := to_timestamp(floor(extract(epoch from now()) / win) * win);

  INSERT INTO public.admin_action_throttle(user_id, action_key, bucket_start, count)
  VALUES (actor, btrim(p_action_key), bucket, 1)
  ON CONFLICT (user_id, action_key, bucket_start)
  DO UPDATE SET count = public.admin_action_throttle.count + 1
  RETURNING count INTO next_count;

  IF next_count > lim THEN
    RAISE EXCEPTION 'rate limit exceeded (%/% in % seconds) for %', lim, next_count, win, p_action_key
      USING ERRCODE = '22023';
  END IF;
END;
$$;
-- 3) Add richer list RPC v2 with "effective" status (pending requests older than TTL are labeled expired)
-- Note: we don't mutate status automatically; we compute it to avoid side-effects.
CREATE OR REPLACE FUNCTION public.admin_list_role_change_requests_v2(
  p_status text DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0,
  p_ttl_days integer DEFAULT 7
)
RETURNS TABLE(
  id uuid,
  created_at timestamptz,
  status text,
  effective_status text,
  is_expired boolean,
  note text,
  created_by uuid,
  created_by_name text,
  created_by_phone text,
  target_user_id uuid,
  target_name text,
  target_phone text,
  requested_role_keys text[]
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  lim integer := 50;
  off integer := 0;
  st text := NULL;
  ttl interval := make_interval(days => GREATEST(1, COALESCE(p_ttl_days, 7)));
BEGIN
  IF NOT public.admin_has_permission('admin_access.manage') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  lim := LEAST(200, GREATEST(1, COALESCE(p_limit, 50)));
  off := GREATEST(0, COALESCE(p_offset, 0));
  st := NULLIF(btrim(COALESCE(p_status, '')), '');

  RETURN QUERY
  SELECT
    r.id,
    r.created_at,
    r.status,
    CASE
      WHEN r.status = 'pending' AND r.created_at < now() - ttl THEN 'expired'
      ELSE r.status
    END AS effective_status,
    (r.status = 'pending' AND r.created_at < now() - ttl) AS is_expired,
    r.note,
    r.created_by,
    pc.display_name,
    pc.phone,
    r.target_user_id,
    pt.display_name,
    pt.phone,
    r.requested_role_keys
  FROM public.admin_role_change_requests r
  JOIN public.profiles pc ON pc.id = r.created_by
  JOIN public.profiles pt ON pt.id = r.target_user_id
  WHERE (st IS NULL) OR (
    CASE
      WHEN r.status = 'pending' AND r.created_at < now() - ttl THEN 'expired'
      ELSE r.status
    END = st
  )
  ORDER BY r.created_at DESC
  OFFSET off
  LIMIT lim;
END;
$$;
-- 4) Explicit reject RPC to cleanly close stale/invalid requests
ALTER TYPE public.admin_audit_action ADD VALUE IF NOT EXISTS 'reject_admin_role_change';
CREATE OR REPLACE FUNCTION public.admin_reject_role_change_request_v1(
  p_request_id uuid,
  p_note text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  actor uuid := auth.uid();
  req record;
BEGIN
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'p_request_id is required' USING ERRCODE = '22004';
  END IF;

  IF NOT public.admin_has_permission('admin_access.manage') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  PERFORM public.admin_throttle_action_v1('admin.reject_role_change_request', 30, 3600);

  SELECT * INTO req
  FROM public.admin_role_change_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF req IS NULL THEN
    RAISE EXCEPTION 'request not found' USING ERRCODE = '22023';
  END IF;

  IF req.status <> 'pending' THEN
    RAISE EXCEPTION 'request is not pending' USING ERRCODE = '22023';
  END IF;

  UPDATE public.admin_role_change_requests
  SET status = 'rejected',
      approved_by = actor,
      approved_at = now()
  WHERE id = p_request_id;

  INSERT INTO public.admin_audit_log(actor_id, action, target_user_id, note, details)
  VALUES (
    actor,
    'reject_admin_role_change',
    req.target_user_id,
    p_note,
    jsonb_build_object(
      'request_id', p_request_id,
      'requested_roles', req.requested_role_keys,
      'source', 'reject'
    )
  );

  RETURN jsonb_build_object('ok', true, 'request_id', p_request_id, 'status', 'rejected');
END;
$$;
-- 5) Patch role-change request creators/approvers with throttling + expiry check
-- Note: create/approve definitions live in session 5 migration; we replace them here to avoid editing history.

CREATE OR REPLACE FUNCTION public.admin_create_role_change_request_v1(
  p_user uuid,
  p_role_keys text[],
  p_note text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  actor uuid := auth.uid();
  v_roles text[];
  unknown_roles text[];
  old_roles text[];
  old_has_super boolean;
  new_has_super boolean;

  target_had_manage boolean;
  new_has_manage boolean;
  manage_user_count integer;

  req_id uuid;
BEGIN
  IF p_user IS NULL THEN
    RAISE EXCEPTION 'p_user is required' USING ERRCODE = '22004';
  END IF;

  IF NOT public.admin_has_permission('admin_access.manage') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  PERFORM public.admin_throttle_action_v1('admin.create_role_change_request', 20, 3600);

  IF NOT public.is_admin(p_user) THEN
    RAISE EXCEPTION 'target user is not an admin' USING ERRCODE = '22023';
  END IF;

  v_roles := ARRAY(
    SELECT DISTINCT btrim(x)
    FROM unnest(COALESCE(p_role_keys, ARRAY[]::text[])) AS x
    WHERE btrim(x) <> ''
  );

  IF array_length(v_roles, 1) IS NULL THEN
    RAISE EXCEPTION 'at least one role is required' USING ERRCODE = '22023';
  END IF;

  SELECT array_agg(x) INTO unknown_roles
  FROM unnest(v_roles) x
  WHERE NOT EXISTS (SELECT 1 FROM public.admin_roles r WHERE r.key = x);

  IF unknown_roles IS NOT NULL THEN
    RAISE EXCEPTION 'unknown role(s): %', array_to_string(unknown_roles, ', ') USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(array_agg(DISTINCT r.key ORDER BY r.key), ARRAY[]::text[])
  INTO old_roles
  FROM public.admin_user_roles ur
  JOIN public.admin_roles r ON r.id = ur.role_id
  WHERE ur.user_id = p_user;

  old_has_super := 'super_admin' = ANY(old_roles);
  new_has_super := 'super_admin' = ANY(v_roles);

  IF old_has_super = new_has_super THEN
    RAISE EXCEPTION 'approval request is only required for super_admin changes' USING ERRCODE = '22023';
  END IF;

  -- Guardrail: cannot remove the last user who has admin_access.manage.
  SELECT EXISTS (
    SELECT 1
    FROM public.admin_user_roles ur
    JOIN public.admin_role_permissions rp ON rp.role_id = ur.role_id
    JOIN public.admin_permissions p ON p.id = rp.permission_id
    WHERE ur.user_id = p_user
      AND p.key = 'admin_access.manage'
  ) INTO target_had_manage;

  SELECT COUNT(DISTINCT ur.user_id)
  FROM public.admin_user_roles ur
  JOIN public.admin_role_permissions rp ON rp.role_id = ur.role_id
  JOIN public.admin_permissions p ON p.id = rp.permission_id
  WHERE p.key = 'admin_access.manage'
  INTO manage_user_count;

  SELECT public.admin_role_keys_have_permission(v_roles, 'admin_access.manage')
  INTO new_has_manage;

  IF target_had_manage AND (NOT new_has_manage) AND manage_user_count = 1 THEN
    RAISE EXCEPTION 'cannot remove last admin_access.manage user' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.admin_role_change_requests(
    created_by,
    target_user_id,
    requested_role_keys,
    note,
    status
  ) VALUES (
    actor,
    p_user,
    v_roles,
    p_note,
    'pending'
  )
  RETURNING id INTO req_id;

  INSERT INTO public.admin_audit_log(actor_id, action, target_user_id, note, details)
  VALUES (
    actor,
    'request_admin_role_change',
    p_user,
    p_note,
    jsonb_build_object(
      'request_id', req_id,
      'old_roles', old_roles,
      'new_roles', v_roles,
      'source', 'request'
    )
  );

  RETURN jsonb_build_object('ok', true, 'request_id', req_id);
END;
$$;
CREATE OR REPLACE FUNCTION public.admin_approve_role_change_request_v1(
  p_request_id uuid,
  p_note text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  actor uuid := auth.uid();
  req record;
  v_roles text[];
  unknown_roles text[];
  role_ids bigint[];
  old_roles text[];

  target_had_manage boolean;
  new_has_manage boolean;
  manage_user_count integer;

  ttl interval := interval '7 days';
BEGIN
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'p_request_id is required' USING ERRCODE = '22004';
  END IF;

  IF NOT public.admin_has_permission('admin_access.manage') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  PERFORM public.admin_throttle_action_v1('admin.approve_role_change_request', 30, 3600);

  SELECT * INTO req
  FROM public.admin_role_change_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF req IS NULL THEN
    RAISE EXCEPTION 'request not found' USING ERRCODE = '22023';
  END IF;

  IF req.status <> 'pending' THEN
    RAISE EXCEPTION 'request is not pending' USING ERRCODE = '22023';
  END IF;

  IF req.created_by = actor THEN
    RAISE EXCEPTION 'two-person approval required' USING ERRCODE = '22023';
  END IF;

  -- Expiry: approval must occur within TTL window.
  IF req.created_at < now() - ttl THEN
    RAISE EXCEPTION 'request expired' USING ERRCODE = '22023';
  END IF;

  v_roles := req.requested_role_keys;

  -- Validate role keys still exist.
  SELECT array_agg(x) INTO unknown_roles
  FROM unnest(v_roles) x
  WHERE NOT EXISTS (SELECT 1 FROM public.admin_roles r WHERE r.key = x);

  IF unknown_roles IS NOT NULL THEN
    RAISE EXCEPTION 'unknown role(s): %', array_to_string(unknown_roles, ', ') USING ERRCODE = '22023';
  END IF;

  SELECT array_agg(r.id) INTO role_ids
  FROM public.admin_roles r
  WHERE r.key = ANY(v_roles);

  -- Compute old roles for audit and validation.
  SELECT COALESCE(array_agg(DISTINCT r.key ORDER BY r.key), ARRAY[]::text[])
  INTO old_roles
  FROM public.admin_user_roles ur
  JOIN public.admin_roles r ON r.id = ur.role_id
  WHERE ur.user_id = req.target_user_id;

  -- Guardrail: do not allow removing the last user who has admin_access.manage.
  SELECT EXISTS (
    SELECT 1
    FROM public.admin_user_roles ur
    JOIN public.admin_role_permissions rp ON rp.role_id = ur.role_id
    JOIN public.admin_permissions p ON p.id = rp.permission_id
    WHERE ur.user_id = req.target_user_id
      AND p.key = 'admin_access.manage'
  ) INTO target_had_manage;

  SELECT COUNT(DISTINCT ur.user_id)
  FROM public.admin_user_roles ur
  JOIN public.admin_role_permissions rp ON rp.role_id = ur.role_id
  JOIN public.admin_permissions p ON p.id = rp.permission_id
  WHERE p.key = 'admin_access.manage'
  INTO manage_user_count;

  SELECT public.admin_role_keys_have_permission(v_roles, 'admin_access.manage')
  INTO new_has_manage;

  IF target_had_manage AND (NOT new_has_manage) AND manage_user_count = 1 THEN
    RAISE EXCEPTION 'cannot remove last admin_access.manage user' USING ERRCODE = '22023';
  END IF;

  -- Apply role assignments (bypassing super_admin direct-change block).
  DELETE FROM public.admin_user_roles WHERE user_id = req.target_user_id;

  INSERT INTO public.admin_user_roles(user_id, role_id, granted_by, note)
  SELECT req.target_user_id, rid, actor, p_note
  FROM unnest(role_ids) AS rid;

  UPDATE public.admin_role_change_requests
  SET status = 'executed',
      approved_by = actor,
      approved_at = now(),
      executed_by = actor,
      executed_at = now()
  WHERE id = p_request_id;

  -- Audit: record the executed change.
  INSERT INTO public.admin_audit_log(actor_id, action, target_user_id, note, details)
  VALUES (
    actor,
    'set_admin_roles',
    req.target_user_id,
    p_note,
    jsonb_build_object(
      'request_id', p_request_id,
      'old_roles', old_roles,
      'new_roles', v_roles,
      'source', 'approved_request'
    )
  );

  RETURN jsonb_build_object('ok', true, 'request_id', p_request_id, 'status', 'executed');
END;
$$;
-- 6) Patch direct role setter with throttling (non-super_admin changes)
CREATE OR REPLACE FUNCTION public.admin_set_user_roles_v1(
  p_user uuid,
  p_role_keys text[],
  p_note text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  actor uuid := auth.uid();
  v_roles text[];
  role_ids bigint[];
  unknown_roles text[];

  old_roles text[];
  old_has_super boolean;
  new_has_super boolean;

  target_had_manage boolean;
  new_has_manage boolean;
  manage_user_count integer;
BEGIN
  IF p_user IS NULL THEN
    RAISE EXCEPTION 'p_user is required' USING ERRCODE = '22004';
  END IF;

  IF NOT public.admin_has_permission('admin_access.manage') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  PERFORM public.admin_throttle_action_v1('admin.set_user_roles', 60, 3600);

  IF NOT public.is_admin(p_user) THEN
    RAISE EXCEPTION 'target user is not an admin' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(array_agg(DISTINCT r.key ORDER BY r.key), ARRAY[]::text[])
  INTO old_roles
  FROM public.admin_user_roles ur
  JOIN public.admin_roles r ON r.id = ur.role_id
  WHERE ur.user_id = p_user;

  v_roles := ARRAY(
    SELECT DISTINCT btrim(x)
    FROM unnest(COALESCE(p_role_keys, ARRAY[]::text[])) AS x
    WHERE btrim(x) <> ''
  );

  IF array_length(v_roles, 1) IS NULL THEN
    RAISE EXCEPTION 'at least one role is required' USING ERRCODE = '22023';
  END IF;

  SELECT array_agg(x) INTO unknown_roles
  FROM unnest(v_roles) x
  WHERE NOT EXISTS (SELECT 1 FROM public.admin_roles r WHERE r.key = x);

  IF unknown_roles IS NOT NULL THEN
    RAISE EXCEPTION 'unknown role(s): %', array_to_string(unknown_roles, ', ') USING ERRCODE = '22023';
  END IF;

  SELECT array_agg(r.id) INTO role_ids
  FROM public.admin_roles r
  WHERE r.key = ANY(v_roles);

  -- Guardrail: do not allow removing the last user who has admin_access.manage.
  SELECT EXISTS (
    SELECT 1
    FROM public.admin_user_roles ur
    JOIN public.admin_role_permissions rp ON rp.role_id = ur.role_id
    JOIN public.admin_permissions p ON p.id = rp.permission_id
    WHERE ur.user_id = p_user
      AND p.key = 'admin_access.manage'
  ) INTO target_had_manage;

  SELECT COUNT(DISTINCT ur.user_id)
  FROM public.admin_user_roles ur
  JOIN public.admin_role_permissions rp ON rp.role_id = ur.role_id
  JOIN public.admin_permissions p ON p.id = rp.permission_id
  WHERE p.key = 'admin_access.manage'
  INTO manage_user_count;

  SELECT public.admin_role_keys_have_permission(v_roles, 'admin_access.manage')
  INTO new_has_manage;

  IF target_had_manage AND (NOT new_has_manage) AND manage_user_count = 1 THEN
    RAISE EXCEPTION 'cannot remove last admin_access.manage user' USING ERRCODE = '22023';
  END IF;

  -- Super-admin changes require 2-person approval.
  old_has_super := 'super_admin' = ANY(old_roles);
  new_has_super := 'super_admin' = ANY(v_roles);
  IF old_has_super <> new_has_super THEN
    RAISE EXCEPTION 'super_admin changes require approval request' USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.admin_user_roles WHERE user_id = p_user;

  INSERT INTO public.admin_user_roles(user_id, role_id, granted_by, note)
  SELECT p_user, rid, actor, p_note
  FROM unnest(role_ids) AS rid;

  INSERT INTO public.admin_audit_log(actor_id, action, target_user_id, note, details)
  VALUES (
    actor,
    'set_admin_roles',
    p_user,
    p_note,
    jsonb_build_object(
      'old_roles', old_roles,
      'new_roles', v_roles,
      'source', 'direct'
    )
  );

  RETURN jsonb_build_object('ok', true, 'user_id', p_user, 'roles', v_roles);
END;
$$;
-- Explicit grants (hardening migration will still enforce allowlist)
GRANT EXECUTE ON FUNCTION public.admin_list_role_change_requests_v2(text, integer, integer, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_reject_role_change_request_v1(uuid, text) TO authenticated, service_role;
COMMIT;
