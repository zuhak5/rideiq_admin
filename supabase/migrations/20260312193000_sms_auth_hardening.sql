set lock_timeout = '5s';
set statement_timeout = '60s';

update public.auth_sms_hook_events
set otp_hash = null
where otp_hash is not null;

alter table public.auth_sms_hook_events
  drop column if exists otp_hash;

create or replace function public.tg_profiles_normalize_iraq_phone()
returns trigger
language plpgsql
set search_path to 'pg_catalog'
as $$
begin
  if new.phone is not null then
    new.phone := public.normalize_iraq_phone_e164(new.phone);
    new.phone_e164 := new.phone;
  else
    new.phone_e164 := null;
  end if;

  return new;
end;
$$;
