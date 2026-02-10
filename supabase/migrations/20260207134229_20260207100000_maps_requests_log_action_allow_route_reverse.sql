-- Ensure maps request log action constraint accepts both legacy and current action labels.
-- This fixes deployments where 'route'/'reverse' were excluded by a previous constraint change.

BEGIN;

ALTER TABLE public.maps_requests_log
  DROP CONSTRAINT IF EXISTS maps_requests_log_action_chk;

ALTER TABLE public.maps_requests_log
  ADD CONSTRAINT maps_requests_log_action_chk
  CHECK (
    action IN (
      'route',
      'geocode',
      'reverse',
      'matrix',
      'directions',
      'reverse_geocode',
      'render'
    )
  );

COMMIT;
;
