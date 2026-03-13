set lock_timeout = '5s';
set statement_timeout = '60s';

alter table public.profiles
  add column if not exists terms_accepted_at timestamptz,
  add column if not exists terms_version text;

create or replace function public.get_phone_auth_route(
  p_phone_e164 text
) returns text
language plpgsql
security definer
set search_path to 'pg_catalog, public'
as $$
declare
  v_phone_e164 text;
  v_route text;
begin
  if coalesce(btrim(p_phone_e164), '') = '' then
    raise exception 'phone_required';
  end if;

  v_phone_e164 := public.normalize_iraq_phone_e164(p_phone_e164);

  select case
    when u.phone_confirmed_at is not null
      and coalesce(nullif(u.encrypted_password, ''), '') <> ''
      then 'password'
    else 'otp_signup'
  end
  into v_route
  from auth.users u
  where u.phone = v_phone_e164
  order by u.created_at desc nulls last
  limit 1;

  return coalesce(v_route, 'otp_signup');
end;
$$;

revoke all on function public.get_phone_auth_route(text) from public;
revoke all on function public.get_phone_auth_route(text) from anon;
revoke all on function public.get_phone_auth_route(text) from authenticated;
grant execute on function public.get_phone_auth_route(text) to service_role;

create or replace function public.handle_auth_user_updated()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog, public'
as $$
begin
  update public.profiles p
     set phone = new.phone,
         display_name = coalesce(
           new.raw_user_meta_data ->> 'display_name',
           p.display_name
         )
   where p.id = new.id;

  return new;
end;
$$;

revoke all on function public.handle_auth_user_updated() from public;
revoke all on function public.handle_auth_user_updated() from anon;
revoke all on function public.handle_auth_user_updated() from authenticated;
grant execute on function public.handle_auth_user_updated() to service_role;

drop trigger if exists on_auth_user_updated on auth.users;

create trigger on_auth_user_updated
after update of phone, raw_user_meta_data on auth.users
for each row
execute function public.handle_auth_user_updated();

grant update(terms_accepted_at) on table public.profiles to authenticated;
grant update(terms_version) on table public.profiles to authenticated;
