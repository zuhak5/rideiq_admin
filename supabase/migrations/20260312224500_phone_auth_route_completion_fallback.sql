set lock_timeout = '5s';
set statement_timeout = '60s';

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
    when coalesce(nullif(u.encrypted_password, ''), '') <> ''
      and (
        u.phone_confirmed_at is not null
        or u.last_sign_in_at is not null
        or p.terms_accepted_at is not null
      )
      then 'password'
    else 'otp_signup'
  end
  into v_route
  from auth.users u
  left join public.profiles p
    on p.id = u.id
  where u.phone = v_phone_e164
  order by u.created_at desc nulls last
  limit 1;

  return coalesce(v_route, 'otp_signup');
end;
$$;
