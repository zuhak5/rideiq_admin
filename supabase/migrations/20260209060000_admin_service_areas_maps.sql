-- Admin: Service Areas (GeoJSON-friendly RPCs) + Maps support
--
-- PostgREST does not serialize PostGIS geometry nicely.
-- These SECURITY DEFINER RPCs return GeoJSON (jsonb) so the Next admin UI can
-- render + edit service area polygons without direct geometry access.

begin;
-- --- Helpers ---

create or replace function public._admin_require_role_v1()
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_role text;
begin
  v_role := coalesce(auth.jwt() ->> 'role', '');
  if v_role <> 'service_role' and not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
end;
$$;
comment on function public._admin_require_role_v1() is 'Internal helper: throws unless service_role or admin.';
-- --- Service areas list ---

create or replace function public.admin_service_areas_list_v1(
  p_q text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table(
  id uuid,
  name text,
  governorate text,
  is_active boolean,
  priority integer,
  pricing_config_id uuid,
  min_base_fare_iqd integer,
  surge_multiplier numeric,
  surge_reason text,
  match_radius_m integer,
  driver_loc_stale_after_seconds integer,
  cash_rounding_step_iqd integer,
  created_at timestamptz,
  updated_at timestamptz,
  geom_geojson jsonb
)
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $$
begin
  perform public._admin_require_role_v1();

  return query
  select
    sa.id,
    sa.name,
    sa.governorate,
    sa.is_active,
    sa.priority,
    sa.pricing_config_id,
    sa.min_base_fare_iqd,
    sa.surge_multiplier,
    sa.surge_reason,
    sa.match_radius_m,
    sa.driver_loc_stale_after_seconds,
    sa.cash_rounding_step_iqd,
    sa.created_at,
    sa.updated_at,
    case
      when sa.geom is null then null
      else extensions.ST_AsGeoJSON(sa.geom)::jsonb
    end as geom_geojson
  from public.service_areas sa
  where (
    coalesce(nullif(btrim(p_q), ''), null) is null
    or sa.name ilike '%' || p_q || '%'
    or sa.governorate ilike '%' || p_q || '%'
  )
  order by sa.priority desc, sa.updated_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 200))
  offset greatest(0, coalesce(p_offset, 0));
end;
$$;
comment on function public.admin_service_areas_list_v1(text, integer, integer)
  is 'Admin list service areas with geometry serialized as GeoJSON.';
-- --- Service area get ---

create or replace function public.admin_service_area_get_v1(p_id uuid)
returns table(
  id uuid,
  name text,
  governorate text,
  is_active boolean,
  priority integer,
  pricing_config_id uuid,
  min_base_fare_iqd integer,
  surge_multiplier numeric,
  surge_reason text,
  match_radius_m integer,
  driver_loc_stale_after_seconds integer,
  cash_rounding_step_iqd integer,
  created_at timestamptz,
  updated_at timestamptz,
  geom_geojson jsonb
)
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $$
begin
  perform public._admin_require_role_v1();

  return query
  select
    sa.id,
    sa.name,
    sa.governorate,
    sa.is_active,
    sa.priority,
    sa.pricing_config_id,
    sa.min_base_fare_iqd,
    sa.surge_multiplier,
    sa.surge_reason,
    sa.match_radius_m,
    sa.driver_loc_stale_after_seconds,
    sa.cash_rounding_step_iqd,
    sa.created_at,
    sa.updated_at,
    case
      when sa.geom is null then null
      else extensions.ST_AsGeoJSON(sa.geom)::jsonb
    end as geom_geojson
  from public.service_areas sa
  where sa.id = p_id;
end;
$$;
comment on function public.admin_service_area_get_v1(uuid)
  is 'Admin get service area (including GeoJSON geometry) by id.';
-- --- Service area upsert by id ---

