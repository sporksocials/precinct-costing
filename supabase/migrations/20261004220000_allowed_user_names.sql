-- Who Can Sign In: first names for the people on the list, so the change log, price history and ignored alerts can say
-- "Matt" instead of an email address. Only the owner (hello@sporksocials.com.au) may set or change a name: the screen only
-- offers the field to that login and this trigger refuses anyone else, whatever they send. Adding and removing sign-ins is
-- unchanged. Direct database work (the SQL editor, migrations, the service role) is not blocked.
alter table public.cost_allowed_users add column if not exists display_name text;

create or replace function public.cost_is_owner()
returns boolean language sql stable security definer set search_path = public as $$
  select lower(coalesce(auth.jwt() ->> 'email', '')) = 'hello@sporksocials.com.au';
$$;

-- invoker rights on purpose: current_user is then the real caller (authenticated for the app), not the function owner
create or replace function public.cost_allowed_users_name_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if current_user in ('postgres', 'supabase_admin', 'service_role') or public.cost_is_owner() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.display_name is not null then
      raise exception 'Only the owner can set names';
    end if;
  elsif new.display_name is distinct from old.display_name then
    raise exception 'Only the owner can change names';
  end if;
  return new;
end;
$$;

drop trigger if exists cost_allowed_users_name_guard on public.cost_allowed_users;
create trigger cost_allowed_users_name_guard before insert or update on public.cost_allowed_users
  for each row execute function public.cost_allowed_users_name_guard();

comment on column public.cost_allowed_users.display_name is 'First name shown in history instead of the email. Only the owner can set it (cost_allowed_users_name_guard).';
