-- Sell price history: every change to a menu sell price / happy hour price is logged by triggers.
-- The app never inserts into cost_sell_price_log. cost_per_portion / gp_pct are nullable: triggers
-- cannot cost a recipe, so they stay null unless a future writer fills them in.
create table if not exists public.cost_sell_price_log (
  id bigserial primary key,
  kind text not null check (kind in ('item', 'beer_serve', 'gelato_serve')),
  item_id uuid references public.cost_menu_items (id) on delete cascade,
  beer_id uuid references public.cost_beers (id) on delete cascade,
  serve_id uuid,
  venue_id integer references public.cost_venues (id),
  old_price numeric,
  new_price numeric,
  old_hh_price numeric,
  new_hh_price numeric,
  cost_per_portion numeric,
  gp_pct numeric,
  changed_by text,
  changed_at timestamptz not null default now()
);
create index if not exists cost_sell_price_log_item_idx on public.cost_sell_price_log (item_id, changed_at);
create index if not exists cost_sell_price_log_beer_idx on public.cost_sell_price_log (beer_id, serve_id, changed_at);
create index if not exists cost_sell_price_log_serve_idx on public.cost_sell_price_log (kind, serve_id, changed_at);

alter table public.cost_sell_price_log enable row level security;
drop policy if exists cost_allowed_select on public.cost_sell_price_log;
create policy cost_allowed_select on public.cost_sell_price_log for select to authenticated using (public.cost_is_allowed());

create or replace function public.cost_menu_items_sell_price_log()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.sell_price_inc is distinct from old.sell_price_inc or new.hh_price_inc is distinct from old.hh_price_inc then
    insert into public.cost_sell_price_log (kind, item_id, venue_id, old_price, new_price, old_hh_price, new_hh_price, changed_by)
    values ('item', new.id, new.venue_id, old.sell_price_inc, new.sell_price_inc, old.hh_price_inc, new.hh_price_inc, auth.jwt() ->> 'email');
  end if;
  return null;
end $$;
drop trigger if exists cost_menu_items_sell_price_log on public.cost_menu_items;
create trigger cost_menu_items_sell_price_log
after update on public.cost_menu_items
for each row execute function public.cost_menu_items_sell_price_log();

create or replace function public.cost_beer_prices_sell_price_log()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.sell_price_inc is distinct from old.sell_price_inc or new.hh_price_inc is distinct from old.hh_price_inc then
    insert into public.cost_sell_price_log (kind, beer_id, serve_id, venue_id, old_price, new_price, old_hh_price, new_hh_price, changed_by)
    values ('beer_serve', new.beer_id, new.serve_id, (select b.venue_id from public.cost_beers b where b.id = new.beer_id),
            old.sell_price_inc, new.sell_price_inc, old.hh_price_inc, new.hh_price_inc, auth.jwt() ->> 'email');
  end if;
  return null;
end $$;
drop trigger if exists cost_beer_prices_sell_price_log on public.cost_beer_prices;
create trigger cost_beer_prices_sell_price_log
after update on public.cost_beer_prices
for each row execute function public.cost_beer_prices_sell_price_log();

create or replace function public.cost_gelato_serves_sell_price_log()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.sell_price_inc is distinct from old.sell_price_inc then
    insert into public.cost_sell_price_log (kind, serve_id, venue_id, old_price, new_price, changed_by)
    values ('gelato_serve', new.id, new.venue_id, old.sell_price_inc, new.sell_price_inc, auth.jwt() ->> 'email');
  end if;
  return null;
end $$;
drop trigger if exists cost_gelato_serves_sell_price_log on public.cost_gelato_serves;
create trigger cost_gelato_serves_sell_price_log
after update on public.cost_gelato_serves
for each row execute function public.cost_gelato_serves_sell_price_log();