create or replace function public.admin_service_area_upsert_v1(
  p_id uuid,
  p_name text,
  p_governorate text,
  p_geojson jsonb,
  p_priority integer default 0,
  p_is_active boolean default true,
  p_pricing_config_id uuid default null,
  p_min_base_fare_iqd integer default null,
  p_surge_multiplier numeric default null,
  p_surge_reason text default null,
  p_match_radius_m integer default null,
  p_driver_loc_stale_after_seconds integer default null,
  p_cash_rounding_step_iqd integer default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $$
declare
  v_id uuid;
  v_geom extensions.geometry(MultiPolygon, 4326);
begin
  perform public._admin_require_role_v1();

  if p_geojson is null then
    raise exception 'geojson required';
  end if;

  v_geom := extensions.ST_Multi(
    extensions.ST_CollectionExtract(
      extensions.ST_MakeValid(
        extensions.ST_SetSRID(extensions.ST_GeomFromGeoJSON(p_geojson::text), 4326)
      ),
      3
    )
  );

  if v_geom is null or extensions.ST_IsEmpty(v_geom) then
    raise exception 'invalid or empty geometry';
  end if;

  if p_id is null then
    insert into public.service_areas (
      name,
      governorate,
      is_active,
      priority,
      pricing_config_id,
      min_base_fare_iqd,
      surge_multiplier,
      surge_reason,
      match_radius_m,
      driver_loc_stale_after_seconds,
      cash_rounding_step_iqd,
      geom
    ) values (
      p_name,
      p_governorate,
      coalesce(p_is_active, true),
      coalesce(p_priority, 0),
      p_pricing_config_id,
      p_min_base_fare_iqd,
      greatest(coalesce(p_surge_multiplier, 1.0), 1.0),
      nullif(btrim(coalesce(p_surge_reason, '')), ''),
      greatest(coalesce(p_match_radius_m, 2000), 10),
      greatest(coalesce(p_driver_loc_stale_after_seconds, 120), 10),
      greatest(coalesce(p_cash_rounding_step_iqd, 250), 1),
      v_geom
    ) returning id into v_id;
  else
    update public.service_areas
      set
        name = p_name,
        governorate = p_governorate,
        is_active = coalesce(p_is_active, is_active),
        priority = coalesce(p_priority, priority),
        pricing_config_id = p_pricing_config_id,
        min_base_fare_iqd = p_min_base_fare_iqd,
        surge_multiplier = greatest(coalesce(p_surge_multiplier, surge_multiplier), 1.0),
        surge_reason = nullif(btrim(coalesce(p_surge_reason, '')), ''),
        match_radius_m = greatest(coalesce(p_match_radius_m, match_radius_m), 10),
        driver_loc_stale_after_seconds = greatest(coalesce(p_driver_loc_stale_after_seconds, driver_loc_stale_after_seconds), 10),
        cash_rounding_step_iqd = greatest(coalesce(p_cash_rounding_step_iqd, cash_rounding_step_iqd), 1),
        geom = v_geom,
        updated_at = now()
      where id = p_id
      returning id into v_id;

    if v_id is null then
      raise exception 'not_found';
    end if;
  end if;

  return v_id;
end;
$$;
comment on function public.admin_service_area_upsert_v1(uuid, text, text, jsonb, integer, boolean, uuid, integer, numeric, text, integer, integer, integer)
  is 'Admin upsert service area by id; accepts GeoJSON geometry.';
-- --- Service area delete ---

create or replace function public.admin_service_area_delete_v1(p_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  perform public._admin_require_role_v1();
  delete from public.service_areas where id = p_id;
end;
$$;
comment on function public.admin_service_area_delete_v1(uuid)
  is 'Admin delete service area by id.';
-- --- Grants ---

grant execute on function public._admin_require_role_v1() to authenticated;
grant execute on function public.admin_service_areas_list_v1(text, integer, integer) to authenticated;
grant execute on function public.admin_service_area_get_v1(uuid) to authenticated;
grant execute on function public.admin_service_area_upsert_v1(uuid, text, text, jsonb, integer, boolean, uuid, integer, numeric, text, integer, integer, integer) to authenticated;
grant execute on function public.admin_service_area_delete_v1(uuid) to authenticated;
commit;
