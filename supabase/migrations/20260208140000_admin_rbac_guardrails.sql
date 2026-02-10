BEGIN;

-- Session 4: RBAC guardrails
-- - Prevent removing the last user who has admin_access.manage.
-- - Keep behavior centralized in DB (server-side enforcement).

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

  target_had_manage boolean;
  new_has_manage boolean;
  manage_user_count integer;
BEGIN
  IF p_user IS NULL THEN
    RAISE EXCEPTION 'p_user is required' USING ERRCODE = '22004';
  END IF;

  -- Only users who currently have admin_access.manage can edit admin roles.
  IF NOT public.admin_has_permission('admin_access.manage') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF NOT public.is_admin(p_user) THEN
    RAISE EXCEPTION 'target user is not an admin' USING ERRCODE = '22023';
  END IF;

  v_roles := ARRAY(
    SELECT DISTINCT btrim(x)
    FROM unnest(COALESCE(p_role_keys, ARRAY[]::text[])) AS x
    WHERE btrim(x) <> ''
  );

  -- Require at least one role.
  IF array_length(v_roles, 1) IS NULL THEN
    RAISE EXCEPTION 'at least one role is required' USING ERRCODE = '22023';
  END IF;

  -- Detect unknown role keys.
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

  SELECT EXISTS (
    SELECT 1
    FROM public.admin_roles r
    JOIN public.admin_role_permissions rp ON rp.role_id = r.id
    JOIN public.admin_permissions p ON p.id = rp.permission_id
    WHERE r.key = ANY(v_roles)
      AND p.key = 'admin_access.manage'
  ) INTO new_has_manage;

  IF target_had_manage AND (NOT new_has_manage) AND manage_user_count = 1 THEN
    RAISE EXCEPTION 'cannot remove last admin_access.manage user' USING ERRCODE = '22023';
  END IF;

  -- Replace assignments.
  DELETE FROM public.admin_user_roles WHERE user_id = p_user;

  INSERT INTO public.admin_user_roles(user_id, role_id, granted_by, note)
  SELECT p_user, rid, actor, p_note
  FROM unnest(role_ids) AS rid;

  -- Audit
  INSERT INTO public.admin_audit_log(actor_id, action, target_user_id, note)
  VALUES (actor, 'set_admin_roles', p_user, COALESCE(p_note,'') || ' roles=' || array_to_string(v_roles, ','));

  RETURN jsonb_build_object(
    'ok', true,
    'user_id', p_user,
    'roles', v_roles
  );
END;
$$;

-- Explicit grants (hardening migration will still enforce allowlist)
GRANT EXECUTE ON FUNCTION public.admin_set_user_roles_v1(uuid, text[], text) TO authenticated, service_role;

COMMIT;
