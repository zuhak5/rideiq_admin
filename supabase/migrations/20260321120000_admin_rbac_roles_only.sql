BEGIN;

-- Unify admin access on RBAC role assignments only.
-- Legacy admin_users membership and profiles.is_admin are removed in this rollout.

-- 1) Backfill any remaining legacy admins into legacy_admin before removing legacy state.
DO $$
DECLARE
  legacy_role_id bigint;
BEGIN
  SELECT id INTO legacy_role_id
  FROM public.admin_roles
  WHERE key = 'legacy_admin';

  IF legacy_role_id IS NULL THEN
    RAISE EXCEPTION 'legacy_admin role missing';
  END IF;

  IF to_regclass('public.admin_users') IS NOT NULL THEN
    INSERT INTO public.admin_user_roles (user_id, role_id, granted_by, note)
    SELECT au.user_id, legacy_role_id, NULL, 'roles_only_backfill:admin_users'
    FROM public.admin_users au
    JOIN public.profiles p ON p.id = au.user_id
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.admin_user_roles ur
      WHERE ur.user_id = au.user_id
        AND ur.role_id = legacy_role_id
    );
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'profiles'
      AND column_name = 'is_admin'
  ) THEN
    INSERT INTO public.admin_user_roles (user_id, role_id, granted_by, note)
    SELECT p.id, legacy_role_id, NULL, 'roles_only_backfill:profiles.is_admin'
    FROM public.profiles p
    WHERE COALESCE(p.is_admin, false) = true
      AND NOT EXISTS (
        SELECT 1
        FROM public.admin_user_roles ur
        WHERE ur.user_id = p.id
          AND ur.role_id = legacy_role_id
      );
  END IF;
END
$$;

-- 2) RBAC role assignments are now the only admin source of truth.
CREATE OR REPLACE FUNCTION public.is_admin(p_user uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.admin_user_roles ur
    WHERE ur.user_id = p_user
  );
$$;

CREATE OR REPLACE FUNCTION public.is_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT public.is_admin(auth.uid());
$$;

