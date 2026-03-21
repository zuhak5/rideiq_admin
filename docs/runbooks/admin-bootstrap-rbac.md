# Admin Bootstrap Runbook

Use this runbook only when the system has no existing admin with `admin_access.manage`.
It must be executed with service-role or direct database access by an operator.

## 1. Verify the target user exists

```sql
select
  u.id,
  u.email,
  p.display_name,
  p.phone
from auth.users u
join public.profiles p on p.id = u.id
where u.email = 'admin@example.com';
```

The query must return exactly one row before continuing.

## 2. Verify the required RBAC role exists

```sql
select id, key, name
from public.admin_roles
where key = 'super_admin';
```

## 3. Assign the first admin role

Replace the email filter with the target account.

```sql
insert into public.admin_user_roles (user_id, role_id, granted_by, note)
select
  u.id,
  r.id,
  null,
  'bootstrap:first_super_admin'
from auth.users u
join public.profiles p on p.id = u.id
join public.admin_roles r on r.key = 'super_admin'
where u.email = 'admin@example.com'
on conflict (user_id, role_id) do nothing;
```

## 4. Record the bootstrap in the audit log

```sql
insert into public.admin_audit_log (
  actor_id,
  action,
  target_user_id,
  note,
  details
)
select
  null,
  'set_admin_roles',
  u.id,
  'bootstrap:first_super_admin',
  jsonb_build_object(
    'source', 'manual_bootstrap',
    'old_roles', jsonb_build_array(),
    'new_roles', jsonb_build_array('super_admin')
  )
from auth.users u
join public.profiles p on p.id = u.id
where u.email = 'admin@example.com';
```

## 5. Verify the result

```sql
select
  p.id,
  p.display_name,
  array_agg(r.key order by r.key) as role_keys
from public.admin_user_roles ur
join public.admin_roles r on r.id = ur.role_id
join public.profiles p on p.id = ur.user_id
where ur.user_id = (
  select id
  from auth.users
  where email = 'admin@example.com'
)
group by p.id, p.display_name;
```

The role list must include `super_admin`.
