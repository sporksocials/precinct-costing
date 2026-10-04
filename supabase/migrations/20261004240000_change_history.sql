-- Full change history: one row for every insert, update and delete on the tables people edit, with the whole row before
-- and after. Answers "who changed this method last Tuesday?" and keeps every deleted record so a mistake can be put back
-- (the Trash and per-record Undo are built on top of this table later).
--
--  * public.cost_change_history is read only for the app: signed-in allowed users can select; nobody can insert, update or
--    delete through the API. Only the SECURITY DEFINER trigger function below writes to it.
--  * ONE generic trigger function, public.cost_history_log(), attached to each tracked table with arguments:
--      argument 1  key columns, comma separated (row_key joins them with '|')
--      argument 2  optional parent table (for child rows, e.g. cost_beers for cost_beer_prices)
--      argument 3  optional column on the child row holding the parent's key
--    cost_recipe_lines needs no parent arguments: its own parent_type ('item' or 'prep') and parent_id say which dish or
--    prep it belongs to, so a record's history can include its ingredient lines.
--  * Bookkeeping columns (updated_at, updated_by, created_at, sort) never count as a change. An UPDATE that changes only
--    those, or changes nothing at all, writes NOTHING. That matters because the recipe editor saves by deleting removed
--    lines and upserting all lines (unchanged lines are "updated" to the same values with a new sort), and the edit stamp
--    triggers touch the parent dish or prep after every line change.
--  * changed_by is the signed-in email from the JWT; null means direct database work (SQL editor, migrations, service role).
--  * The function can never make a business write fail: any problem becomes a WARNING and the write goes on.
--  * Existing triggers are untouched (cost_audit, cost_*_touch, cost_stamp_edit, the sell price and price logs, the name
--    guard). All of those are BEFORE triggers or write to other tables; this one is AFTER ... FOR EACH ROW, so it sees the
--    final NEW row after every BEFORE trigger has run. AFTER triggers on one table fire in name order and none of them changes
--    the row, so the order does not matter.
--  * Deliberately NOT tracked, and why:
--      cost_price_log, cost_sell_price_log, cost_audit_log   already history tables themselves (a log of a log)
--      cost_change_history                                   itself (would recurse)
--      cost_portal_prices                                    bulk supplier price imports of thousands of rows
--      cost_research_notes                                   working notes with their own status and applied record
--      cost_ignored_alerts                                   dismissed Today alerts, not business data
--      cost_venues                                           fixed list, never edited in the app
-- Safe to apply to the live database: creates one table, one function and triggers. No backfill, no data changes, no
-- locks beyond the brief ones taken to add each trigger. Idempotent (create ... if not exists, drop trigger if exists).

create table if not exists public.cost_change_history (
  id bigint generated always as identity primary key,
  tx_id bigint not null default txid_current(),
  table_name text not null,          -- with the cost_ prefix, e.g. 'cost_menu_items'
  row_key text not null,             -- primary key as text; composite keys joined with '|'
  op text not null check (op in ('insert','update','delete')),
  old_row jsonb,                     -- whole row before (null for insert)
  new_row jsonb,                     -- whole row after (null for delete)
  changed_fields text[] not null default '{}',   -- update only: the non-bookkeeping columns whose value changed
  parent_table text,                 -- for child rows: the parent's table name (e.g. 'cost_menu_items')
  parent_id text,                    -- and the parent's key, so a record's history can include its children
  changed_by text,                   -- auth email from the JWT; null for direct database work
  changed_at timestamptz not null default now()
);

create index if not exists cost_change_history_row_idx on public.cost_change_history (table_name, row_key, changed_at desc);
create index if not exists cost_change_history_parent_idx on public.cost_change_history (parent_table, parent_id, changed_at desc);
create index if not exists cost_change_history_time_idx on public.cost_change_history (changed_at desc);
create index if not exists cost_change_history_deleted_idx on public.cost_change_history (table_name, changed_at desc) where op = 'delete';

alter table public.cost_change_history enable row level security;
drop policy if exists cost_allowed_select on public.cost_change_history;
create policy cost_allowed_select on public.cost_change_history for select to authenticated using (public.cost_is_allowed());

-- No insert, update or delete policies: only the trigger function (definer rights) writes. Belt and braces: no privileges either.
revoke all on public.cost_change_history from public, anon, authenticated;
grant select on public.cost_change_history to authenticated;

comment on table public.cost_change_history is 'Every insert, update and delete on the tracked cost_* tables with the whole row before and after. Written only by cost_history_log(); read only for signed-in allowed users.';

create or replace function public.cost_history_log()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  skip constant text[] := array['updated_at', 'updated_by', 'created_at', 'sort'];
  o jsonb;
  n jsonb;
  r jsonb;
  col text;
  parts text[] := '{}';
  fields text[] := '{}';
  k text;
  ptable text;
  pid text;
  who text;
