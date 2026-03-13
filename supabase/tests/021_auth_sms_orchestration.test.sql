BEGIN;

SELECT plan(6);

SELECT public.auth_sms_provider_health_reset_v1('otpiq');

SELECT is(
  public.auth_sms_hook_claim_v1(
    'auth-sms-webhook-021-a',
    '00000000-0000-0000-0000-000000000041'::uuid,
    '+9647700000041',
    60
  ),
  'claimed',
  'first webhook claim acquires ownership'
);

SELECT is(
  public.auth_sms_hook_claim_v1(
    'auth-sms-webhook-021-a',
    '00000000-0000-0000-0000-000000000041'::uuid,
    '+9647700000041',
    60
  ),
  'skip_processing',
  'second live claim is deduped while processing'
);

SELECT public.auth_sms_hook_complete_v1(
  'auth-sms-webhook-021-a',
  'sent',
  'otpiq',
  null,
  200,
  null,
  '[{"provider":"otpiq","ok":true,"http_status":200,"provider_error_code":null,"retryable":false,"message_id":"msg-1","error":null,"raw":{"smsId":"msg-1"}}]'::jsonb,
  1
);

SELECT is(
  public.auth_sms_hook_claim_v1(
    'auth-sms-webhook-021-a',
    '00000000-0000-0000-0000-000000000041'::uuid,
    '+9647700000041',
    60
  ),
  'skip_sent',
  'sent webhooks never resend on duplicate delivery'
);

SELECT public.auth_sms_provider_health_on_failure_v1(
  'otpiq',
  503,
  'upstream_timeout',
  30
);

SELECT ok(
  (
    SELECT
      NOT available
      AND consecutive_failures = 1
      AND last_http_status = 503
      AND last_error_code = 'upstream_timeout'
    FROM public.auth_sms_provider_health_status_v1('otpiq')
  ),
  'provider health failure opens cooldown with structured status'
);

SELECT public.auth_sms_provider_health_on_success_v1('otpiq');

SELECT ok(
  (
    SELECT
      available
      AND consecutive_failures = 0
      AND last_http_status IS NULL
      AND last_error_code IS NULL
    FROM public.auth_sms_provider_health_status_v1('otpiq')
  ),
  'provider health success clears the cooldown state'
);

SELECT public.auth_sms_hook_claim_v1(
  'auth-sms-webhook-021-b',
  '00000000-0000-0000-0000-000000000042'::uuid,
  '+9647700000042',
  60
);

SELECT public.auth_sms_hook_complete_v1(
  'auth-sms-webhook-021-b',
  'failed',
  'otpiq',
  'provider timeout',
  503,
  'upstream_timeout',
  '[{"provider":"otpiq","ok":false,"http_status":503,"provider_error_code":"upstream_timeout","retryable":true,"message_id":null,"error":"provider timeout","raw":"timeout"}]'::jsonb,
  1
);

SELECT is(
  public.auth_sms_hook_claim_v1(
    'auth-sms-webhook-021-b',
    '00000000-0000-0000-0000-000000000042'::uuid,
    '+9647700000042',
    60
  ),
  'reclaimed_failed',
  'failed webhook rows can be reclaimed for retry'
);

SELECT * FROM finish();

ROLLBACK;
