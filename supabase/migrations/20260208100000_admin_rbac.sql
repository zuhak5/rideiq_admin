-- Admin RBAC (roles/permissions)
--
-- Goals
--  - Add explicit roles + permissions for the admin dashboard.
--  - Preserve backward compatibility with existing admin_users membership and public.is_admin().
--  - Keep server-side enforcement as the source of truth.
--
-- Implementation notes
--  - SECURITY DEFINER functions pin search_path to '' and fully-qualify object references.
--    This is a recommended hardening practice for SECURITY DEFINER. 
--  - Existing "grant/revoke admin" RPCs keep working; triggers keep RBAC in sync.

BEGIN;
-- 1) Reference tables
CREATE TABLE IF NOT EXISTS public.admin_roles (
  id           bigserial PRIMARY KEY,
  key          text NOT NULL UNIQUE CHECK (key ~ '^[a-z0-9_]+$'),
  name         text NOT NULL,
  description  text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.admin_permissions (
  id           bigserial PRIMARY KEY,
  key          text NOT NULL UNIQUE CHECK (key ~ '^[a-z0-9_.]+$'),
  name         text NOT NULL,
  description  text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.admin_role_permissions (
  role_id       bigint NOT NULL REFERENCES public.admin_roles(id) ON DELETE CASCADE,
  permission_id bigint NOT NULL REFERENCES public.admin_permissions(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (role_id, permission_id)
);
CREATE TABLE IF NOT EXISTS public.admin_user_roles (
  user_id     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role_id     bigint NOT NULL REFERENCES public.admin_roles(id) ON DELETE CASCADE,
  granted_by  uuid REFERENCES public.profiles(id),
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role_id)
);
CREATE INDEX IF NOT EXISTS ix_admin_user_roles_user_id ON public.admin_user_roles(user_id);
CREATE INDEX IF NOT EXISTS ix_admin_user_roles_role_id ON public.admin_user_roles(role_id);
ALTER TABLE public.admin_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_user_roles ENABLE ROW LEVEL SECURITY;
-- RLS: only admins can read; only service_role can mutate tables directly.
DO $$
BEGIN
  -- admin_roles
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='admin_roles' AND policyname='admin_roles_admin_select'
  ) THEN
    EXECUTE $policy$CREATE POLICY admin_roles_admin_select ON public.admin_roles
      FOR SELECT TO authenticated
      USING ((SELECT public.is_admin()));$policy$;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='admin_roles' AND policyname='admin_roles_service_role_all'
  ) THEN
    EXECUTE $policy$CREATE POLICY admin_roles_service_role_all ON public.admin_roles
      TO service_role USING (true) WITH CHECK (true);$policy$;
  END IF;

  -- admin_permissions
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='admin_permissions' AND policyname='admin_permissions_admin_select'
  ) THEN
    EXECUTE $policy$CREATE POLICY admin_permissions_admin_select ON public.admin_permissions
      FOR SELECT TO authenticated
      USING ((SELECT public.is_admin()));$policy$;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='admin_permissions' AND policyname='admin_permissions_service_role_all'
  ) THEN
    EXECUTE $policy$CREATE POLICY admin_permissions_service_role_all ON public.admin_permissions
      TO service_role USING (true) WITH CHECK (true);$policy$;
  END IF;

  -- admin_role_permissions
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='admin_role_permissions' AND policyname='admin_role_permissions_admin_select'
  ) THEN
    EXECUTE $policy$CREATE POLICY admin_role_permissions_admin_select ON public.admin_role_permissions
      FOR SELECT TO authenticated
      USING ((SELECT public.is_admin()));$policy$;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='admin_role_permissions' AND policyname='admin_role_permissions_service_role_all'
  ) THEN
    EXECUTE $policy$CREATE POLICY admin_role_permissions_service_role_all ON public.admin_role_permissions
      TO service_role USING (true) WITH CHECK (true);$policy$;
  END IF;

  -- admin_user_roles
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='admin_user_roles' AND policyname='admin_user_roles_admin_select'
  ) THEN
    EXECUTE $policy$CREATE POLICY admin_user_roles_admin_select ON public.admin_user_roles
      FOR SELECT TO authenticated
      USING ((SELECT public.is_admin()));$policy$;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='admin_user_roles' AND policyname='admin_user_roles_service_role_all'
  ) THEN
    EXECUTE $policy$CREATE POLICY admin_user_roles_service_role_all ON public.admin_user_roles
      TO service_role USING (true) WITH CHECK (true);$policy$;
  END IF;
