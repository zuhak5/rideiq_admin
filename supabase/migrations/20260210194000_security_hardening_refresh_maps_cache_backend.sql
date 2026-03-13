-- Grant EXECUTE on newly added allowlisted RPCs.
-- This repo uses deny-by-default for public functions; new RPCs must be re-granted explicitly.

REVOKE ALL ON FUNCTION public.admin_maps_provider_list_v3() FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_maps_provider_list_v3() TO service_role;
GRANT ALL ON FUNCTION public.admin_maps_provider_list_v3() TO authenticated;
REVOKE ALL ON FUNCTION public.admin_maps_provider_set_v3(
  p_provider_code text,
  p_priority integer,
  p_enabled boolean,
  p_language text,
  p_region text,
  p_monthly_soft_cap_units integer,
  p_monthly_hard_cap_units integer,
  p_cache_backend text,
  p_cache_ttl_seconds integer,
  p_note text
) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_maps_provider_set_v3(
  p_provider_code text,
  p_priority integer,
  p_enabled boolean,
  p_language text,
  p_region text,
  p_monthly_soft_cap_units integer,
  p_monthly_hard_cap_units integer,
  p_cache_backend text,
  p_cache_ttl_seconds integer,
  p_note text
) TO service_role;
GRANT ALL ON FUNCTION public.admin_maps_provider_set_v3(
  p_provider_code text,
  p_priority integer,
  p_enabled boolean,
  p_language text,
  p_region text,
  p_monthly_soft_cap_units integer,
  p_monthly_hard_cap_units integer,
  p_cache_backend text,
  p_cache_ttl_seconds integer,
  p_note text
) TO authenticated;
