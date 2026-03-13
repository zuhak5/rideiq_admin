-- Predeploy fix (Session 16): admin_audit_log.details
--
-- Several RBAC/ops migrations and admin-api routes record structured audit payloads.
-- Ensure the admin_audit_log table includes a JSONB "details" column before those
-- functions are created.

BEGIN;
ALTER TABLE public.admin_audit_log
  ADD COLUMN IF NOT EXISTS details jsonb;
COMMIT;