END$$;
-- 2) Seed permissions (idempotent)
INSERT INTO public.admin_permissions (key, name, description) VALUES
  ('dashboard.view', 'View dashboard', 'Access summary dashboard metrics'),
  ('users.read', 'Read users', 'List user profiles and admin access status'),
  ('admin_access.manage', 'Manage admin access', 'Grant/revoke admin and assign admin roles'),
  ('ops.view', 'View ops dashboard', 'Access operational dashboards/alerts'),
  ('fraud.view', 'View fraud', 'Access fraud cases and enforcement actions'),
  ('fraud.manage', 'Manage fraud', 'Resolve/close fraud cases and actions'),
  ('audit.read', 'Read audit log', 'Access admin audit log')
ON CONFLICT (key) DO NOTHING;
-- 3) Seed roles (idempotent)
INSERT INTO public.admin_roles (key, name, description) VALUES
  ('super_admin', 'Super Admin', 'Full access to all admin capabilities'),
  ('legacy_admin', 'Legacy Admin', 'Backward-compatible full access for existing admins'),
  ('ops_admin', 'Ops Admin', 'Operational dashboards and alerts'),
  ('fraud_admin', 'Fraud Admin', 'Fraud investigations and enforcement actions'),
  ('user_admin', 'User Admin', 'User/admin access management'),
  ('auditor', 'Auditor', 'Read-only audit access')
ON CONFLICT (key) DO NOTHING;
-- 4) Role -> permission grants (idempotent)
-- Helper CTEs for readable inserts
WITH r AS (SELECT id, key FROM public.admin_roles),
     p AS (SELECT id, key FROM public.admin_permissions)
INSERT INTO public.admin_role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM r
JOIN p ON (
  -- super_admin: all
  (r.key = 'super_admin')
  OR
  -- legacy_admin: all
  (r.key = 'legacy_admin')
  OR
  -- ops_admin
  (r.key = 'ops_admin' AND p.key IN ('dashboard.view','ops.view'))
  OR
  -- fraud_admin
  (r.key = 'fraud_admin' AND p.key IN ('dashboard.view','fraud.view','fraud.manage'))
  OR
  -- user_admin
  (r.key = 'user_admin' AND p.key IN ('dashboard.view','users.read','admin_access.manage','audit.read'))
  OR
  -- auditor
  (r.key = 'auditor' AND p.key IN ('audit.read'))
)
ON CONFLICT DO NOTHING;
-- 5) Backfill existing admins into legacy_admin role
INSERT INTO public.admin_user_roles (user_id, role_id, granted_by, note)
SELECT au.user_id, r.id, NULL, 'rbac_backfill:admin_users'
FROM public.admin_users au
JOIN public.admin_roles r ON r.key = 'legacy_admin'
WHERE NOT EXISTS (
  SELECT 1 FROM public.admin_user_roles ur
  WHERE ur.user_id = au.user_id AND ur.role_id = r.id
);
-- Backfill from profiles.is_admin if it exists.
DO $$
DECLARE
  has_is_admin boolean := false;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name='profiles' AND column_name='is_admin'
  ) INTO has_is_admin;

  IF has_is_admin THEN
    INSERT INTO public.admin_user_roles (user_id, role_id, granted_by, note)
    SELECT p.id, r.id, NULL, 'rbac_backfill:profiles.is_admin'
    FROM public.profiles p
    JOIN public.admin_roles r ON r.key = 'legacy_admin'
    WHERE COALESCE(p.is_admin,false) = true
      AND NOT EXISTS (
        SELECT 1 FROM public.admin_user_roles ur
        WHERE ur.user_id = p.id AND ur.role_id = r.id
      );
  END IF;
END$$;
-- 6) Keep RBAC in sync with admin_users (backward compatibility)
CREATE OR REPLACE FUNCTION public._rbac_sync_on_admin_users_insert() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  legacy_role_id bigint;
BEGIN
  SELECT id INTO legacy_role_id FROM public.admin_roles WHERE key = 'legacy_admin';
  IF legacy_role_id IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.admin_user_roles(user_id, role_id, granted_by, note)
  VALUES (NEW.user_id, legacy_role_id, NEW.created_by, COALESCE(NEW.note,'rbac_sync'))
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$;
CREATE OR REPLACE FUNCTION public._rbac_sync_on_admin_users_delete() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  DELETE FROM public.admin_user_roles WHERE user_id = OLD.user_id;
  RETURN OLD;
END;
$$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_rbac_admin_users_insert'
  ) THEN
    CREATE TRIGGER trg_rbac_admin_users_insert
      AFTER INSERT ON public.admin_users
      FOR EACH ROW
      EXECUTE FUNCTION public._rbac_sync_on_admin_users_insert();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_rbac_admin_users_delete'
  ) THEN
    CREATE TRIGGER trg_rbac_admin_users_delete
      AFTER DELETE ON public.admin_users
      FOR EACH ROW
      EXECUTE FUNCTION public._rbac_sync_on_admin_users_delete();
  END IF;
