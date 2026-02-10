-- Fix Performance Advisor lint (auth_rls_initplan):
-- Wrap auth.<function>() calls in a scalar subquery so Postgres can initplan it
-- instead of re-evaluating per-row.

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'support_internal_notes'
      AND policyname = 'support_internal_notes_admin_insert'
  ) THEN
    ALTER POLICY support_internal_notes_admin_insert
      ON public.support_internal_notes
      WITH CHECK (
        public.admin_has_permission('support.manage')
        AND author_id = (SELECT auth.uid())
      );
  END IF;
END $$;

COMMIT;