-- 3) Admin access management now searches profiles and shows current role assignments,
--    including non-admin users who may be promoted.
CREATE OR REPLACE FUNCTION public.admin_list_admin_access_v1(
  p_q text DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS TABLE(
  user_id uuid,
  display_name text,
  phone text,
  roles text[]
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  q text := NULLIF(btrim(COALESCE(p_q, '')), '');
  lim integer := LEAST(200, GREATEST(1, COALESCE(p_limit, 50)));
  off integer := GREATEST(0, COALESCE(p_offset, 0));
  is_uuid_query boolean := false;
BEGIN
  IF NOT public.admin_has_permission('admin_access.manage') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF q IS NOT NULL THEN
    is_uuid_query := q ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
  END IF;

  RETURN QUERY
  WITH role_map AS (
    SELECT
      ur.user_id,
      array_agg(DISTINCT r.key ORDER BY r.key) AS roles
    FROM public.admin_user_roles ur
    JOIN public.admin_roles r ON r.id = ur.role_id
    GROUP BY ur.user_id
  ),
  matched AS (
    SELECT
      p.id,
      p.display_name,
      p.phone,
      p.created_at,
      COALESCE(rm.roles, ARRAY[]::text[]) AS roles
    FROM public.profiles p
    LEFT JOIN role_map rm ON rm.user_id = p.id
    WHERE q IS NULL
       OR (is_uuid_query AND p.id = q::uuid)
       OR p.display_name ILIKE ('%' || q || '%')
       OR p.phone ILIKE ('%' || q || '%')
    ORDER BY
      CASE WHEN COALESCE(array_length(rm.roles, 1), 0) > 0 THEN 0 ELSE 1 END,
      p.created_at DESC,
      p.id
    OFFSET off
    LIMIT lim
  )
  SELECT
    m.id,
    m.display_name,
    m.phone,
    m.roles
  FROM matched m;
END;
$$;

-- 4) RBAC role changes are the only mutation path. Empty role arrays revoke all admin access.
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

  PERFORM 1
  FROM public.profiles p
  WHERE p.id = p_user;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'target user not found' USING ERRCODE = '22023';
  END IF;

  v_roles := ARRAY(
    SELECT DISTINCT btrim(x)
    FROM unnest(COALESCE(p_role_keys, ARRAY[]::text[])) AS x
    WHERE btrim(x) <> ''
  );

  SELECT array_agg(x) INTO unknown_roles
  FROM unnest(v_roles) x
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.admin_roles r
    WHERE r.key = x
  );

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

  SELECT EXISTS (
    SELECT 1
    FROM public.admin_user_roles ur
    JOIN public.admin_role_permissions rp ON rp.role_id = ur.role_id
    JOIN public.admin_permissions p ON p.id = rp.permission_id
    WHERE ur.user_id = p_user
      AND p.key = 'admin_access.manage'
  ) INTO target_had_manage;

  SELECT COUNT(DISTINCT ur.user_id)
  INTO manage_user_count
  FROM public.admin_user_roles ur
  JOIN public.admin_role_permissions rp ON rp.role_id = ur.role_id
  JOIN public.admin_permissions p ON p.id = rp.permission_id
  WHERE p.key = 'admin_access.manage';

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

  SELECT *
  INTO req
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

  IF req.created_at < now() - ttl THEN
    RAISE EXCEPTION 'request expired' USING ERRCODE = '22023';
  END IF;

  v_roles := req.requested_role_keys;

  SELECT array_agg(x) INTO unknown_roles
  FROM unnest(v_roles) x
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.admin_roles r
    WHERE r.key = x
  );

  IF unknown_roles IS NOT NULL THEN
    RAISE EXCEPTION 'unknown role(s): %', array_to_string(unknown_roles, ', ') USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(array_agg(r.id), ARRAY[]::bigint[])
  INTO role_ids
  FROM public.admin_roles r
  WHERE r.key = ANY(v_roles);

  SELECT COALESCE(array_agg(DISTINCT r.key ORDER BY r.key), ARRAY[]::text[])
  INTO old_roles
  FROM public.admin_user_roles ur
  JOIN public.admin_roles r ON r.id = ur.role_id
  WHERE ur.user_id = req.target_user_id;

  SELECT EXISTS (
    SELECT 1
    FROM public.admin_user_roles ur
    JOIN public.admin_role_permissions rp ON rp.role_id = ur.role_id
    JOIN public.admin_permissions p ON p.id = rp.permission_id
    WHERE ur.user_id = req.target_user_id
      AND p.key = 'admin_access.manage'
  ) INTO target_had_manage;

  SELECT COUNT(DISTINCT ur.user_id)
  INTO manage_user_count
  FROM public.admin_user_roles ur
  JOIN public.admin_role_permissions rp ON rp.role_id = ur.role_id
  JOIN public.admin_permissions p ON p.id = rp.permission_id
  WHERE p.key = 'admin_access.manage';

  SELECT public.admin_role_keys_have_permission(v_roles, 'admin_access.manage')
  INTO new_has_manage;

  IF target_had_manage AND (NOT new_has_manage) AND manage_user_count = 1 THEN
    RAISE EXCEPTION 'cannot remove last admin_access.manage user' USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.admin_user_roles
  WHERE user_id = req.target_user_id;

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

  PERFORM 1
  FROM public.profiles p
  WHERE p.id = p_user;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'target user not found' USING ERRCODE = '22023';
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

  SELECT array_agg(x) INTO unknown_roles
  FROM unnest(v_roles) x
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.admin_roles r
    WHERE r.key = x
  );

  IF unknown_roles IS NOT NULL THEN
    RAISE EXCEPTION 'unknown role(s): %', array_to_string(unknown_roles, ', ') USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(array_agg(r.id), ARRAY[]::bigint[])
  INTO role_ids
  FROM public.admin_roles r
  WHERE r.key = ANY(v_roles);

  SELECT EXISTS (
    SELECT 1
    FROM public.admin_user_roles ur
    JOIN public.admin_role_permissions rp ON rp.role_id = ur.role_id
    JOIN public.admin_permissions p ON p.id = rp.permission_id
    WHERE ur.user_id = p_user
      AND p.key = 'admin_access.manage'
  ) INTO target_had_manage;

  SELECT COUNT(DISTINCT ur.user_id)
  INTO manage_user_count
  FROM public.admin_user_roles ur
  JOIN public.admin_role_permissions rp ON rp.role_id = ur.role_id
  JOIN public.admin_permissions p ON p.id = rp.permission_id
  WHERE p.key = 'admin_access.manage';

  SELECT public.admin_role_keys_have_permission(v_roles, 'admin_access.manage')
  INTO new_has_manage;

  IF target_had_manage AND (NOT new_has_manage) AND manage_user_count = 1 THEN
    RAISE EXCEPTION 'cannot remove last admin_access.manage user' USING ERRCODE = '22023';
  END IF;

  old_has_super := 'super_admin' = ANY(old_roles);
  new_has_super := 'super_admin' = ANY(v_roles);

  IF old_has_super <> new_has_super THEN
    RAISE EXCEPTION 'super_admin changes require approval request' USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.admin_user_roles
  WHERE user_id = p_user;

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

GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_admin(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_admin_access_v1(text, integer, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_create_role_change_request_v1(uuid, text[], text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_approve_role_change_request_v1(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_user_roles_v1(uuid, text[], text) TO authenticated, service_role;

-- 5) Remove legacy mutation endpoints and compatibility sync.
DROP FUNCTION IF EXISTS public.admin_grant_user(uuid, text);
DROP FUNCTION IF EXISTS public.admin_grant_user_v1(uuid, text);
DROP FUNCTION IF EXISTS public.admin_revoke_user(uuid, text);
DROP FUNCTION IF EXISTS public.admin_revoke_user_v1(uuid, text);

DO $$
BEGIN
  IF to_regclass('public.admin_users') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS trg_rbac_admin_users_insert ON public.admin_users';
    EXECUTE 'DROP TRIGGER IF EXISTS trg_rbac_admin_users_delete ON public.admin_users';
  END IF;
END
$$;

DROP FUNCTION IF EXISTS public._rbac_sync_on_admin_users_insert();
DROP FUNCTION IF EXISTS public._rbac_sync_on_admin_users_delete();
DROP TABLE IF EXISTS public.admin_users;
ALTER TABLE public.profiles DROP COLUMN IF EXISTS is_admin;

COMMIT;