END$$;
-- 7) Extend audit action enum (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
      AND t.typname = 'admin_audit_action'
      AND e.enumlabel = 'set_admin_roles'
  ) THEN
    ALTER TYPE public.admin_audit_action ADD VALUE 'set_admin_roles';
  END IF;
END$$;
-- 8) RPCs

-- Returns role keys for the current admin.
CREATE OR REPLACE FUNCTION public.admin_my_roles() RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT
    CASE
      WHEN NOT public.is_admin() THEN ARRAY[]::text[]
      ELSE COALESCE(
        (SELECT array_agg(DISTINCT r.key ORDER BY r.key)
         FROM public.admin_user_roles ur
         JOIN public.admin_roles r ON r.id = ur.role_id
         WHERE ur.user_id = auth.uid()),
        ARRAY[]::text[]
      )
    END;
$$;
-- Returns permission keys for the current admin.
CREATE OR REPLACE FUNCTION public.admin_permissions() RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT
    CASE
      WHEN NOT public.is_admin() THEN ARRAY[]::text[]
      ELSE COALESCE(
        (SELECT array_agg(DISTINCT p.key ORDER BY p.key)
         FROM public.admin_user_roles ur
         JOIN public.admin_role_permissions rp ON rp.role_id = ur.role_id
         JOIN public.admin_permissions p ON p.id = rp.permission_id
         WHERE ur.user_id = auth.uid()),
        ARRAY[]::text[]
      )
    END;
$$;
-- Checks whether the current admin has a specific permission.
CREATE OR REPLACE FUNCTION public.admin_has_permission(p_permission text) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  perms text[];
BEGIN
  IF p_permission IS NULL OR btrim(p_permission) = '' THEN
    RETURN false;
  END IF;

  IF NOT public.is_admin() THEN
    RETURN false;
  END IF;

  perms := public.admin_permissions();
  RETURN p_permission = ANY(perms);
END;
$$;
-- List available roles.
CREATE OR REPLACE FUNCTION public.admin_list_roles_v1()
RETURNS TABLE(key text, name text, description text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT r.key, r.name, r.description
  FROM public.admin_roles r
  WHERE public.is_admin()
  ORDER BY r.key;
$$;
-- List admin users + their roles (for admin access management).
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
  q text := NULL;
  lim integer := 50;
  off integer := 0;
BEGIN
  IF NOT public.admin_has_permission('admin_access.manage') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  q := NULLIF(btrim(COALESCE(p_q, '')), '');
  lim := LEAST(200, GREATEST(1, COALESCE(p_limit, 50)));
  off := GREATEST(0, COALESCE(p_offset, 0));

  RETURN QUERY
  WITH base AS (
    SELECT
      au.user_id,
      pr.display_name,
      pr.phone
    FROM public.admin_users au
    JOIN public.profiles pr ON pr.id = au.user_id
    WHERE (q IS NULL)
       OR (pr.display_name ILIKE ('%' || q || '%'))
       OR (pr.phone ILIKE ('%' || q || '%'))
    ORDER BY pr.created_at DESC
    OFFSET off
    LIMIT lim
  )
  SELECT
    b.user_id,
    b.display_name,
    b.phone,
    COALESCE(
      (SELECT array_agg(DISTINCT r.key ORDER BY r.key)
       FROM public.admin_user_roles ur
       JOIN public.admin_roles r ON r.id = ur.role_id
       WHERE ur.user_id = b.user_id),
      ARRAY[]::text[]
    ) AS roles
  FROM base b;
END;
$$;
-- Set roles for a specific admin user.
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
BEGIN
  IF p_user IS NULL THEN
    RAISE EXCEPTION 'p_user is required' USING ERRCODE = '22004';
  END IF;

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

  SELECT array_agg(r.id) INTO role_ids
  FROM public.admin_roles r
  WHERE r.key = ANY(v_roles);

  -- Detect unknown role keys.
  SELECT array_agg(x) INTO unknown_roles
  FROM unnest(v_roles) x
  WHERE NOT EXISTS (SELECT 1 FROM public.admin_roles r WHERE r.key = x);

  IF unknown_roles IS NOT NULL THEN
    RAISE EXCEPTION 'unknown role(s): %', array_to_string(unknown_roles, ', ') USING ERRCODE = '22023';
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
GRANT EXECUTE ON FUNCTION public.admin_my_roles() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_permissions() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_has_permission(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_roles_v1() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_admin_access_v1(text, integer, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_user_roles_v1(uuid, text[], text) TO authenticated, service_role;
COMMIT;
