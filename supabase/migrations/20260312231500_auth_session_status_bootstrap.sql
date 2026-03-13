set lock_timeout = '5s';
set statement_timeout = '60s';

create or replace function public.get_my_auth_session_status()
returns text
language plpgsql
stable
security definer
set search_path to 'pg_catalog, public'
as $$
declare
  v_uid uuid := auth.uid();
  v_status text;
begin
  if v_uid is null then
    return 'signed_out';
  end if;

  select case
    when coalesce(nullif(u.encrypted_password, ''), '') <> ''
      and (
        u.phone_confirmed_at is not null
        or u.last_sign_in_at is not null
        or p.terms_accepted_at is not null
      )
      then 'complete'
    else 'incomplete'
  end
  into v_status
  from auth.users u
  left join public.profiles p
    on p.id = u.id
  where u.id = v_uid
  limit 1;

  return coalesce(v_status, 'signed_out');
end;
$$;

revoke all on function public.get_my_auth_session_status() from public;
revoke all on function public.get_my_auth_session_status() from anon;
grant execute on function public.get_my_auth_session_status() to authenticated;
grant execute on function public.get_my_auth_session_status() to service_role;
