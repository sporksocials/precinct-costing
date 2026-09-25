-- Change log for settings that drive every number in the app: targets, settings, who can sign in, and the
-- per-item / per-beer / per-serve target overrides. Answers "who changed this, when, from what to what".
-- Sell price history already has its own log (cost_sell_price_log). Read only for the app; written by triggers.
create table if not exists public.cost_audit_log (
  id bigserial primary key,
  table_name text not null,
  row_key text not null,
  op text not null check (op in ('insert', 'update', 'delete')),
  column_name text,
  old_value text,
  new_value text,
  changed_by text,
  changed_at timestamptz not null default now()
);
create index if not exists cost_audit_log_table_idx on public.cost_audit_log (table_name, row_key, changed_at desc);
create index if not exists cost_audit_log_time_idx on public.cost_audit_log (changed_at desc);

alter table public.cost_audit_log enable row level security;
drop policy if exists cost_allowed_select on public.cost_audit_log;
create policy cost_allowed_select on public.cost_audit_log for select to authenticated using (public.cost_is_allowed());

-- Trigger arguments = the columns to watch (none = every column). Updates log one row per changed watched column.
create or replace function public.cost_audit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  o jsonb := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  n jsonb := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  r jsonb := coalesce(n, o);
  k text := coalesce(r->>'id', r->>'key', r->>'email', concat_ws('/', r->>'venue_id', r->>'category'));
  who text := auth.jwt() ->> 'email';
  col text;
begin
  if tg_op = 'UPDATE' then
    for col in select jsonb_object_keys(n) loop
      continue when col in ('updated_at', 'created_at');
      continue when tg_nargs > 0 and not (col = any (tg_argv));
      if o->col is distinct from n->col then
        insert into public.cost_audit_log (table_name, row_key, op, column_name, old_value, new_value, changed_by)
        values (tg_table_name, k, 'update', col, o->>col, n->>col, who);
      end if;
    end loop;
  else
    insert into public.cost_audit_log (table_name, row_key, op, column_name, old_value, new_value, changed_by)
    values (tg_table_name, k, lower(tg_op), null, case when o is null then null else o::text end, case when n is null then null else n::text end, who);
  end if;
  return null;
end $$;
revoke execute on function public.cost_audit() from public, anon, authenticated;

drop trigger if exists cost_targets_audit on public.cost_targets;
create trigger cost_targets_audit after insert or update or delete on public.cost_targets
  for each row execute function public.cost_audit();
drop trigger if exists cost_settings_audit on public.cost_settings;
create trigger cost_settings_audit after insert or update or delete on public.cost_settings
  for each row execute function public.cost_audit();
drop trigger if exists cost_allowed_users_audit on public.cost_allowed_users;
create trigger cost_allowed_users_audit after insert or update or delete on public.cost_allowed_users
  for each row execute function public.cost_audit();
drop trigger if exists cost_beers_audit on public.cost_beers;
create trigger cost_beers_audit after update on public.cost_beers
  for each row execute function public.cost_audit('target_gp', 'active');
drop trigger if exists cost_gelato_serves_audit on public.cost_gelato_serves;
create trigger cost_gelato_serves_audit after update on public.cost_gelato_serves
  for each row execute function public.cost_audit('target_gp', 'on_menu', 'active');
drop trigger if exists cost_menu_items_audit on public.cost_menu_items;
create trigger cost_menu_items_audit after update on public.cost_menu_items
  for each row execute function public.cost_audit('target_override', 'active');
