-- Performance hardening: add missing indexes for foreign keys.
--
-- These indexes speed up joins and cascading deletes/updates, and they reduce
-- lock contention on parent tables.

CREATE INDEX IF NOT EXISTS ix_admin_role_change_requests_approved_by
  ON public.admin_role_change_requests USING btree (approved_by);
CREATE INDEX IF NOT EXISTS ix_admin_role_change_requests_created_by
  ON public.admin_role_change_requests USING btree (created_by);
CREATE INDEX IF NOT EXISTS ix_admin_role_change_requests_executed_by
  ON public.admin_role_change_requests USING btree (executed_by);
CREATE INDEX IF NOT EXISTS ix_admin_role_change_requests_target_user_id
  ON public.admin_role_change_requests USING btree (target_user_id);
CREATE INDEX IF NOT EXISTS ix_admin_role_permissions_permission_id
  ON public.admin_role_permissions USING btree (permission_id);
CREATE INDEX IF NOT EXISTS ix_admin_user_roles_granted_by
  ON public.admin_user_roles USING btree (granted_by);
CREATE INDEX IF NOT EXISTS ix_payment_refund_idempotency_actor_id
  ON public.payment_refund_idempotency USING btree (actor_id);
CREATE INDEX IF NOT EXISTS ix_payment_refund_idempotency_payment_id
  ON public.payment_refund_idempotency USING btree (payment_id);
CREATE INDEX IF NOT EXISTS ix_payment_refund_idempotency_ride_id
  ON public.payment_refund_idempotency USING btree (ride_id);