begin
  begin
    o := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
    n := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
    r := coalesce(n, o);

    foreach col in array string_to_array(coalesce(tg_argv[0], 'id'), ',') loop
      parts := parts || coalesce(r ->> btrim(col), '');
    end loop;
    k := array_to_string(parts, '|');

    if tg_op = 'UPDATE' then
      select coalesce(array_agg(c order by c), '{}') into fields
        from jsonb_object_keys(n) as c
        where c <> all (skip) and (o -> c) is distinct from (n -> c);
      -- only bookkeeping changed, or nothing did: not a change worth recording
      if cardinality(fields) = 0 then
        return null;
      end if;
    end if;

    if tg_table_name = 'cost_recipe_lines' then
      ptable := case r ->> 'parent_type' when 'item' then 'cost_menu_items' when 'prep' then 'cost_preps' else null end;
      pid := case when ptable is null then null else r ->> 'parent_id' end;
    elsif tg_argv[1] is not null and tg_argv[2] is not null then
      ptable := tg_argv[1];
      pid := r ->> tg_argv[2];
    end if;

    begin
      who := nullif(auth.jwt() ->> 'email', '');
    exception when others then
      who := null;
    end;

    insert into public.cost_change_history (table_name, row_key, op, old_row, new_row, changed_fields, parent_table, parent_id, changed_by)
    values (tg_table_name, k, lower(tg_op), o, n, fields, ptable, pid, who);
  exception when others then
    raise warning 'cost_history_log: could not record % on %: % (%)', tg_op, tg_table_name, sqlerrm, sqlstate;
  end;
  return null;
end $$;
revoke execute on function public.cost_history_log() from public, anon, authenticated;

-- Attach to each tracked table (key columns, then optional parent table and the column that holds its key).
drop trigger if exists cost_menu_items_history on public.cost_menu_items;
create trigger cost_menu_items_history after insert or update or delete on public.cost_menu_items
  for each row execute function public.cost_history_log('id');
drop trigger if exists cost_preps_history on public.cost_preps;
create trigger cost_preps_history after insert or update or delete on public.cost_preps
  for each row execute function public.cost_history_log('id');
drop trigger if exists cost_recipe_lines_history on public.cost_recipe_lines;
create trigger cost_recipe_lines_history after insert or update or delete on public.cost_recipe_lines
  for each row execute function public.cost_history_log('id');
drop trigger if exists cost_ingredients_history on public.cost_ingredients;
create trigger cost_ingredients_history after insert or update or delete on public.cost_ingredients
  for each row execute function public.cost_history_log('id');
drop trigger if exists cost_beers_history on public.cost_beers;
create trigger cost_beers_history after insert or update or delete on public.cost_beers
  for each row execute function public.cost_history_log('id');
drop trigger if exists cost_beer_serves_history on public.cost_beer_serves;
create trigger cost_beer_serves_history after insert or update or delete on public.cost_beer_serves
  for each row execute function public.cost_history_log('id');
drop trigger if exists cost_beer_prices_history on public.cost_beer_prices;
create trigger cost_beer_prices_history after insert or update or delete on public.cost_beer_prices
  for each row execute function public.cost_history_log('id', 'cost_beers', 'beer_id');
drop trigger if exists cost_gelato_serves_history on public.cost_gelato_serves;
create trigger cost_gelato_serves_history after insert or update or delete on public.cost_gelato_serves
  for each row execute function public.cost_history_log('id');
drop trigger if exists cost_gelato_serve_lines_history on public.cost_gelato_serve_lines;
create trigger cost_gelato_serve_lines_history after insert or update or delete on public.cost_gelato_serve_lines
  for each row execute function public.cost_history_log('id', 'cost_gelato_serves', 'serve_id');
drop trigger if exists cost_offers_history on public.cost_offers;
create trigger cost_offers_history after insert or update or delete on public.cost_offers
  for each row execute function public.cost_history_log('id');
drop trigger if exists cost_offer_lines_history on public.cost_offer_lines;
create trigger cost_offer_lines_history after insert or update or delete on public.cost_offer_lines
  for each row execute function public.cost_history_log('id', 'cost_offers', 'offer_id');
drop trigger if exists cost_ingredient_deals_history on public.cost_ingredient_deals;
create trigger cost_ingredient_deals_history after insert or update or delete on public.cost_ingredient_deals
  for each row execute function public.cost_history_log('id');
drop trigger if exists cost_suppliers_history on public.cost_suppliers;
create trigger cost_suppliers_history after insert or update or delete on public.cost_suppliers
  for each row execute function public.cost_history_log('id');
drop trigger if exists cost_specials_history on public.cost_specials;
create trigger cost_specials_history after insert or update or delete on public.cost_specials
  for each row execute function public.cost_history_log('id');
drop trigger if exists cost_targets_history on public.cost_targets;
create trigger cost_targets_history after insert or update or delete on public.cost_targets
  for each row execute function public.cost_history_log('venue_id,category');
drop trigger if exists cost_settings_history on public.cost_settings;
create trigger cost_settings_history after insert or update or delete on public.cost_settings
  for each row execute function public.cost_history_log('key');
drop trigger if exists cost_bar_options_history on public.cost_bar_options;
create trigger cost_bar_options_history after insert or update or delete on public.cost_bar_options
  for each row execute function public.cost_history_log('id');
drop trigger if exists cost_allowed_users_history on public.cost_allowed_users;
create trigger cost_allowed_users_history after insert or update or delete on public.cost_allowed_users
  for each row execute function public.cost_history_log('email');
