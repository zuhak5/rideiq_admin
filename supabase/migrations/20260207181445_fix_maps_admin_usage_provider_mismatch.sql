begin;

alter table public.maps_requests_log
  drop constraint if exists maps_requests_log_cap_chk;

alter table public.maps_requests_log
  add constraint maps_requests_log_cap_chk
  check (
    capability = any (
      array[
        'render'::text,
        'directions'::text,
        'geocode'::text,
        'distance_matrix'::text
      ]
    )
  );

create or replace function public.admin_maps_requests_stats_v1()
returns table(
  provider_code text,
  capability text,
  requests_1h integer,
  requests_24h integer,
  billed_units_1h bigint,
  billed_units_24h bigint,
  cache_hits_1h integer,
  cache_hits_24h integer,
  errors_1h integer,
  errors_24h integer,
  rate_limited_1h integer,
  rate_limited_24h integer
)
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if not (select public.is_admin()) then
    raise exception 'not_authorized';
  end if;

  return query
  select
    mc.provider_code,
    mc.capability,
    coalesce(count(l.*) filter (where l.created_at >= now() - interval '1 hour'), 0)::int as requests_1h,
    coalesce(count(l.*), 0)::int as requests_24h,
    coalesce(sum(l.billed_units) filter (where l.created_at >= now() - interval '1 hour'), 0)::bigint as billed_units_1h,
    coalesce(sum(l.billed_units), 0)::bigint as billed_units_24h,
    coalesce(count(l.*) filter (where l.created_at >= now() - interval '1 hour' and l.cache_hit = true), 0)::int as cache_hits_1h,
    coalesce(count(l.*) filter (where l.cache_hit = true), 0)::int as cache_hits_24h,
    coalesce(count(l.*) filter (where l.created_at >= now() - interval '1 hour' and l.http_status >= 400), 0)::int as errors_1h,
    coalesce(count(l.*) filter (where l.http_status >= 400), 0)::int as errors_24h,
    coalesce(count(l.*) filter (where l.created_at >= now() - interval '1 hour' and l.http_status = 429), 0)::int as rate_limited_1h,
    coalesce(count(l.*) filter (where l.http_status = 429), 0)::int as rate_limited_24h
  from public.maps_provider_capabilities mc
  join public.maps_providers mp on mp.provider_code = mc.provider_code
  left join public.maps_requests_log l
    on l.provider_code = mc.provider_code
   and l.capability = mc.capability
   and l.created_at >= now() - interval '24 hours'
   and not (l.http_status = 424 and coalesce(l.error_code, '') = 'missing_provider_key')
  group by mc.provider_code, mc.capability
  order by mc.provider_code, mc.capability;
end;
$$;

commit;;
