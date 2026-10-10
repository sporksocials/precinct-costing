-- Reference schema for Precinct Costing.
-- The production database already has these tables and the price-log trigger;
-- this file documents the shape the app is built against and the RLS pattern.
-- Apply selectively — do not blindly re-run against a live project.

create table if not exists public.cost_allowed_users (
  email text primary key,
  display_name text
);

create table if not exists public.cost_venues (
  id int primary key,
  name text not null,
  slug text not null unique,
  sort int not null default 0
);

create table if not exists public.cost_settings (
  key text primary key,
  value numeric not null
);
insert into public.cost_settings (key, value) values ('gst_rate', 0.10), ('round_to', 0.5), ('alert_pct', 0.05)
on conflict (key) do nothing;

create table if not exists public.cost_targets (
  venue_id int not null references public.cost_venues (id),
  category text not null,
  target_gp numeric not null check (target_gp >= 0 and target_gp <= 1),
  primary key (venue_id, category)
);

create table if not exists public.cost_suppliers (
  id serial primary key,
  name text not null,
  portal_url text,
  portal_username text
);

create table if not exists public.cost_ingredients (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  category text not null default 'Food', -- was wrongly documented as nullable here; live DB has always enforced NOT NULL
  supplier_id int references public.cost_suppliers (id),
  supplier_code text,
  pack_size numeric not null default 1,
  pack_unit text not null default 'kg' check (pack_unit in ('kg', 'L', 'each')),
  pack_price numeric not null default 0,
  price_inc_gst boolean not null default false,
  gst_free boolean not null default false,
  rebate numeric not null default 0,
  yield_pct numeric not null default 1,
  venues text not null default 'All', -- was wrongly documented as nullable here; live DB has always enforced NOT NULL
  active boolean not null default true,
  last_price_update date,
  previous_price numeric,
  source text,
  notes text,
  updated_at timestamptz not null default now()
);

create table if not exists public.cost_preps (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  venue_id int references public.cost_venues (id),
  prep_type text,
  yield_qty numeric not null default 1,
  yield_unit text not null default 'kg' check (yield_unit in ('kg', 'L', 'each')),
  active boolean not null default true,
  source text,
  notes text
);

create table if not exists public.cost_menu_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  venue_id int not null references public.cost_venues (id),
  category text not null,
  section text,
  portions numeric not null default 1,
  sell_price_inc numeric,
  target_override numeric,
  hh_price_inc numeric,
  active boolean not null default true,
  source text,
  notes text,
  -- Bar display (iPad drinks station): null for everything except cocktails, mocktails and cold drinks that have been built out for it.
  glass text, -- which glass to serve in, e.g. "Rocks Glass, Salt Rim"
  method jsonb, -- ordered array of short method steps, e.g. ["Shake hard for 12 seconds","Strain into the glass"]
  garnish jsonb, -- ordered array of garnish items, e.g. ["Dehydrated lime wheel"]
  bar_photo text -- reference photo file in public/bar/cocktails/, e.g. "mai-tai.jpg"; null falls back to a slug of the name
);

create table if not exists public.cost_recipe_lines (
  id uuid primary key default gen_random_uuid(),
  parent_type text not null check (parent_type in ('prep', 'item')),
  parent_id uuid not null,
  component_type text not null check (component_type in ('ingredient', 'prep')),
  component_id uuid not null,
  qty numeric not null default 0,
  unit text not null check (unit in ('g', 'kg', 'ml', 'L', 'each')),
  note text,
  sort int not null default 0
);
create index if not exists cost_recipe_lines_parent_idx on public.cost_recipe_lines (parent_type, parent_id);
create index if not exists cost_recipe_lines_component_idx on public.cost_recipe_lines (component_type, component_id);

create table if not exists public.cost_price_log (
  id bigserial primary key,
  ingredient_id uuid not null references public.cost_ingredients (id) on delete cascade,
  changed_at timestamptz not null default now(),
  old_price numeric,
  new_price numeric,
  source text,
  entered_by text,
  notes text
);
create index if not exists cost_price_log_ingredient_idx on public.cost_price_log (ingredient_id, changed_at);

create table if not exists public.cost_specials (
  id bigserial primary key,
  name text not null,
  venue_id int references public.cost_venues (id),
  category text,
  based_on_item uuid references public.cost_menu_items (id) on delete set null,
  manual_cost numeric,
  sell_price_inc numeric,
  target_gp numeric,
  notes text
);

create table if not exists public.cost_portal_prices (
  id bigserial primary key,
  supplier text not null,
  product_code text,
  description text,
  price numeric,
  price_inc_gst boolean,
  uom text,
  in_stock boolean,
  category text,
  captured_at timestamptz,
  batch text
);

-- Gelato Rumba: every flavour (a prep of type "Gelato flavour mix") is sold in these serves.
-- The app builds each flavour x serve on the fly; nothing per flavour is stored here.
create table if not exists public.cost_gelato_serves (
  id uuid primary key default gen_random_uuid(),
  venue_id integer not null references public.cost_venues(id),
  name text not null,
  sort integer not null default 0,
  grams numeric not null default 0,
  sell_price_inc numeric,
  on_menu boolean not null default true,
  active boolean not null default true,
  notes text,
  target_gp numeric check (target_gp is null or (target_gp >= 0 and target_gp < 1)),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (venue_id, name)
);

-- Packaging per serve (cup, cone, spoon, napkin, sleeve, choc dip).
create table if not exists public.cost_gelato_serve_lines (
  id uuid primary key default gen_random_uuid(),
  serve_id uuid not null references public.cost_gelato_serves(id) on delete cascade,
  ingredient_id uuid not null references public.cost_ingredients(id),
  qty numeric not null default 1,
  unit text not null default 'each' check (unit in ('g','kg','ml','L','each')),
  sort integer not null default 0
);

-- Ids of the old stored flavour x serve items this serve replaced, hidden by id (mirrors migration 20260927100000_gelato_legacy_ids.sql)
alter table public.cost_gelato_serves add column if not exists legacy_item_ids uuid[] not null default '{}';

insert into public.cost_settings (key, value) values ('gelato_wastage', 0.05) on conflict (key) do nothing;

-- Tap beer: every beer is one keg poured in the same serves; prices per beer x serve.
-- Wastage stays on the keg ingredient (its yield). The app builds each beer x serve on the fly.
create table if not exists public.cost_beer_serves (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort integer not null default 0,
  ml numeric not null,
  active boolean not null default true,
  not_sold_at integer[] not null default '{}',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
insert into public.cost_beer_serves (name, sort, ml) values ('Pot',1,285),('Schooner',2,425),('Pint',3,570),('Jug',4,1140) on conflict (name) do nothing;

create table if not exists public.cost_beers (
  id uuid primary key default gen_random_uuid(),
  venue_id integer not null references public.cost_venues(id),
  name text not null,
  ingredient_id uuid references public.cost_ingredients(id),
  target_gp numeric check (target_gp is null or (target_gp >= 0 and target_gp < 1)),
  active boolean not null default true,
  sort integer not null default 0,
  notes text,
  only_serves uuid[],
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (venue_id, name)
);

create table if not exists public.cost_beer_prices (
  id uuid primary key default gen_random_uuid(),
  beer_id uuid not null references public.cost_beers(id) on delete cascade,
  serve_id uuid not null references public.cost_beer_serves(id) on delete cascade,
  sell_price_inc numeric,
  hh_price_inc numeric,
  legacy_item_id uuid,
  unique (beer_id, serve_id)
);

-- Price log trigger: the app never inserts into cost_price_log itself.
create or replace function public.cost_ingredients_price_log()
returns trigger language plpgsql security definer as $$
begin
  if new.pack_price is distinct from old.pack_price then
    insert into public.cost_price_log (ingredient_id, old_price, new_price, source, entered_by)
    values (new.id, old.pack_price, new.pack_price, new.source, auth.jwt() ->> 'email');
    new.previous_price := old.pack_price;
    new.last_price_update := (now() at time zone 'Australia/Brisbane')::date;
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists cost_ingredients_price_log on public.cost_ingredients;
create trigger cost_ingredients_price_log
before update on public.cost_ingredients
for each row execute function public.cost_ingredients_price_log();

-- RLS: authenticated users whose email is on the allow-list get full access.
create or replace function public.cost_is_allowed()
returns boolean language sql stable security definer as $$
  select exists (
    select 1 from public.cost_allowed_users u
    where lower(u.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'cost_allowed_users','cost_venues','cost_settings','cost_targets','cost_suppliers','cost_ingredients',
    'cost_preps','cost_menu_items','cost_recipe_lines','cost_price_log','cost_specials','cost_portal_prices',
    'cost_gelato_serves','cost_gelato_serve_lines','cost_beer_serves','cost_beers','cost_beer_prices'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists cost_allowed_all on public.%I', t);
    execute format(
      'create policy cost_allowed_all on public.%I for all to authenticated using (public.cost_is_allowed()) with check (public.cost_is_allowed())',
      t
    );
  end loop;
end $$;

-- Sell price history (mirrors supabase/migrations/20260925120000_sell_price_log.sql)
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

-- Trigger functions are not meant to be called over the API.
revoke execute on function public.cost_menu_items_sell_price_log() from public, anon, authenticated;
revoke execute on function public.cost_beer_prices_sell_price_log() from public, anon, authenticated;
revoke execute on function public.cost_gelato_serves_sell_price_log() from public, anon, authenticated;

-- Specials & combos (mirrors supabase/migrations/20260925150000_offers.sql)
-- An offer belongs to ONE venue (its components come from that venue). Nothing here changes menu items or prices.
-- Idempotent. cost_specials (old stub) is left untouched.
create table if not exists public.cost_offers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  venue_id integer not null references public.cost_venues (id),
  kind text not null check (kind in ('combo', 'special', 'happy_hour')),
  status text not null default 'draft' check (status in ('draft', 'live', 'retired')),
  -- the offer's total price, inc GST
  price_inc numeric check (price_inc is null or price_inc >= 0),
  -- own GP target (0-1); null = the dominant component's target (see lib/offers.ts)
  target_override numeric check (target_override is null or (target_override >= 0 and target_override < 1)),
  starts_on date,
  ends_on date,
  -- 0 = Sunday ... 6 = Saturday; null = every day
  days_of_week integer[] check (days_of_week is null or days_of_week <@ array[0, 1, 2, 3, 4, 5, 6]),
  time_from time,
  time_to time,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists cost_offers_venue_status_idx on public.cost_offers (venue_id, status);
-- Sales Needed simulator inputs (mirrors supabase/migrations/20260926150000_offer_assumptions.sql). Not prices.
alter table public.cost_offers add column if not exists assumptions jsonb not null default '{}'::jsonb;

create table if not exists public.cost_offer_lines (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null references public.cost_offers (id) on delete cascade,
  component_kind text not null check (component_kind in ('item', 'beer_serve')),
  -- set null (not cascade) so an offer survives a deleted component and shows it as missing
  item_id uuid references public.cost_menu_items (id) on delete set null,
  beer_id uuid references public.cost_beers (id) on delete set null,
  serve_id uuid,
  qty numeric not null default 1 check (qty > 0),
  -- optional per-unit regular price (inc GST), only used to show "regular price" against the offer price
  price_inc_override numeric check (price_inc_override is null or price_inc_override >= 0),
  sort integer not null default 0
);
create index if not exists cost_offer_lines_offer_idx on public.cost_offer_lines (offer_id, sort);

create or replace function public.cost_offers_touch()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists cost_offers_touch on public.cost_offers;
create trigger cost_offers_touch
before update on public.cost_offers
for each row execute function public.cost_offers_touch();
revoke execute on function public.cost_offers_touch() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['cost_offers', 'cost_offer_lines'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists cost_allowed_all on public.%I', t);
    execute format(
      'create policy cost_allowed_all on public.%I for all to authenticated using (public.cost_is_allowed()) with check (public.cost_is_allowed())',
      t
    );
  end loop;
end $$;

-- Supplier deals on ingredients: buy X get Y free, volume discounts, temporary specials, standing percent off.
-- A deal changes what a unit costs (lib/deals.ts); it never rewrites cost_ingredients.pack_price, so the price log stays clean.
create table if not exists public.cost_ingredient_deals (
  id uuid primary key default gen_random_uuid(),
  ingredient_id uuid not null references public.cost_ingredients (id) on delete cascade,
  kind text not null check (kind in ('buy_x_get_y', 'volume', 'special_price', 'percent_off')),
  buy_qty numeric check (buy_qty is null or buy_qty > 0),
  free_qty numeric check (free_qty is null or free_qty > 0),
  min_qty numeric check (min_qty is null or min_qty > 0),
  pct_off numeric check (pct_off is null or (pct_off >= 0 and pct_off <= 1)),
  unit_price numeric check (unit_price is null or unit_price > 0),
  special_pack_price numeric check (special_pack_price is null or special_pack_price > 0),
  starts_on date,
  ends_on date,
  note text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (starts_on is null or ends_on is null or starts_on <= ends_on)
);
create index if not exists cost_ingredient_deals_ingredient_idx on public.cost_ingredient_deals (ingredient_id);

create or replace function public.cost_ingredient_deals_touch()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists cost_ingredient_deals_touch on public.cost_ingredient_deals;
create trigger cost_ingredient_deals_touch
before update on public.cost_ingredient_deals
for each row execute function public.cost_ingredient_deals_touch();
revoke execute on function public.cost_ingredient_deals_touch() from public, anon, authenticated;

alter table public.cost_ingredient_deals enable row level security;
drop policy if exists cost_allowed_all on public.cost_ingredient_deals;
create policy cost_allowed_all on public.cost_ingredient_deals for all to authenticated
  using (public.cost_is_allowed()) with check (public.cost_is_allowed());

-- Data fingerprint (mirrors supabase/migrations/20260926180000_data_fingerprint.sql)
create or replace function public.cost_data_fingerprint(p_since timestamptz default (now() - interval '90 days'))
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'generated_at', now(),
    'cost_venues', (select jsonb_build_object('count', count(*), 'hash', md5(coalesce(string_agg(t::text, E'\n' order by t.id), ''))) from public.cost_venues t),
    'cost_settings', (select jsonb_build_object('count', count(*), 'hash', md5(coalesce(string_agg(t::text, E'\n' order by t.key), ''))) from public.cost_settings t),
    'cost_targets', (select jsonb_build_object('count', count(*), 'hash', md5(coalesce(string_agg(t::text, E'\n' order by t.venue_id, t.category), ''))) from public.cost_targets t),
    'cost_suppliers', (select jsonb_build_object('count', count(*), 'hash', md5(coalesce(string_agg(t::text, E'\n' order by t.id), ''))) from public.cost_suppliers t),
    'cost_ingredients', (select jsonb_build_object('count', count(*), 'hash', md5(coalesce(string_agg(t::text, E'\n' order by t.id), ''))) from public.cost_ingredients t),
    'cost_preps', (select jsonb_build_object('count', count(*), 'hash', md5(coalesce(string_agg(t::text, E'\n' order by t.id), ''))) from public.cost_preps t),
    'cost_menu_items', (select jsonb_build_object('count', count(*), 'hash', md5(coalesce(string_agg(t::text, E'\n' order by t.id), ''))) from public.cost_menu_items t),
    'cost_recipe_lines', (select jsonb_build_object('count', count(*), 'hash', md5(coalesce(string_agg(t::text, E'\n' order by t.id), ''))) from public.cost_recipe_lines t),
    'cost_price_log', (select jsonb_build_object('count', count(*), 'hash', md5(coalesce(string_agg(t::text, E'\n' order by t.id), ''))) from public.cost_price_log t where t.changed_at >= p_since),
    'cost_specials', (select jsonb_build_object('count', count(*), 'hash', md5(coalesce(string_agg(t::text, E'\n' order by t.id), ''))) from public.cost_specials t),
    'cost_allowed_users', (select jsonb_build_object('count', count(*), 'hash', md5(coalesce(string_agg(t::text, E'\n' order by t.email), ''))) from public.cost_allowed_users t),
    'cost_gelato_serves', (select jsonb_build_object('count', count(*), 'hash', md5(coalesce(string_agg(t::text, E'\n' order by t.id), ''))) from public.cost_gelato_serves t),
    'cost_gelato_serve_lines', (select jsonb_build_object('count', count(*), 'hash', md5(coalesce(string_agg(t::text, E'\n' order by t.id), ''))) from public.cost_gelato_serve_lines t),
    'cost_beer_serves', (select jsonb_build_object('count', count(*), 'hash', md5(coalesce(string_agg(t::text, E'\n' order by t.id), ''))) from public.cost_beer_serves t),
    'cost_beers', (select jsonb_build_object('count', count(*), 'hash', md5(coalesce(string_agg(t::text, E'\n' order by t.id), ''))) from public.cost_beers t),
    'cost_beer_prices', (select jsonb_build_object('count', count(*), 'hash', md5(coalesce(string_agg(t::text, E'\n' order by t.id), ''))) from public.cost_beer_prices t),
    'cost_offers', (select jsonb_build_object('count', count(*), 'hash', md5(coalesce(string_agg(t::text, E'\n' order by t.id), ''))) from public.cost_offers t),
    'cost_offer_lines', (select jsonb_build_object('count', count(*), 'hash', md5(coalesce(string_agg(t::text, E'\n' order by t.id), ''))) from public.cost_offer_lines t),
    'cost_ingredient_deals', (select jsonb_build_object('count', count(*), 'hash', md5(coalesce(string_agg(t::text, E'\n' order by t.id), ''))) from public.cost_ingredient_deals t)
  );
$$;

revoke all on function public.cost_data_fingerprint(timestamptz) from public, anon;
grant execute on function public.cost_data_fingerprint(timestamptz) to authenticated;

-- Allergens (migration 20260925180000): tick on ingredients; preps and dishes inherit through recipe lines (see lib/allergens.ts).
-- Ingredients: confirmed allergen ids + diet flags (meat, fish, dairy, egg, honey), and whether a person has reviewed them.
-- Preps and menu items: chef overrides (add / remove) and a per-allergen "made without" note, e.g. {"milk": "no aioli"}.
-- Idempotent. Sets no values on existing rows (every ingredient starts unreviewed). RLS is unchanged (existing tables).
alter table public.cost_ingredients add column if not exists allergens text[] not null default '{}';
alter table public.cost_ingredients add column if not exists allergens_reviewed boolean not null default false;
alter table public.cost_ingredients add column if not exists diet_flags text[] not null default '{}';

alter table public.cost_preps add column if not exists allergen_add text[] not null default '{}';
alter table public.cost_preps add column if not exists allergen_remove text[] not null default '{}';
alter table public.cost_preps add column if not exists allergen_notes jsonb not null default '{}'::jsonb;

alter table public.cost_menu_items add column if not exists allergen_add text[] not null default '{}';
alter table public.cost_menu_items add column if not exists allergen_remove text[] not null default '{}';
alter table public.cost_menu_items add column if not exists allergen_notes jsonb not null default '{}'::jsonb;

-- A prep name is unique per venue (the same prep can exist at two venues). Mirrors migration preps_unique_name_venue.
alter table public.cost_preps drop constraint if exists cost_preps_name_key;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'cost_preps_name_venue_key') then
    alter table public.cost_preps add constraint cost_preps_name_venue_key unique (name, venue_id);
  end if;
end $$;

-- Change log (mirrors supabase/migrations/20260926200000_audit_log.sql)
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

-- Ingredient change history (mirrors supabase/migrations/20260927090000_ingredient_audit.sql)
drop trigger if exists cost_ingredients_audit on public.cost_ingredients;
create trigger cost_ingredients_audit after update on public.cost_ingredients
  for each row execute function public.cost_audit(
    'pack_size', 'pack_unit', 'yield_pct', 'rebate', 'price_inc_gst', 'gst_free', 'active', 'name', 'supplier_id', 'supplier_code'
  );

-- NOTE: the live database's price log trigger is cost_ing_price_log -> cost_log_price() (the definition near the top of this
-- file predates it). Brisbane-date version, applied 27 Sep 2026; keeps the live 'app' / 'system' defaults.
create or replace function public.cost_log_price()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if new.pack_price is distinct from old.pack_price then
    insert into cost_price_log(ingredient_id, old_price, new_price, source, entered_by)
    values (new.id, old.pack_price, new.pack_price, coalesce(new.source,'app'), coalesce(auth.jwt()->>'email','system'));
    new.previous_price = old.pack_price; new.last_price_update = (now() at time zone 'Australia/Brisbane')::date;
  end if; return new;
end $function$;

-- Bar display public read (mirrors supabase/migrations/20261002100000_bar_menu_function.sql)
create or replace function public.cost_bar_menu(p_venue text)
returns json
language sql
stable
security definer
set search_path = public
as $$
  select json_build_object(
    'venue', json_build_object('slug', v.slug, 'name', v.name),
    'items', coalesce((
      select json_agg(json_build_object(
          'id', mi.id,
          'name', mi.name,
          'category', mi.category,
          'glass', mi.glass,
          'photo', mi.bar_photo,
          'method', coalesce(mi.method, '[]'::jsonb),
          'garnish', coalesce(mi.garnish, '[]'::jsonb),
          'lines', coalesce((
            select json_agg(json_build_object(
                'name', coalesce(ing.name, pr.name),
                'qty', rl.qty,
                'unit', rl.unit,
                'note', rl.note
              ) order by rl.sort nulls last, rl.id)
            from cost_recipe_lines rl
            left join cost_ingredients ing on rl.component_type = 'ingredient' and ing.id = rl.component_id
            left join cost_preps pr on rl.component_type = 'prep' and pr.id = rl.component_id
            where rl.parent_type = 'item' and rl.parent_id = mi.id
          ), '[]'::json)
        ) order by mi.name)
      from cost_menu_items mi
      where mi.venue_id = v.id and mi.active and mi.category in ('Cocktail', 'Mocktail')
        and btrim(coalesce(mi.glass, '')) <> ''
        and coalesce(mi.method, '[]'::jsonb) <> '[]'::jsonb
    ), '[]'::json)
  )
  from cost_venues v
  where v.slug = p_venue;
$$;

revoke all on function public.cost_bar_menu(text) from public;
grant execute on function public.cost_bar_menu(text) to anon, authenticated;

comment on function public.cost_bar_menu(text) is 'Bar display (public iPad drinks station): one venue''s active cocktails/mocktails that have BOTH a glass and a method, with glass, method, garnish and recipe quantities. Display fields only, no prices or notes. Null when the venue slug does not exist.';

-- ---- Bar display photos (uploaded from the recipe editor); see supabase/migrations/20261003100000_bar_photos_storage.sql ----
-- Bar display photos uploaded from the recipe editor ("Upload Photo"). Public bucket: the drinks station iPads have no
-- login, so they read photos by plain URL (through the app's /bar/photo/ rewrite, so the iPad's offline copy can hold them).
-- Only signed-in allowed users (cost_allowed_users, same gate as every cost_* table) can add, replace or remove files.
-- Files are small by design: the editor shrinks every photo to a JPEG, 1200px on the long side, before uploading; the
-- 2 MB cap here is the backstop.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('bar-photos', 'bar-photos', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists bar_photos_select on storage.objects;
drop policy if exists bar_photos_insert on storage.objects;
drop policy if exists bar_photos_update on storage.objects;
drop policy if exists bar_photos_delete on storage.objects;

create policy bar_photos_select on storage.objects for select to authenticated
  using (bucket_id = 'bar-photos' and public.cost_is_allowed());
create policy bar_photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'bar-photos' and public.cost_is_allowed());
create policy bar_photos_update on storage.objects for update to authenticated
  using (bucket_id = 'bar-photos' and public.cost_is_allowed()) with check (bucket_id = 'bar-photos' and public.cost_is_allowed());
create policy bar_photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'bar-photos' and public.cost_is_allowed());

-- ---- Kitchen display (iPad kitchen station); see supabase/migrations/20261003110000_kitchen_display.sql ----
-- Kitchen display (iPad kitchen station, /kitchen/<venue>): how to make and plate a dish, how to make a prep, and a
-- per-record "Ready For Kitchen" sign-off. Nothing reaches the kitchen screen until the head chef ticks it.
alter table public.cost_menu_items
  add column if not exists kitchen_method jsonb,
  add column if not exists kitchen_plating jsonb,
  add column if not exists kitchen_photo text,
  add column if not exists kitchen_ready boolean not null default false;

alter table public.cost_preps
  add column if not exists kitchen_method jsonb,
  add column if not exists kitchen_storage text,
  add column if not exists kitchen_ready boolean not null default false;

comment on column public.cost_menu_items.kitchen_method is 'Kitchen display: ordered array of short make/assemble steps. Null when not written.';
comment on column public.cost_menu_items.kitchen_plating is 'Kitchen display: ordered array of plating points. Null when not written.';
comment on column public.cost_menu_items.kitchen_photo is 'Kitchen display: photo of the plated dish, an uploaded storage path ("uploads/...") in the bar-photos bucket. Null = none.';
comment on column public.cost_menu_items.kitchen_ready is 'Kitchen display: the head chef has checked this dish; only ready dishes show on the kitchen screen.';
comment on column public.cost_preps.kitchen_method is 'Kitchen display: ordered array of short method steps for the prep. Null when not written.';
comment on column public.cost_preps.kitchen_storage is 'Kitchen display: how to store it and how long it keeps, e.g. "Airtight container, fridge, 5 days".';
comment on column public.cost_preps.kitchen_ready is 'Kitchen display: the head chef has checked this prep; only ready preps show on the kitchen screen Prep tab and link from dishes.';

-- Public, read-only feed for one venue's kitchen station. The iPads have no login and every cost_* table is locked to
-- signed-in allowed users, so this SECURITY DEFINER function is the only thing anonymous visitors can call. It returns
-- DISPLAY fields only: names, weights, methods, plating, allergen data. No prices, costs, suppliers or internal notes.
-- Dishes: active Food items the head chef marked ready. Preps: ready ones, plus every prep those dishes (and ready preps)
-- use, however deep, so the allergen roll-up on the screen is complete. Ingredients: the ones those recipes use.
create or replace function public.cost_kitchen_data(p_venue text)
returns json
language sql
stable
security definer
set search_path = public
as $$
  with recursive
  v as (select id, slug, name from cost_venues where slug = p_venue),
  dishes as (
    select mi.* from cost_menu_items mi, v
    where mi.venue_id = v.id and mi.active and mi.category = 'Food' and mi.kitchen_ready
  ),
  all_preps(id) as (
    select p.id from cost_preps p, v where (p.venue_id = v.id or p.venue_id is null) and p.active and p.kitchen_ready
    union
    select rl.component_id from cost_recipe_lines rl join dishes d on rl.parent_type = 'item' and rl.parent_id = d.id
      where rl.component_type = 'prep'
    union
    select rl.component_id from cost_recipe_lines rl join all_preps ap on rl.parent_type = 'prep' and rl.parent_id = ap.id
      where rl.component_type = 'prep'
  ),
  used_lines as (
    select rl.* from cost_recipe_lines rl
    where (rl.parent_type = 'item' and rl.parent_id in (select id from dishes))
       or (rl.parent_type = 'prep' and rl.parent_id in (select id from all_preps))
  )
  select json_build_object(
    'venue', (select json_build_object('slug', slug, 'name', name) from v),
    'dishes', coalesce((
      select json_agg(json_build_object(
        'id', d.id, 'name', d.name, 'section', d.section, 'portions', d.portions,
        'method', coalesce(d.kitchen_method, '[]'::jsonb), 'plating', coalesce(d.kitchen_plating, '[]'::jsonb),
        'photo', d.kitchen_photo,
        'allergen_add', d.allergen_add, 'allergen_remove', d.allergen_remove, 'allergen_notes', d.allergen_notes
      ) order by d.name) from dishes d), '[]'::json),
    'preps', coalesce((
      select json_agg(json_build_object(
        'id', p.id, 'name', p.name, 'prep_type', p.prep_type, 'yield_qty', p.yield_qty, 'yield_unit', p.yield_unit,
        'active', p.active, 'ready', p.kitchen_ready,
        'method', coalesce(p.kitchen_method, '[]'::jsonb), 'storage', p.kitchen_storage,
        'allergen_add', p.allergen_add, 'allergen_remove', p.allergen_remove, 'allergen_notes', p.allergen_notes
      ) order by p.name) from cost_preps p where p.id in (select id from all_preps)), '[]'::json),
    'ingredients', coalesce((
      select json_agg(json_build_object(
        'id', i.id, 'name', i.name, 'allergens', i.allergens, 'allergens_reviewed', i.allergens_reviewed, 'diet_flags', i.diet_flags
      ) order by i.name) from cost_ingredients i
      where i.id in (select component_id from used_lines where component_type = 'ingredient')), '[]'::json),
    'lines', coalesce((
      select json_agg(json_build_object(
        'parent_type', ul.parent_type, 'parent_id', ul.parent_id, 'component_type', ul.component_type,
        'component_id', ul.component_id, 'qty', ul.qty, 'unit', ul.unit, 'note', ul.note, 'sort', ul.sort
      ) order by ul.parent_id, ul.sort, ul.id) from used_lines ul), '[]'::json)
  )
  where exists (select 1 from v);
$$;

revoke all on function public.cost_kitchen_data(text) from public;
grant execute on function public.cost_kitchen_data(text) to anon, authenticated;

comment on function public.cost_kitchen_data(text) is 'Kitchen display (public iPad kitchen station): one venue''s ready dishes and preps with the recipe lines, ingredient allergen data and overrides needed to roll allergens up. Display fields only, no prices or notes. Null when the venue slug does not exist.';

-- ---- Research notes (manager-only); see supabase/migrations/20261004120000_research_notes.sql ----
-- Research notes: manager-only suggestions and "sheet differs from the classic" flags on a recipe, with the cost and GP
-- effect worked out in the app from `changes`. Never shown on the public bar or kitchen stations (those read only their
-- own narrow SECURITY DEFINER functions, which do not touch this table).
create table if not exists public.cost_research_notes (
  id uuid primary key default gen_random_uuid(),
  item_id uuid references public.cost_menu_items (id) on delete cascade,
  prep_id uuid references public.cost_preps (id) on delete cascade,
  -- suggestion: research says add or change something; difference: the venue's sheet differs from the classic recipe
  kind text not null default 'suggestion' check (kind in ('suggestion', 'difference')),
  title text not null,
  body text not null default '',
  -- recipe change the note would make, so the app can price it: [{"ingredient_id": uuid, "qty": number, "unit": "g|kg|ml|L|each"}]
  -- qty is a DELTA: positive adds that much, negative takes that much off the line already in the recipe. Empty = no cost effect worked out.
  changes jsonb not null default '[]'::jsonb,
  -- [{"label": "Difford's Guide", "url": "https://..."}]
  sources jsonb not null default '[]'::jsonb,
  status text not null default 'open' check (status in ('open', 'approved', 'dismissed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (item_id is not null or prep_id is not null)
);

create index if not exists cost_research_notes_item_idx on public.cost_research_notes (item_id);
create index if not exists cost_research_notes_prep_idx on public.cost_research_notes (prep_id);
create index if not exists cost_research_notes_status_idx on public.cost_research_notes (status);

alter table public.cost_research_notes enable row level security;
drop policy if exists cost_allowed_all on public.cost_research_notes;
create policy cost_allowed_all on public.cost_research_notes for all to authenticated
  using (public.cost_is_allowed()) with check (public.cost_is_allowed());

create or replace function public.cost_research_notes_touch()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke execute on function public.cost_research_notes_touch() from public, anon, authenticated;

drop trigger if exists cost_research_notes_touch on public.cost_research_notes;
create trigger cost_research_notes_touch
before update on public.cost_research_notes
for each row execute function public.cost_research_notes_touch();

comment on table public.cost_research_notes is 'Manager-only research suggestions and sheet-vs-classic flags on a recipe (menu item or prep), with a priceable change list. Never exposed publicly.';

-- Bar display Pre-Mix Bottles page (mirrors supabase/migrations/20261004130000_bar_premix.sql)
-- Bar display: the "Pre-Mix Bottles" page on the drinks station (/bar/<venue>/premix).
-- At Drift and Greedy Gringo's the bar makes drink pre-mixes before service in 700 ml bottles labelled with the drink.
-- Each pre-mix is a cost_preps row with prep_type 'Pre-mix' (venue_id = the venue, yield 0.7 L) whose recipe lines are the
-- spirits and liqueurs that go in the bottle; a cocktail uses it through a recipe line with component_type 'prep'.
-- Same pattern as cost_bar_menu: the station has no login and every cost_* table is locked to signed-in allowed users,
-- so this SECURITY DEFINER function is the only door. DISPLAY fields only: names, yield, ingredient names with
-- quantities, and which drinks use each pre-mix with the amount. No prices, costs, targets, suppliers or notes.
create or replace function public.cost_bar_premix(p_venue text)
returns json
language sql
stable
security definer
set search_path = public
as $$
  select json_build_object(
    'venue', json_build_object('slug', v.slug, 'name', v.name),
    'premixes', coalesce((
      select json_agg(json_build_object(
          'id', p.id,
          'name', p.name,
          'yield_qty', p.yield_qty,
          'yield_unit', p.yield_unit,
          'lines', coalesce((
            select json_agg(json_build_object(
                'name', coalesce(ing.name, sub.name),
                'qty', rl.qty,
                'unit', rl.unit,
                'sort', rl.sort
              ) order by rl.sort, rl.id)
            from cost_recipe_lines rl
            left join cost_ingredients ing on rl.component_type = 'ingredient' and ing.id = rl.component_id
            left join cost_preps sub on rl.component_type = 'prep' and sub.id = rl.component_id
            where rl.parent_type = 'prep' and rl.parent_id = p.id
          ), '[]'::json),
          'used_in', coalesce((
            select json_agg(json_build_object(
                'drink', mi.name,
                'qty', ul.qty,
                'unit', ul.unit
              ) order by mi.name, ul.id)
            from cost_recipe_lines ul
            join cost_menu_items mi on mi.id = ul.parent_id
            where ul.parent_type = 'item' and ul.component_type = 'prep' and ul.component_id = p.id
              and mi.venue_id = v.id and mi.active and mi.category in ('Cocktail', 'Mocktail')
          ), '[]'::json)
        ) order by p.name)
      from cost_preps p
      where p.venue_id = v.id and p.active and lower(p.prep_type) = 'pre-mix'
    ), '[]'::json)
  )
  from cost_venues v
  where v.slug = p_venue;
$$;

revoke all on function public.cost_bar_premix(text) from public;
grant execute on function public.cost_bar_premix(text) to anon, authenticated;

comment on function public.cost_bar_premix(text) is 'Bar display (public iPad drinks station, Pre-Mix Bottles page): one venue''s active pre-mix preps (prep_type Pre-mix) with yield, ingredient lines and the active cocktails/mocktails that use each. Display fields only, no prices, costs or notes. Null when the venue slug does not exist.';

-- ---- Pre-Mix page: only bottles used by an active drink; see supabase/migrations/20261004140000_bar_premix_active.sql ----
create or replace function public.cost_bar_premix(p_venue text)
returns json
language sql
stable
security definer
set search_path = public
as $$
  select json_build_object(
    'venue', json_build_object('slug', v.slug, 'name', v.name),
    'premixes', coalesce((
      select json_agg(json_build_object(
          'id', p.id,
          'name', p.name,
          'yield_qty', p.yield_qty,
          'yield_unit', p.yield_unit,
          'lines', coalesce((
            select json_agg(json_build_object(
                'name', coalesce(ing.name, sub.name),
                'qty', rl.qty,
                'unit', rl.unit,
                'sort', rl.sort
              ) order by rl.sort, rl.id)
            from cost_recipe_lines rl
            left join cost_ingredients ing on rl.component_type = 'ingredient' and ing.id = rl.component_id
            left join cost_preps sub on rl.component_type = 'prep' and sub.id = rl.component_id
            where rl.parent_type = 'prep' and rl.parent_id = p.id
          ), '[]'::json),
          'used_in', coalesce((
            select json_agg(json_build_object(
                'drink', mi.name,
                'qty', ul.qty,
                'unit', ul.unit
              ) order by mi.name, ul.id)
            from cost_recipe_lines ul
            join cost_menu_items mi on mi.id = ul.parent_id
            where ul.parent_type = 'item' and ul.component_type = 'prep' and ul.component_id = p.id
              and mi.venue_id = v.id and mi.active and mi.category in ('Cocktail', 'Mocktail')
          ), '[]'::json)
        ) order by p.name)
      from cost_preps p
      where p.venue_id = v.id and p.active and lower(p.prep_type) = 'pre-mix'
        and exists (
          select 1 from cost_recipe_lines ul
          join cost_menu_items mi on mi.id = ul.parent_id
          where ul.parent_type = 'item' and ul.component_type = 'prep' and ul.component_id = p.id
            and mi.venue_id = v.id and mi.active and mi.category in ('Cocktail', 'Mocktail')
        )
    ), '[]'::json)
  )
  from cost_venues v
  where v.slug = p_venue;
$$;

revoke all on function public.cost_bar_premix(text) from public;
grant execute on function public.cost_bar_premix(text) to anon, authenticated;

comment on function public.cost_bar_premix(text) is 'Bar display (public iPad drinks station, Pre-Mix Bottles page): one venue''s active pre-mix preps (prep_type Pre-mix) with yield, ingredient lines and the active cocktails/mocktails that use each. Display fields only, no prices, costs or notes. Null when the venue slug does not exist.';

-- ---- Drinks Station carries cold drinks too; see supabase/migrations/20261005200000_bar_menu_cold_drinks.sql ----
-- cost_menu_items.category is plain text with no check constraint, so 'Cold Drink' needs no schema change; only the two public
-- station functions list the categories they carry. Both are redefined here with 'Cold Drink' added to that list and nothing
-- else changed (the glass-and-method rule of 20261004210000 and the active-drink rules of 20261004140000 stay as they were).
create or replace function public.cost_bar_menu(p_venue text)
returns json
language sql
stable
security definer
set search_path = public
as $$
  select json_build_object(
    'venue', json_build_object('slug', v.slug, 'name', v.name),
    'items', coalesce((
      select json_agg(json_build_object(
          'id', mi.id,
          'name', mi.name,
          'category', mi.category,
          'glass', mi.glass,
          'photo', mi.bar_photo,
          'method', coalesce(mi.method, '[]'::jsonb),
          'garnish', coalesce(mi.garnish, '[]'::jsonb),
          'lines', coalesce((
            select json_agg(json_build_object(
                'name', coalesce(ing.name, pr.name),
                'qty', rl.qty,
                'unit', rl.unit,
                'note', rl.note
              ) order by rl.sort nulls last, rl.id)
            from cost_recipe_lines rl
            left join cost_ingredients ing on rl.component_type = 'ingredient' and ing.id = rl.component_id
            left join cost_preps pr on rl.component_type = 'prep' and pr.id = rl.component_id
            where rl.parent_type = 'item' and rl.parent_id = mi.id
          ), '[]'::json)
        ) order by mi.name)
      from cost_menu_items mi
      where mi.venue_id = v.id and mi.active and mi.category in ('Cocktail', 'Mocktail', 'Cold Drink')
        and btrim(coalesce(mi.glass, '')) <> ''
        and coalesce(mi.method, '[]'::jsonb) <> '[]'::jsonb
    ), '[]'::json)
  )
  from cost_venues v
  where v.slug = p_venue;
$$;

revoke all on function public.cost_bar_menu(text) from public;
grant execute on function public.cost_bar_menu(text) to anon, authenticated;

comment on function public.cost_bar_menu(text) is 'Bar display (public iPad drinks station): one venue''s active cocktails, mocktails and cold drinks that have BOTH a glass and a method, with glass, method, garnish and recipe quantities. Display fields only, no prices or notes. Null when the venue slug does not exist.';

-- Pre-Mix Bottles page: a pre-mix is listed when an active cocktail, mocktail or cold drink uses it.
create or replace function public.cost_bar_premix(p_venue text)
returns json
language sql
stable
security definer
set search_path = public
as $$
  select json_build_object(
    'venue', json_build_object('slug', v.slug, 'name', v.name),
    'premixes', coalesce((
      select json_agg(json_build_object(
          'id', p.id,
          'name', p.name,
          'yield_qty', p.yield_qty,
          'yield_unit', p.yield_unit,
          'lines', coalesce((
            select json_agg(json_build_object(
                'name', coalesce(ing.name, sub.name),
                'qty', rl.qty,
                'unit', rl.unit,
                'sort', rl.sort
              ) order by rl.sort, rl.id)
            from cost_recipe_lines rl
            left join cost_ingredients ing on rl.component_type = 'ingredient' and ing.id = rl.component_id
            left join cost_preps sub on rl.component_type = 'prep' and sub.id = rl.component_id
            where rl.parent_type = 'prep' and rl.parent_id = p.id
          ), '[]'::json),
          'used_in', coalesce((
            select json_agg(json_build_object(
                'drink', mi.name,
                'qty', ul.qty,
                'unit', ul.unit
              ) order by mi.name, ul.id)
            from cost_recipe_lines ul
            join cost_menu_items mi on mi.id = ul.parent_id
            where ul.parent_type = 'item' and ul.component_type = 'prep' and ul.component_id = p.id
              and mi.venue_id = v.id and mi.active and mi.category in ('Cocktail', 'Mocktail', 'Cold Drink')
          ), '[]'::json)
        ) order by p.name)
      from cost_preps p
      where p.venue_id = v.id and p.active and lower(p.prep_type) = 'pre-mix'
        and exists (
          select 1 from cost_recipe_lines ul
          join cost_menu_items mi on mi.id = ul.parent_id
          where ul.parent_type = 'item' and ul.component_type = 'prep' and ul.component_id = p.id
            and mi.venue_id = v.id and mi.active and mi.category in ('Cocktail', 'Mocktail', 'Cold Drink')
        )
    ), '[]'::json)
  )
  from cost_venues v
  where v.slug = p_venue;
$$;

revoke all on function public.cost_bar_premix(text) from public;
grant execute on function public.cost_bar_premix(text) to anon, authenticated;

comment on function public.cost_bar_premix(text) is 'Bar display (public iPad drinks station, Pre-Mix Bottles page): one venue''s active pre-mix preps (prep_type Pre-mix) with yield, ingredient lines and the active cocktails, mocktails and cold drinks that use each. Display fields only, no prices, costs or notes. Null when the venue slug does not exist.';

-- ---- Bar glass and rim lists; see supabase/migrations/20261004150000_bar_options.sql ----
-- Shared drop-down lists for the recipe editor's Bar Display card: every glass type and every rim used at any venue.
-- A drink still stores one text value in cost_menu_items.glass ("High Ball Glass, Salt Rim") so the public cocktail
-- station is unchanged; these rows only feed the editor's Glass and Rim drop-downs and the "add a new one" pop-up.
create table if not exists public.cost_bar_options (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('glass', 'rim')),
  name text not null check (length(btrim(name)) > 0),
  sort int not null default 0,
  created_at timestamptz not null default now(),
  unique (kind, name)
);

alter table public.cost_bar_options enable row level security;
drop policy if exists cost_allowed_all on public.cost_bar_options;
create policy cost_allowed_all on public.cost_bar_options for all to authenticated
  using (public.cost_is_allowed()) with check (public.cost_is_allowed());

insert into public.cost_bar_options (kind, name, sort) values
  ('glass', 'Coupe Glass', 1), ('glass', 'Rocks Glass', 2), ('glass', 'Short Rocks Glass', 3), ('glass', 'High Ball Glass', 4),
  ('glass', 'Martini Glass', 5), ('glass', 'Margarita Glass', 6), ('glass', 'Wine Glass', 7), ('glass', 'Poco Glass', 8),
  ('glass', 'Mason Jar', 9), ('glass', 'Jug', 11), ('glass', 'Fishbowl', 12),
  ('rim', 'Salt', 1), ('rim', 'Chilli Salt', 2), ('rim', 'Coconut', 3), ('rim', 'Cinnamon Sugar', 4), ('rim', 'Sugar', 5)
on conflict (kind, name) do nothing;

comment on table public.cost_bar_options is 'Glass types and rims offered in the recipe editor Bar Display drop-downs (all venues). Display lists only; a drink stores its glass as text.';

-- ---- Research notes apply columns; see supabase/migrations/20261004160000_research_notes_apply.sql ----
-- Research notes that can be applied to the recipe when Approve is tapped.
--   method_step     a suggested method step to add (the app tidies it into the house style and picks its place)
--   method_replaces text of an existing step this suggestion replaces (optional)
--   answer_prompt   when set, the note is a question for the venue: Approve asks for a short typed answer first
--   applied         what Approve changed, so it can be undone or reopened:
--                   {"at": ts, "lines": [{"line_id", "before_qty", "after_qty"} or {"created_line_id"}], "method_before": [...], "method_after": [...]}
alter table public.cost_research_notes
  add column if not exists method_step text,
  add column if not exists method_replaces text,
  add column if not exists answer_prompt text,
  add column if not exists applied jsonb;

-- ---- Dietary options and seafood origin; see supabase/migrations/20261004170000_diet_options_seafood.sql ----
-- Dietary options and seafood origin.
-- cost_menu_items.diet_options: per-dish option flags the menu prints as letters, e.g.
--   {"gfo": {"note": "Swap the bun for a gluten free bun"}, "vo": {"note": "..."}, "vgo": {...}, "dfo": {...}}
-- A key present means the dish offers that option; the note says what changes. An option may also hold
-- removed (recipe line ids it leaves out), added (extra components) and surcharge_inc (10 Oct 2026). The hand-set marks
-- gf, v and vg (a person's declaration, 10 Oct 2026) live in the same column. The app never works out gluten free or dairy free.
-- cost_menu_items.seafood_label: the menu name or description markets the dish as seafood, so it needs an origin letter
-- (Country of Origin Information for Seafood for Immediate Consumption Information Standard 2025).
-- cost_ingredients.seafood_origin: 'A' Australian or 'I' imported (NZ counts as imported); null = unknown or not seafood.
-- cost_ingredients.seafood_exempt: seafood the standard exempts (fish sauce, canned tuna, bonito powder).
alter table public.cost_menu_items
  add column if not exists diet_options jsonb not null default '{}'::jsonb,
  add column if not exists seafood_label boolean not null default false;

alter table public.cost_ingredients
  add column if not exists seafood_origin text check (seafood_origin in ('A', 'I')),
  add column if not exists seafood_exempt boolean not null default false;

comment on column public.cost_menu_items.diet_options is 'Per-dish dietary options (gfo, vo, vgo, dfo), each with a required note and optionally removed (recipe line ids left out), added (extra components) and surcharge_inc; plus the hand-set marks gf, v, vg (a person''s declaration, never derived). The app never works out gluten free or dairy free.';
comment on column public.cost_menu_items.seafood_label is 'The menu wording markets this dish as seafood, so it needs an A / I / M origin letter.';
comment on column public.cost_ingredients.seafood_origin is 'Seafood origin: A Australian, I imported (including New Zealand). Null when unknown or not seafood.';
comment on column public.cost_ingredients.seafood_exempt is 'Seafood the Information Standard exempts from an origin label (fish sauce, canned tuna, bonito powder).';

-- ---- Kitchen feed: diet options and seafood; see supabase/migrations/20261004180000_kitchen_diet_seafood.sql ----
create or replace function public.cost_kitchen_data(p_venue text)
returns json
language sql
stable
security definer
set search_path = public
as $$
  with recursive
  v as (select id, slug, name from cost_venues where slug = p_venue),
  dishes as (
    select mi.* from cost_menu_items mi, v
    where mi.venue_id = v.id and mi.active and mi.category = 'Food' and mi.kitchen_ready
  ),
  all_preps(id) as (
    select p.id from cost_preps p, v where (p.venue_id = v.id or p.venue_id is null) and p.active and p.kitchen_ready
    union
    select rl.component_id from cost_recipe_lines rl join dishes d on rl.parent_type = 'item' and rl.parent_id = d.id
      where rl.component_type = 'prep'
    union
    select rl.component_id from cost_recipe_lines rl join all_preps ap on rl.parent_type = 'prep' and rl.parent_id = ap.id
      where rl.component_type = 'prep'
  ),
  used_lines as (
    select rl.* from cost_recipe_lines rl
    where (rl.parent_type = 'item' and rl.parent_id in (select id from dishes))
       or (rl.parent_type = 'prep' and rl.parent_id in (select id from all_preps))
  )
  select json_build_object(
    'venue', (select json_build_object('slug', slug, 'name', name) from v),
    'dishes', coalesce((
      select json_agg(json_build_object(
        'id', d.id, 'name', d.name, 'section', d.section, 'portions', d.portions,
        'method', coalesce(d.kitchen_method, '[]'::jsonb), 'plating', coalesce(d.kitchen_plating, '[]'::jsonb),
        'photo', d.kitchen_photo,
        'diet_options', d.diet_options, 'seafood_label', d.seafood_label,
        'allergen_add', d.allergen_add, 'allergen_remove', d.allergen_remove, 'allergen_notes', d.allergen_notes
      ) order by d.name) from dishes d), '[]'::json),
    'preps', coalesce((
      select json_agg(json_build_object(
        'id', p.id, 'name', p.name, 'prep_type', p.prep_type, 'yield_qty', p.yield_qty, 'yield_unit', p.yield_unit,
        'active', p.active, 'ready', p.kitchen_ready,
        'method', coalesce(p.kitchen_method, '[]'::jsonb), 'storage', p.kitchen_storage,
        'allergen_add', p.allergen_add, 'allergen_remove', p.allergen_remove, 'allergen_notes', p.allergen_notes
      ) order by p.name) from cost_preps p where p.id in (select id from all_preps)), '[]'::json),
    'ingredients', coalesce((
      select json_agg(json_build_object(
        'id', i.id, 'name', i.name, 'allergens', i.allergens, 'allergens_reviewed', i.allergens_reviewed, 'diet_flags', i.diet_flags,
        'seafood_origin', i.seafood_origin, 'seafood_exempt', i.seafood_exempt
      ) order by i.name) from cost_ingredients i
      where i.id in (select component_id from used_lines where component_type = 'ingredient')), '[]'::json),
    'lines', coalesce((
      select json_agg(json_build_object(
        'parent_type', ul.parent_type, 'parent_id', ul.parent_id, 'component_type', ul.component_type,
        'component_id', ul.component_id, 'qty', ul.qty, 'unit', ul.unit, 'note', ul.note, 'sort', ul.sort
      ) order by ul.parent_id, ul.sort, ul.id) from used_lines ul), '[]'::json)
  )
  where exists (select 1 from v);
$$;

revoke all on function public.cost_kitchen_data(text) from public;
grant execute on function public.cost_kitchen_data(text) to anon, authenticated;

comment on function public.cost_kitchen_data(text) is 'Kitchen display (public iPad kitchen station): one venue''s ready dishes and preps with the recipe lines, ingredient allergen data and overrides needed to roll allergens up. Display fields only, no prices or notes. Null when the venue slug does not exist.';

-- ---- Kitchen feed: dietary option swaps; see supabase/migrations/20261010120000_kitchen_diet_swaps.sql ----
-- Kitchen feed: dietary option swaps (Troy, 10 Oct 2026). A dish's diet_options entries can now hold `removed` (recipe line
-- ids the option leaves out), `added` (extra components) and `surcharge_inc` (a price). The kitchen iPad is public, so:
--   * `surcharge_inc` is STRIPPED from every option before it leaves the database (the feed never carries a price);
--   * every recipe line is sent with its own `id`, so a left-out line can be named;
--   * the preps and ingredients an option ADDS are included (their names and allergen data), so "Add Tamari 15 ml" can be read.
-- No schema change: the swap data lives inside the existing cost_menu_items.diet_options jsonb. Apply this BEFORE anyone saves
-- a surcharge. Malformed jsonb is skipped, never an error: a bad value in one dish must not break the public feed.
create or replace function public.cost_kitchen_data(p_venue text)
returns json
language sql
stable
security definer
set search_path = public
as $$
  with recursive
  v as (select id, slug, name from cost_venues where slug = p_venue),
  dishes as (
    select mi.* from cost_menu_items mi, v
    where mi.venue_id = v.id and mi.active and mi.category = 'Food' and mi.kitchen_ready
  ),
  option_added as (
    select case when jsonb_typeof(a.value) = 'object' then a.value->>'component_type' end as component_type,
           case when jsonb_typeof(a.value) = 'object' and (a.value->>'component_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                then (a.value->>'component_id')::uuid end as component_id
    from dishes d,
         jsonb_each(case when jsonb_typeof(d.diet_options) = 'object' then d.diet_options else '{}'::jsonb end) o,
         jsonb_array_elements(case when jsonb_typeof(o.value) = 'object' and jsonb_typeof(o.value->'added') = 'array' then o.value->'added' else '[]'::jsonb end) a
  ),
  all_preps(id) as (
    select p.id from cost_preps p, v where (p.venue_id = v.id or p.venue_id is null) and p.active and p.kitchen_ready
    union
    select rl.component_id from cost_recipe_lines rl join dishes d on rl.parent_type = 'item' and rl.parent_id = d.id
      where rl.component_type = 'prep'
    union
    select oa.component_id from option_added oa where oa.component_type = 'prep' and oa.component_id is not null
    union
    select rl.component_id from cost_recipe_lines rl join all_preps ap on rl.parent_type = 'prep' and rl.parent_id = ap.id
      where rl.component_type = 'prep'
  ),
  used_lines as (
    select rl.* from cost_recipe_lines rl
    where (rl.parent_type = 'item' and rl.parent_id in (select id from dishes))
       or (rl.parent_type = 'prep' and rl.parent_id in (select id from all_preps))
  )
  select json_build_object(
    'venue', (select json_build_object('slug', slug, 'name', name) from v),
    'dishes', coalesce((
      select json_agg(json_build_object(
        'id', d.id, 'name', d.name, 'section', d.section, 'portions', d.portions,
        'method', coalesce(d.kitchen_method, '[]'::jsonb), 'plating', coalesce(d.kitchen_plating, '[]'::jsonb),
        'photo', d.kitchen_photo,
        'diet_options', (
          select coalesce(jsonb_object_agg(e.key, case when jsonb_typeof(e.value) = 'object' then e.value - 'surcharge_inc' else e.value end), '{}'::jsonb)
          from jsonb_each(case when jsonb_typeof(d.diet_options) = 'object' then d.diet_options else '{}'::jsonb end) e),
        'seafood_label', d.seafood_label,
        'allergen_add', d.allergen_add, 'allergen_remove', d.allergen_remove, 'allergen_notes', d.allergen_notes
      ) order by d.name) from dishes d), '[]'::json),
    'preps', coalesce((
      select json_agg(json_build_object(
        'id', p.id, 'name', p.name, 'prep_type', p.prep_type, 'yield_qty', p.yield_qty, 'yield_unit', p.yield_unit,
        'active', p.active, 'ready', p.kitchen_ready,
        'method', coalesce(p.kitchen_method, '[]'::jsonb), 'storage', p.kitchen_storage,
        'allergen_add', p.allergen_add, 'allergen_remove', p.allergen_remove, 'allergen_notes', p.allergen_notes
      ) order by p.name) from cost_preps p where p.id in (select id from all_preps)), '[]'::json),
    'ingredients', coalesce((
      select json_agg(json_build_object(
        'id', i.id, 'name', i.name, 'allergens', i.allergens, 'allergens_reviewed', i.allergens_reviewed, 'diet_flags', i.diet_flags,
        'seafood_origin', i.seafood_origin, 'seafood_exempt', i.seafood_exempt
      ) order by i.name) from cost_ingredients i
      where i.id in (select component_id from used_lines where component_type = 'ingredient')
         or i.id in (select oa.component_id from option_added oa where oa.component_type = 'ingredient' and oa.component_id is not null)), '[]'::json),
    'lines', coalesce((
      select json_agg(json_build_object(
        'id', ul.id, 'parent_type', ul.parent_type, 'parent_id', ul.parent_id, 'component_type', ul.component_type,
        'component_id', ul.component_id, 'qty', ul.qty, 'unit', ul.unit, 'note', ul.note, 'sort', ul.sort
      ) order by ul.parent_id, ul.sort, ul.id) from used_lines ul), '[]'::json)
  )
  where exists (select 1 from v);
$$;

revoke all on function public.cost_kitchen_data(text) from public;
grant execute on function public.cost_kitchen_data(text) to anon, authenticated;

comment on function public.cost_kitchen_data(text) is 'Kitchen display (public iPad kitchen station): one venue''s ready dishes and preps with the recipe lines, ingredient allergen data and overrides needed to roll allergens up, plus each dietary option''s swap (never its surcharge). Display fields only, no prices or notes. Null when the venue slug does not exist.';

-- ---- Ignored alerts (Today feed); see supabase/migrations/20261004190000_ignored_alerts.sql ----
-- Ignored alerts: the Today feed's "Ignore" and its "Ignored" tab. One row per ignored alert, shared by everyone who can
-- sign in. `alert_key` says what was ignored and the state it was ignored in (see lib/ignored-alerts.ts), for example
-- 'below_target:<item id>:<price in cents>' or 'price_rise:<ingredient id>:<price log id>', so a later, different
-- situation (a new price rise, a changed price) is a new key and shows again. Restore deletes the row.
create table if not exists public.cost_ignored_alerts (
  id uuid primary key default gen_random_uuid(),
  alert_key text not null unique,
  kind text not null,
  -- where the alert opens in the app (a path such as /items/<id>), so the Ignored tab can link to it
  ref text,
  -- what the alert was called when it was ignored, so the Ignored tab can say what it was without recomputing it
  title text,
  ignored_by text,
  ignored_at timestamptz not null default now()
);

create index if not exists cost_ignored_alerts_ignored_at_idx on public.cost_ignored_alerts (ignored_at desc);

alter table public.cost_ignored_alerts enable row level security;
drop policy if exists cost_allowed_all on public.cost_ignored_alerts;
create policy cost_allowed_all on public.cost_ignored_alerts for all to authenticated
  using (public.cost_is_allowed()) with check (public.cost_is_allowed());

comment on table public.cost_ignored_alerts is 'Alerts on the Today feed that someone chose to ignore (shared by all signed-in users). Delete the row to restore the alert.';

-- ---- Research This Drink offer; see supabase/migrations/20261004200000_research_status.sql ----
-- Research This Drink: only a NEW cocktail or mocktail is offered the button.
-- cost_menu_items.research_status says where a drink is in that offer:
--   null       never offered (every drink that exists today, and every other category)
--   'offered'  a new cocktail or mocktail: the recipe page shows Research This Drink and Skip
--   'done'     the research ran and its notes were filed (the card is gone for good)
--   'skipped'  Skip was tapped (final)
-- Nullable with no default on purpose: the ~90 existing cocktails and mocktails stay null and never show the button.
-- Idempotent.
alter table public.cost_menu_items
  add column if not exists research_status text
  constraint cost_menu_items_research_status_check check (research_status in ('offered', 'done', 'skipped'));

comment on column public.cost_menu_items.research_status is 'Research This Drink offer: null = never offered, offered = new cocktail or mocktail awaiting a decision, done = research ran, skipped = Skip tapped.';

-- ---- Who Can Sign In names (owner only); mirrors supabase/migrations/20261004220000_allowed_user_names.sql ----
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

-- ---- Lock down the access-check helpers; mirrors supabase/migrations/20261004225900_lock_down_owner_checks.sql ----
-- Security tidy-up: the two access-check helpers answer true or false for the signed-in person and are only used by the
-- row rules, which apply to signed-in users. A signed-out visitor never needed to call them (the Supabase advisor flagged
-- them). Signed-in users keep EXECUTE. The two public iPad functions (cost_bar_menu, cost_bar_premix, cost_kitchen_data)
-- stay public on purpose: they return display fields only, never prices.
revoke execute on function public.cost_is_allowed() from public, anon;
revoke execute on function public.cost_is_owner() from public, anon;
grant execute on function public.cost_is_allowed() to authenticated, service_role;
grant execute on function public.cost_is_owner() to authenticated, service_role;

-- ---- Edit stamps (who last changed a dish or prep); mirrors supabase/migrations/20261004230000_edit_stamps.sql ----
-- Edit stamps: who last changed a dish or a prep, and when. The recipe editor uses them to tell the person who else has
-- been in the same record ("Brendan saved changes to this at 1:38pm"). The check itself compares content, not timestamps,
-- so these columns only add the name and a cheap optimistic guard; the app works without them.
--
--  * cost_menu_items and cost_preps already have updated_at (default now()) kept by the cost_item_touch / cost_prep_touch
--    triggers (cost_touch()). This adds updated_by text (nullable) and replaces those two triggers with cost_stamp_edit(),
--    which sets BOTH columns: updated_at = now(), updated_by = the signed-in email, or null when there is no JWT
--    (SQL editor, migrations, the service role). It never fails: any problem reading the JWT leaves updated_by null.
--    cost_touch() itself is left alone for any other table that uses it.
--  * A change to a recipe line also moves its parent's stamp, so a lines-only edit (including a removed line, which cannot
--    be attributed any other way) shows up on the dish or prep. Statement level triggers with transition tables: a save
--    of 10 lines is one parent update per statement (the app writes lines as one delete and one upsert), not 10.
--    The parent update is a plain stamp. The existing triggers on cost_menu_items only act on their own columns
--    (cost_menu_items_sell_price_log needs a changed sell or happy hour price; cost_menu_items_audit watches target_override
--    and active), so a stamp-only update writes no sell price log row and no audit row. Nothing here writes to
--    cost_recipe_lines, so there is no recursion.
-- Idempotent. No data is changed by this file.
alter table public.cost_menu_items add column if not exists updated_at timestamptz default now();
alter table public.cost_preps add column if not exists updated_at timestamptz default now();
alter table public.cost_menu_items add column if not exists updated_by text;
alter table public.cost_preps add column if not exists updated_by text;

comment on column public.cost_menu_items.updated_by is 'Email of the signed-in person who last changed this dish or its recipe lines; null for direct database work.';
comment on column public.cost_preps.updated_by is 'Email of the signed-in person who last changed this prep or its recipe lines; null for direct database work.';

create or replace function public.cost_stamp_edit()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  begin
    new.updated_by := nullif(auth.jwt() ->> 'email', '');
  exception when others then
    new.updated_by := null;
  end;
  return new;
end $$;
revoke execute on function public.cost_stamp_edit() from public, anon, authenticated;

drop trigger if exists cost_item_touch on public.cost_menu_items;
create trigger cost_item_touch before update on public.cost_menu_items
  for each row execute function public.cost_stamp_edit();
drop trigger if exists cost_prep_touch on public.cost_preps;
create trigger cost_prep_touch before update on public.cost_preps
  for each row execute function public.cost_stamp_edit();

-- Recipe line changes stamp the parent (the BEFORE UPDATE trigger above fills in who). Security definer so the stamp does
-- not depend on the caller's row level security; the caller could already change the lines.
create or replace function public.cost_recipe_lines_stamp_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.cost_menu_items set updated_at = now() where id in (select parent_id from new_rows where parent_type = 'item');
  update public.cost_preps set updated_at = now() where id in (select parent_id from new_rows where parent_type = 'prep');
  return null;
end $$;

create or replace function public.cost_recipe_lines_stamp_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.cost_menu_items set updated_at = now()
    where id in (select parent_id from new_rows where parent_type = 'item' union select parent_id from old_rows where parent_type = 'item');
  update public.cost_preps set updated_at = now()
    where id in (select parent_id from new_rows where parent_type = 'prep' union select parent_id from old_rows where parent_type = 'prep');
  return null;
end $$;

create or replace function public.cost_recipe_lines_stamp_delete()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.cost_menu_items set updated_at = now() where id in (select parent_id from old_rows where parent_type = 'item');
  update public.cost_preps set updated_at = now() where id in (select parent_id from old_rows where parent_type = 'prep');
  return null;
end $$;

revoke execute on function public.cost_recipe_lines_stamp_insert() from public, anon, authenticated;
revoke execute on function public.cost_recipe_lines_stamp_update() from public, anon, authenticated;
revoke execute on function public.cost_recipe_lines_stamp_delete() from public, anon, authenticated;

drop trigger if exists cost_recipe_lines_stamp_insert on public.cost_recipe_lines;
create trigger cost_recipe_lines_stamp_insert after insert on public.cost_recipe_lines
  referencing new table as new_rows for each statement execute function public.cost_recipe_lines_stamp_insert();
drop trigger if exists cost_recipe_lines_stamp_update on public.cost_recipe_lines;
create trigger cost_recipe_lines_stamp_update after update on public.cost_recipe_lines
  referencing old table as old_rows new table as new_rows for each statement execute function public.cost_recipe_lines_stamp_update();
drop trigger if exists cost_recipe_lines_stamp_delete on public.cost_recipe_lines;
create trigger cost_recipe_lines_stamp_delete after delete on public.cost_recipe_lines
  referencing old table as old_rows for each statement execute function public.cost_recipe_lines_stamp_delete();

-- ---- Full change history; mirrors supabase/migrations/20261004240000_change_history.sql ----
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

-- ---- Gelato dietary labels; see supabase/migrations/20261005100000_gelato_dietary_labels.sql ----
-- Gelato dietary labels: the six labels on the laminated Gelato Rumba "Dietary Requirements" sheet.
-- cost_preps.dietary_labels (gelato flavour mixes only; every other prep leaves it null):
--   null   Automatic. The labels are worked out from the flavour's ingredients in the app and never stored,
--          so a new flavour fills itself in as ingredients are added.
--   array  Set by hand (a person on the flavour page, or supabase/seed-gelato-dietary-labels.sql). The full list is
--          stored and the ingredients no longer change it.
-- Allowed ids: dairy_free, vegan, egg, soy, nuts, gluten. An empty array is a real answer (set by hand, no labels).
-- Nullable with no default on purpose: null is how a flavour stays Automatic.
-- The generic history trigger on cost_preps (cost_history_log) already records changes to the new column.
-- Idempotent.
alter table public.cost_preps
  add column if not exists dietary_labels text[]
  constraint cost_preps_dietary_labels_check check (dietary_labels is null or dietary_labels <@ array['dairy_free', 'vegan', 'egg', 'soy', 'nuts', 'gluten']::text[]);

comment on column public.cost_preps.dietary_labels is 'Gelato flavour dietary labels set by hand (dairy_free, vegan, egg, soy, nuts, gluten). Null = Automatic, worked out from the ingredients and never stored.';

-- ---- Ordering (drinks stock counts and supplier orders); see supabase/migrations/20261005300000_ordering_tables.sql ----
-- Ordering: weekly drinks stock counts and supplier orders, replacing the per-venue order workbooks (design:
-- files/research/stock-and-ordering-architecture-2026-10-05.md). Foundation only: tables, constraints, RLS, edit stamps and
-- change history. No UI yet, no data, no backfill.
--
--  * EVERYTHING is separate per venue: every table has venue_id (references cost_venues) and every parent/child link is a
--    composite foreign key (id, venue_id), so a product can never point at another venue's supplier or category, a count line
--    never at another venue's session, and so on. Nothing is shared between venues (a new venue may copy a list as a start).
--  * Tables: ordering_suppliers, ordering_categories, ordering_products, ordering_count_sessions, ordering_count_lines,
--    ordering_orders, ordering_order_lines, ordering_price_uploads, ordering_price_log.
--  * Count lines: no row means not counted; a row with a null quantity means not counted in that place; 0 is a deliberate
--    zero. client_uuid (unique) makes an offline retry idempotent. product_name, par_at_count and unit_name are snapshots so
--    old counts still read correctly after a product is renamed or its Build To changes.
--  * One in-progress count per venue (partial unique index): "Start Count" resumes it instead of starting a second.
--  * Order lines keep name, unit, item code and price as they were when the order was made ("orders already sent never change").
--  * RLS: everyone who can sign in sees and edits everything (cost_allowed_all via cost_is_allowed()), as every cost_* table.
--  * Edit stamps: updated_at and updated_by (the signed-in email) are kept by the existing cost_stamp_edit() trigger function,
--    on insert and update, for every editable table.
--  * Change history (cost_change_history): the generic cost_history_log() trigger is attached to suppliers, categories,
--    products (so a Build To change is logged with who, when and the old value), count sessions, count lines, orders and
--    price uploads. NOT tracked: ordering_order_lines (a snapshot saved together with its order, whose exact text is kept in
--    ordering_orders.body_text) and ordering_price_log (itself a history table).
--    Count lines are logged ONLY once their session is finalised: while a count is in progress every tap is saved but nothing
--    is recorded (hundreds of rows of noise), and once it is finalised every later insert, edit or delete is logged with the old
--    values (Troy: "anyone can edit a count at any time, the history shows who and the old value"). To do that this file
--    REPLACES public.cost_history_log() with the same function plus ONE additive branch, switched on by a fourth trigger
--    argument ('when_session_finalised'). Every existing trigger passes no fourth argument, so tg_argv[3] is null and their
--    behaviour is unchanged. To roll back, re-run the function from 20261004240000_change_history.sql.
-- Safe to apply to the live database: creates new tables only (plus the one function replace above). Idempotent (create ...
-- if not exists, drop trigger/policy if exists, create or replace). No data is touched.

-- ---------------------------------------------------------------- suppliers
create table if not exists public.ordering_suppliers (
  id uuid primary key default gen_random_uuid(),
  venue_id integer not null references public.cost_venues (id),
  name text not null check (btrim(name) <> ''),
  -- how the order goes out: email (a draft is opened), website (a login page, list is copied) or app (e.g. Ordermentum)
  method text not null default 'email' check (method in ('email', 'website', 'app')),
  email_to text,            -- one or more addresses (comma or semicolon separated) for the email draft
  login_url text,           -- website suppliers: where to log in and paste the list
  rep_name text,
  rep_phone text,
  account_no text,
  min_order_value numeric check (min_order_value is null or min_order_value >= 0),   -- dollars inc GST; a warning only
  min_order_units numeric check (min_order_units is null or min_order_units >= 0),   -- cartons, kegs or bottles; a warning only
  show_prices_on_order boolean not null default false,   -- Star and anyone who requires prices on the order
  notes text,
  active boolean not null default true,
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text,
  constraint ordering_suppliers_venue_name_key unique (venue_id, name),
  constraint ordering_suppliers_id_venue_key unique (id, venue_id)
);

-- ---------------------------------------------------------------- categories
create table if not exists public.ordering_categories (
  id uuid primary key default gen_random_uuid(),
  venue_id integer not null references public.cost_venues (id),
  name text not null check (btrim(name) <> ''),
  sort integer not null default 0,   -- the shelf order the count screen follows
  second_location_label text,        -- 'Bar' or 'Coldroom'; null means Store only
  unit_name text not null default 'carton',   -- the default unit for the category (carton, keg, bag, bottle)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text,
  constraint ordering_categories_venue_name_key unique (venue_id, name),
  constraint ordering_categories_id_venue_key unique (id, venue_id)
);

-- ---------------------------------------------------------------- products
create table if not exists public.ordering_products (
  id uuid primary key default gen_random_uuid(),
  venue_id integer not null references public.cost_venues (id),
  category_id uuid not null,
  sort integer not null default 0,
  name text not null check (btrim(name) <> ''),
  unit_name text not null,           -- what one counted and ordered unit is: carton, keg, bag, bottle
  supplier_id uuid,                  -- null: shown under "Unassigned" until someone picks a supplier
  supplier_item_code text,           -- e.g. Star's item number
  pack_multiple integer not null default 1 check (pack_multiple >= 1),   -- orders round UP to a multiple of this (Star spirits: 6 or 12)
  price_inc_gst numeric check (price_inc_gst is null or price_inc_gst >= 0),   -- price of one order unit
  ingredient_id uuid references public.cost_ingredients (id) on delete set null,   -- optional link to the costing ingredient
  costing_packs_per_unit numeric check (costing_packs_per_unit is null or costing_packs_per_unit > 0),   -- costing packs in one order unit (24 cans per carton)
  par numeric not null default 0 check (par >= 0),   -- "Build To", in the product's unit
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text,
  -- names repeat across categories at a venue (Coke as post-mix and as cans), so uniqueness is per category
  constraint ordering_products_venue_category_name_key unique (venue_id, category_id, name),
  constraint ordering_products_id_venue_key unique (id, venue_id),
  constraint ordering_products_category_fk foreign key (category_id, venue_id) references public.ordering_categories (id, venue_id),
  constraint ordering_products_supplier_fk foreign key (supplier_id, venue_id) references public.ordering_suppliers (id, venue_id)
);

-- ---------------------------------------------------------------- count sessions and lines
create table if not exists public.ordering_count_sessions (
  id uuid primary key default gen_random_uuid(),
  venue_id integer not null references public.cost_venues (id),
  started_by text,
  started_at timestamptz not null default now(),
  status text not null default 'in_progress' check (status in ('in_progress', 'finalised')),
  finalised_by text,
  finalised_at timestamptz,
  note text,
  source text,   -- null for a count taken in the app; 'sheet-import' for a count brought in from the old workbook
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text,
  constraint ordering_count_sessions_id_venue_key unique (id, venue_id)
);
-- one count in progress per venue: Start Count resumes it
create unique index if not exists ordering_count_sessions_one_open_idx on public.ordering_count_sessions (venue_id) where status = 'in_progress';

create table if not exists public.ordering_count_lines (
  id uuid primary key default gen_random_uuid(),
  venue_id integer not null references public.cost_venues (id),
  session_id uuid not null,
  product_id uuid not null,
  store_qty numeric check (store_qty is null or store_qty >= 0),    -- null: not counted in the store
  second_qty numeric check (second_qty is null or second_qty >= 0), -- null: not counted in the second place (Bar or Coldroom)
  counted_by text,
  counted_at timestamptz,            -- the device's clock when the person tapped; last write wins on sync
  client_uuid uuid,                  -- set by the device so a retried offline edit never saves twice
  product_name text,                 -- snapshots, so the count still reads right after a rename or a new Build To
  par_at_count numeric,
  unit_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text,
  constraint ordering_count_lines_session_product_key unique (session_id, product_id),
  constraint ordering_count_lines_client_uuid_key unique (client_uuid),
  constraint ordering_count_lines_session_fk foreign key (session_id, venue_id) references public.ordering_count_sessions (id, venue_id) on delete cascade,
  constraint ordering_count_lines_product_fk foreign key (product_id, venue_id) references public.ordering_products (id, venue_id)
);

-- ---------------------------------------------------------------- orders
create table if not exists public.ordering_orders (
  id uuid primary key default gen_random_uuid(),
  venue_id integer not null references public.cost_venues (id),
  supplier_id uuid not null,
  session_id uuid references public.ordering_count_sessions (id) on delete set null,   -- null for a top-up order
  status text not null default 'draft' check (status in ('draft', 'sent')),
  kind text not null default 'count' check (kind in ('count', 'top_up')),
  sent_by text,
  sent_at timestamptz,
  method text check (method is null or method in ('email', 'outlook', 'copy', 'website', 'other')),   -- how it was sent
  subject text,
  body_text text,                    -- the exact text that was sent or copied
  warning_text text,                 -- e.g. the minimum order warning shown at the time
  show_prices boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text,
  constraint ordering_orders_id_venue_key unique (id, venue_id),
  constraint ordering_orders_supplier_fk foreign key (supplier_id, venue_id) references public.ordering_suppliers (id, venue_id)
);

create table if not exists public.ordering_order_lines (
  id uuid primary key default gen_random_uuid(),
  venue_id integer not null references public.cost_venues (id),
  order_id uuid not null,
  product_id uuid references public.ordering_products (id) on delete set null,
  product_name text not null,        -- snapshots as at the order
  supplier_item_code text,
  unit_name text,
  suggested_qty numeric,
  ordered_qty numeric not null check (ordered_qty >= 0),
  pack_multiple integer,
  price_inc_gst numeric,
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text,
  constraint ordering_order_lines_order_fk foreign key (order_id, venue_id) references public.ordering_orders (id, venue_id) on delete cascade
);

-- ---------------------------------------------------------------- price uploads and log (tables only for now)
create table if not exists public.ordering_price_uploads (
  id uuid primary key default gen_random_uuid(),
  venue_id integer not null references public.cost_venues (id),   -- one row per venue the upload was applied to
  supplier_id uuid references public.ordering_suppliers (id) on delete set null,
  file_name text not null,
  uploaded_by text,
  uploaded_at timestamptz not null default now(),
  rows_matched integer not null default 0,
  rows_changed integer not null default 0,
  rows_unmatched integer not null default 0,
  updated_costing boolean not null default false,   -- the linked costing ingredients were updated too
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text
);

create table if not exists public.ordering_price_log (
  id uuid primary key default gen_random_uuid(),
  venue_id integer not null references public.cost_venues (id),
  product_id uuid not null references public.ordering_products (id) on delete cascade,
  old_price numeric,
  new_price numeric,
  upload_id uuid references public.ordering_price_uploads (id) on delete set null,
  changed_by text,
  changed_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- indexes (venue first, then every foreign key)
create index if not exists ordering_suppliers_venue_idx on public.ordering_suppliers (venue_id, sort, name);
create index if not exists ordering_categories_venue_idx on public.ordering_categories (venue_id, sort, name);
create index if not exists ordering_products_venue_idx on public.ordering_products (venue_id, category_id, sort, name);
create index if not exists ordering_products_supplier_idx on public.ordering_products (supplier_id) where supplier_id is not null;
create index if not exists ordering_products_category_idx on public.ordering_products (category_id);
create index if not exists ordering_products_ingredient_idx on public.ordering_products (ingredient_id) where ingredient_id is not null;
create index if not exists ordering_count_sessions_venue_idx on public.ordering_count_sessions (venue_id, started_at desc);
create index if not exists ordering_count_lines_venue_product_idx on public.ordering_count_lines (venue_id, product_id);
create index if not exists ordering_count_lines_product_idx on public.ordering_count_lines (product_id);
create index if not exists ordering_orders_venue_idx on public.ordering_orders (venue_id, created_at desc);
create index if not exists ordering_orders_supplier_idx on public.ordering_orders (supplier_id);
create index if not exists ordering_orders_session_idx on public.ordering_orders (session_id) where session_id is not null;
create index if not exists ordering_order_lines_order_idx on public.ordering_order_lines (order_id, sort);
create index if not exists ordering_order_lines_venue_product_idx on public.ordering_order_lines (venue_id, product_id) where product_id is not null;
create index if not exists ordering_price_uploads_venue_idx on public.ordering_price_uploads (venue_id, uploaded_at desc);
create index if not exists ordering_price_uploads_supplier_idx on public.ordering_price_uploads (supplier_id) where supplier_id is not null;
create index if not exists ordering_price_log_product_idx on public.ordering_price_log (product_id, changed_at desc);
create index if not exists ordering_price_log_venue_idx on public.ordering_price_log (venue_id, changed_at desc);
create index if not exists ordering_price_log_upload_idx on public.ordering_price_log (upload_id) where upload_id is not null;

-- ---------------------------------------------------------------- row level security (same as every cost_* table)
alter table public.ordering_suppliers enable row level security;
drop policy if exists cost_allowed_all on public.ordering_suppliers;
create policy cost_allowed_all on public.ordering_suppliers for all to authenticated
  using (public.cost_is_allowed()) with check (public.cost_is_allowed());

alter table public.ordering_categories enable row level security;
drop policy if exists cost_allowed_all on public.ordering_categories;
create policy cost_allowed_all on public.ordering_categories for all to authenticated
  using (public.cost_is_allowed()) with check (public.cost_is_allowed());

alter table public.ordering_products enable row level security;
drop policy if exists cost_allowed_all on public.ordering_products;
create policy cost_allowed_all on public.ordering_products for all to authenticated
  using (public.cost_is_allowed()) with check (public.cost_is_allowed());

alter table public.ordering_count_sessions enable row level security;
drop policy if exists cost_allowed_all on public.ordering_count_sessions;
create policy cost_allowed_all on public.ordering_count_sessions for all to authenticated
  using (public.cost_is_allowed()) with check (public.cost_is_allowed());

alter table public.ordering_count_lines enable row level security;
drop policy if exists cost_allowed_all on public.ordering_count_lines;
create policy cost_allowed_all on public.ordering_count_lines for all to authenticated
  using (public.cost_is_allowed()) with check (public.cost_is_allowed());

alter table public.ordering_orders enable row level security;
drop policy if exists cost_allowed_all on public.ordering_orders;
create policy cost_allowed_all on public.ordering_orders for all to authenticated
  using (public.cost_is_allowed()) with check (public.cost_is_allowed());

alter table public.ordering_order_lines enable row level security;
drop policy if exists cost_allowed_all on public.ordering_order_lines;
create policy cost_allowed_all on public.ordering_order_lines for all to authenticated
  using (public.cost_is_allowed()) with check (public.cost_is_allowed());

alter table public.ordering_price_uploads enable row level security;
drop policy if exists cost_allowed_all on public.ordering_price_uploads;
create policy cost_allowed_all on public.ordering_price_uploads for all to authenticated
  using (public.cost_is_allowed()) with check (public.cost_is_allowed());

alter table public.ordering_price_log enable row level security;
drop policy if exists cost_allowed_all on public.ordering_price_log;
create policy cost_allowed_all on public.ordering_price_log for all to authenticated
  using (public.cost_is_allowed()) with check (public.cost_is_allowed());

-- ---------------------------------------------------------------- edit stamps (updated_at, updated_by)
drop trigger if exists ordering_suppliers_stamp on public.ordering_suppliers;
create trigger ordering_suppliers_stamp before insert or update on public.ordering_suppliers
  for each row execute function public.cost_stamp_edit();
drop trigger if exists ordering_categories_stamp on public.ordering_categories;
create trigger ordering_categories_stamp before insert or update on public.ordering_categories
  for each row execute function public.cost_stamp_edit();
drop trigger if exists ordering_products_stamp on public.ordering_products;
create trigger ordering_products_stamp before insert or update on public.ordering_products
  for each row execute function public.cost_stamp_edit();
drop trigger if exists ordering_count_sessions_stamp on public.ordering_count_sessions;
create trigger ordering_count_sessions_stamp before insert or update on public.ordering_count_sessions
  for each row execute function public.cost_stamp_edit();
drop trigger if exists ordering_count_lines_stamp on public.ordering_count_lines;
create trigger ordering_count_lines_stamp before insert or update on public.ordering_count_lines
  for each row execute function public.cost_stamp_edit();
drop trigger if exists ordering_orders_stamp on public.ordering_orders;
create trigger ordering_orders_stamp before insert or update on public.ordering_orders
  for each row execute function public.cost_stamp_edit();
drop trigger if exists ordering_order_lines_stamp on public.ordering_order_lines;
create trigger ordering_order_lines_stamp before insert or update on public.ordering_order_lines
  for each row execute function public.cost_stamp_edit();
drop trigger if exists ordering_price_uploads_stamp on public.ordering_price_uploads;
create trigger ordering_price_uploads_stamp before insert or update on public.ordering_price_uploads
  for each row execute function public.cost_stamp_edit();

-- ---------------------------------------------------------------- change history
-- The function below is cost_history_log() exactly as in 20261004240000_change_history.sql plus one block, marked NEW, that
-- returns early for a count line whose session is not finalised (only when the trigger passes 'when_session_finalised').
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

    -- NEW: ordering count lines are recorded only after their count is finalised (fourth trigger argument)
    if tg_argv[3] = 'when_session_finalised' then
      if not exists (
        select 1 from public.ordering_count_sessions s
        where s.id = nullif(r ->> 'session_id', '')::uuid and s.status = 'finalised'
      ) then
        return null;
      end if;
    end if;

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

drop trigger if exists ordering_suppliers_history on public.ordering_suppliers;
create trigger ordering_suppliers_history after insert or update or delete on public.ordering_suppliers
  for each row execute function public.cost_history_log('id');
drop trigger if exists ordering_categories_history on public.ordering_categories;
create trigger ordering_categories_history after insert or update or delete on public.ordering_categories
  for each row execute function public.cost_history_log('id');
drop trigger if exists ordering_products_history on public.ordering_products;
create trigger ordering_products_history after insert or update or delete on public.ordering_products
  for each row execute function public.cost_history_log('id');
drop trigger if exists ordering_count_sessions_history on public.ordering_count_sessions;
create trigger ordering_count_sessions_history after insert or update or delete on public.ordering_count_sessions
  for each row execute function public.cost_history_log('id');
drop trigger if exists ordering_count_lines_history on public.ordering_count_lines;
create trigger ordering_count_lines_history after insert or update or delete on public.ordering_count_lines
  for each row execute function public.cost_history_log('id', 'ordering_count_sessions', 'session_id', 'when_session_finalised');
drop trigger if exists ordering_orders_history on public.ordering_orders;
create trigger ordering_orders_history after insert or update or delete on public.ordering_orders
  for each row execute function public.cost_history_log('id');
drop trigger if exists ordering_price_uploads_history on public.ordering_price_uploads;
create trigger ordering_price_uploads_history after insert or update or delete on public.ordering_price_uploads
  for each row execute function public.cost_history_log('id');

comment on table public.ordering_suppliers is 'Ordering: one venue''s suppliers (how to send an order, rep, account, minimum order, whether to print prices). Separate per venue.';
comment on table public.ordering_categories is 'Ordering: one venue''s count categories in shelf order, with the second place label (null = Store only) and the default unit.';
comment on table public.ordering_products is 'Ordering: one venue''s drinks products with unit, supplier, item code, pack multiple, price, Build To (par) and an optional link to a costing ingredient.';
comment on table public.ordering_count_sessions is 'Ordering: a weekly stock count for one venue (in_progress then finalised). One in progress per venue.';
comment on table public.ordering_count_lines is 'Ordering: one product''s counted quantities in a session. No row = not counted; null quantity = not counted in that place; 0 = deliberate zero. Edits after the session is finalised are logged in cost_change_history.';
comment on table public.ordering_orders is 'Ordering: one supplier order for one venue (from a count, or a top-up), with the exact text that was sent.';
comment on table public.ordering_order_lines is 'Ordering: the lines of an order, with name, unit, code and price as they were when the order was made.';
comment on table public.ordering_price_uploads is 'Ordering: a supplier price sheet applied to one venue (who, when, file, how many rows matched, changed and unmatched).';
comment on table public.ordering_price_log is 'Ordering: every change to a product''s order price (old and new, who, when, and the upload it came from).';

-- Ordering: a count in progress can be cancelled (set aside, never deleted).
-- A cancelled count frees the "one count in progress per venue" slot, never becomes "last count" and is never used for orders.
-- Who cancelled it and when is in updated_by / updated_at and the Change Log (the sessions table is already tracked).
alter table public.ordering_count_sessions drop constraint if exists ordering_count_sessions_status_check;
alter table public.ordering_count_sessions add constraint ordering_count_sessions_status_check check (status in ('in_progress', 'finalised', 'cancelled'));

-- Mirrors supabase/migrations/20261009100000_remove_carafe_glass.sql: "carafe" is always "jug" (Troy, 9 Oct 2026).
delete from public.cost_bar_options where kind = 'glass' and name = 'Carafe';

-- Mirrors supabase/migrations/20261009110000_beer_serves_not_sold_at.sql: Chiobu (2) and Greedy (3) pour only the Schooner and the Jug (Troy, 9 Oct 2026).
alter table public.cost_beer_serves add column if not exists not_sold_at integer[] not null default '{}';
update public.cost_beer_serves set not_sold_at = '{2,3}' where name in ('Pot', 'Pint');

-- Mirrors supabase/migrations/20261009120000_beer_serves_tiger.sql (Troy, 9 Oct 2026): Pot is not sold anywhere, a 500ml Glass serve exists, and a beer can list the only serves it pours.
update public.cost_beer_serves set not_sold_at = '{1,2,3}' where name = 'Pot';
insert into public.cost_beer_serves (name, sort, ml, not_sold_at) values ('500ml Glass', 3, 500, '{1,2,3}') on conflict (name) do nothing;
update public.cost_beer_serves set sort = 4 where name = 'Pint' and sort = 3;
update public.cost_beer_serves set sort = 5 where name = 'Jug' and sort = 4;
alter table public.cost_beers add column if not exists only_serves uuid[];

-- Mirrors supabase/migrations/20261010100000_menu_item_groups.sql (Troy, 10 Oct 2026): display grouping for the Drinks Station, nothing in costing reads it.
alter table public.cost_menu_items add column if not exists menu_group text;
comment on column public.cost_menu_items.menu_group is 'Display grouping only: items at the same venue sharing this name show as one card on the Drinks Station that opens to the flavours. Null = stands alone. Not used by costing, alerts or GP.';

-- Mirrors supabase/migrations/20261010110000_bar_menu_group.sql. Drinks Station: each item carries its menu group (cost_menu_items.menu_group, migration 20261010100000) so the iPad can show
-- items such as the Kids Milkshakes or the Spiders as one card that opens to the flavours. The function is the current
-- cost_bar_menu (20261005200000) with that one key added to the item object and nothing else changed. APPLY 20261010100000 FIRST:
-- this body reads mi.menu_group, so it fails to create until that column exists. Display only: still no prices or notes.
create or replace function public.cost_bar_menu(p_venue text)
returns json
language sql
stable
security definer
set search_path = public
as $$
  select json_build_object(
    'venue', json_build_object('slug', v.slug, 'name', v.name),
    'items', coalesce((
      select json_agg(json_build_object(
          'id', mi.id,
          'name', mi.name,
          'category', mi.category,
          'glass', mi.glass,
          'photo', mi.bar_photo,
          'menu_group', mi.menu_group,
          'method', coalesce(mi.method, '[]'::jsonb),
          'garnish', coalesce(mi.garnish, '[]'::jsonb),
          'lines', coalesce((
            select json_agg(json_build_object(
                'name', coalesce(ing.name, pr.name),
                'qty', rl.qty,
                'unit', rl.unit,
                'note', rl.note
              ) order by rl.sort nulls last, rl.id)
            from cost_recipe_lines rl
            left join cost_ingredients ing on rl.component_type = 'ingredient' and ing.id = rl.component_id
            left join cost_preps pr on rl.component_type = 'prep' and pr.id = rl.component_id
            where rl.parent_type = 'item' and rl.parent_id = mi.id
          ), '[]'::json)
        ) order by mi.name)
      from cost_menu_items mi
      where mi.venue_id = v.id and mi.active and mi.category in ('Cocktail', 'Mocktail', 'Cold Drink')
        and btrim(coalesce(mi.glass, '')) <> ''
        and coalesce(mi.method, '[]'::jsonb) <> '[]'::jsonb
    ), '[]'::json)
  )
  from cost_venues v
  where v.slug = p_venue;
$$;

revoke all on function public.cost_bar_menu(text) from public;
grant execute on function public.cost_bar_menu(text) to anon, authenticated;

comment on function public.cost_bar_menu(text) is 'Bar display (public iPad drinks station): one venue''s active cocktails, mocktails and cold drinks that have BOTH a glass and a method, with glass, method, garnish and recipe quantities. Display fields only, no prices or notes. Null when the venue slug does not exist.';

-- ---- Dish allergens; see supabase/migrations/20261010130000_dish_allergens.sql ----
-- Dish allergens (Troy, 10 Oct 2026): a dish's OWN hand-listed allergens section, the only allergen data the Allergy Matrix reads.
-- cost_menu_items.dish_allergens is nullable jsonb:
--   { "contains":     ["milk", "gluten", ...],               allergen ids (lib/allergens.ts) the dish contains as written on the menu
--     "without":      { "milk": "no aioli", ... },           how it can be made without one (the id must also be in contains)
--     "confirmed_at": "2026-10-10T03:12:00Z",                the head chef's sign-off; absent = not signed off
--     "confirmed_by": "chef@example.com" }                   who signed it off (never sent to the public kitchen feed)
-- Null = the dish has no section yet (the matrix shows Not checked). ANY edit to contains or without removes the sign-off; that rule
-- lives in the app (lib/dish-allergens.ts), the database only keeps the value an object.
-- Nullable with no default, so existing rows and the app work before and after this is applied. It is an ordinary column on the row,
-- so the change history trigger, Trash restore, Duplicate, What If and the edit conflict check carry it with no further change.
-- Idempotent.
alter table public.cost_menu_items add column if not exists dish_allergens jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'cost_menu_items_dish_allergens_object') then
    alter table public.cost_menu_items
      add constraint cost_menu_items_dish_allergens_object check (dish_allergens is null or jsonb_typeof(dish_allergens) = 'object');
  end if;
end $$;

comment on column public.cost_menu_items.dish_allergens is 'The dish''s own hand-listed allergens: contains (allergen ids), without (id to a "made without" note), confirmed_at and confirmed_by (the sign-off). Null = no section yet. Read only by the Allergy Matrix; never derived from ingredients.';

-- ---- Allergy Matrix print log; see supabase/migrations/20261010150000_matrix_prints.sql ----
-- Allergy Matrix print log (Troy, 10 Oct 2026). Every time a matrix is printed from /matrix/print the app writes one row here, so each
-- printed sheet has a version number and the costing app can say "Last printed 10 Oct 2026, version 3" and "Changed since printed:
-- 2 added, 1 removed, 3 changed".
--   venue_id  the venue the sheet belongs to (a sheet is always one venue)
--   section   the menu section on the sheet, or '*' for the All Sections print
--   version   1, 2, 3 ... per (venue, section): the previous highest + 1 (the app reads the highest, the unique key stops a double write)
--   snapshot  { "<dish id>": "<short stable hash of that dish's printed row>" }: name, section, every cell state and note, and whether the
--             sign-off was valid. Comparing it with the matrix as it is now says which dishes were added, removed or changed since.
-- Read and insert only, for people on the allowed list (cost_is_allowed()). No update or delete policy: a print happened, it is never
-- edited. NOT tracked by the change history trigger (it is a log, not a record anyone edits). Idempotent.
create table if not exists public.cost_matrix_prints (
  id uuid primary key default gen_random_uuid(),
  venue_id integer not null references public.cost_venues (id),
  section text not null,
  version integer not null check (version >= 1),
  printed_at timestamptz not null default now(),
  printed_by text,
  snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(snapshot) = 'object'),
  unique (venue_id, section, version)
);

create index if not exists cost_matrix_prints_venue_idx on public.cost_matrix_prints (venue_id, section, version desc);

alter table public.cost_matrix_prints enable row level security;
drop policy if exists cost_matrix_prints_select on public.cost_matrix_prints;
create policy cost_matrix_prints_select on public.cost_matrix_prints for select to authenticated using (public.cost_is_allowed());
drop policy if exists cost_matrix_prints_insert on public.cost_matrix_prints;
create policy cost_matrix_prints_insert on public.cost_matrix_prints for insert to authenticated with check (public.cost_is_allowed());

comment on table public.cost_matrix_prints is 'Allergy Matrix print log: one row per print of a venue section (or * for all sections) with a version number and a hash snapshot of each dish row, so the app can say what changed since the last print. Insert and select only.';

-- ---- Venue cross-contact line; see supabase/migrations/20261010160000_cross_contact_setting.sql ----
-- Venue cross-contact line (Troy, 10 Oct 2026): a short standing line per venue, printed in the footer of every Allergy Matrix sheet
-- and shown on the kitchen iPad matrix ("Shared fryer and grill: cross-contact is possible. Ask the head chef if unsure.").
-- cost_settings.value is numeric, so it cannot hold text. The smallest change is one nullable text column beside it:
--   key = 'cross_contact_<venue slug>' (for example cross_contact_drift), value = 0, text_value = the line.
-- Everything else reads only the keys it knows (gst_rate, round_to, alert_pct, gelato_wastage), so these rows are invisible to costing.
-- cost_settings already has the audit and change history triggers, so an edit lands in the Change Log with no further change.
-- A venue with no row (or a blank text_value) uses the default line in the app and in cost_kitchen_matrix. Idempotent.
alter table public.cost_settings add column if not exists text_value text;

comment on column public.cost_settings.text_value is 'Text settings: key cross_contact_<venue slug> holds that venue''s standing cross-contact line (value is 0 for these rows).';

-- ---- Kitchen Allergy Matrix feed (re-check rule on components AND allergen ticks, cross-contact line); supersedes 20261010170000_kitchen_matrix_recheck.sql (and 20261010140000_kitchen_matrix.sql), see supabase/migrations/20261010180000_kitchen_matrix_ticks.sql ----
-- Kitchen Allergy Matrix feed, ingredient-first allergens (Troy, 10 Oct 2026). Replaces cost_kitchen_matrix (20261010170000) with ONE addition
-- to the re-check rule, so the public iPad can never show green for a dish whose allergen ticks changed after it was confirmed.
--
-- Allergens are now ticked only on ingredients and a dish's allergens are worked out from them, so a sign-off is valid only while BOTH hold:
--   1. the dish's components (ingredients and preps, through nested preps, depth 8) equal dish_allergens.components, as before; AND
--   2. dish_allergens.ticks (the snapshot stored at Confirm) EQUALS the live snapshot built here from the live tables:
--        "ingredient:<id>" -> { a: allergens of the ingredient limited to the 15 main ids, r: allergens_reviewed is true }
--        "prep:<id>"       -> { add: allergen_add limited to the 15 main ids, rem: allergen_remove limited to the 15 main ids }
--        "item:<dishId>"   -> the dish itself, same shape as a prep
--      every id array is sorted in the fixed CONTAINS_IDS order (gluten, crustacea, egg, fish, milk, peanuts, sesame, soy, tree_nuts,
--      lupin, molluscs, sulphites, chilli, onion_garlic, nitrites; never alcohol) and is [] when empty. The comparison is jsonb equality:
--      key order does not matter, array order does, so the app must store the arrays in that order (lib/dish-allergens.ts).
--   A sign-off with no ticks key, or ticks that are not an object, is NOT valid (fail safe, grey). As a second fail-safe, every ingredient
--   in the dish's closure must have allergens_reviewed = true in the live data, whatever the stored snapshot says.
-- A sign-off that is not valid is sent with NO confirmed_at, so the iPad reads grey Not checked. Amounts never matter.
--
-- Everything else is identical to 20261010170000: the output shape, cross_contact (cost_settings.text_value, migration 20261010160000),
-- the allow-list of display fields (never a price, surcharge, cost, target, supplier, who signed off, the components list or the ticks),
-- the grants and the comment. Apply AFTER 20261010170000_kitchen_matrix_recheck.sql. Idempotent.
create or replace function public.cost_kitchen_matrix(p_venue text)
returns json
language sql
stable
security definer
set search_path = public
as $$
  with recursive
  v as (select id, slug, name from cost_venues where slug = p_venue),
  dishes as (
    select mi.id, mi.name, mi.section, mi.dish_allergens, mi.diet_options, mi.allergen_add, mi.allergen_remove
    from cost_menu_items mi
    join v on mi.venue_id = v.id
    where mi.active and mi.category = 'Food'
  ),
  -- every ingredient and prep each dish is made from: its own lines (depth 0), then the lines of each prep found (depth + 1)
  walk(dish_id, component_type, component_id, depth) as (
    select d.id, rl.component_type, rl.component_id, 0
    from dishes d
    join cost_recipe_lines rl on rl.parent_type = 'item' and rl.parent_id = d.id
    union
    select w.dish_id, rl.component_type, rl.component_id, w.depth + 1
    from walk w
    join cost_recipe_lines rl on rl.parent_type = 'prep' and rl.parent_id = w.component_id
    where w.component_type = 'prep' and w.depth < 8
  ),
  closure as (
    select dish_id, array_agg(distinct (component_type || ':' || component_id::text)) as keys
    from walk
    group by dish_id
  ),
  -- the components stored at sign-off (null when missing or not a list)
  stored as (
    select d.id as dish_id,
           case when jsonb_typeof(d.dish_allergens -> 'components') = 'array'
                then array(select distinct e from jsonb_array_elements_text(d.dish_allergens -> 'components') e)
           end as keys
    from dishes d
    where jsonb_typeof(d.dish_allergens) = 'object'
  ),
  -- the 15 main allergen ids in the fixed order (CONTAINS_IDS in lib/allergens.ts); alcohol is never part of the snapshot
  main(id, ord) as (
    select * from unnest(array['gluten','crustacea','egg','fish','milk','peanuts','sesame','soy','tree_nuts','lupin','molluscs','sulphites','chilli','onion_garlic','nitrites']) with ordinality
  ),
  -- the LIVE snapshot rows: each distinct ingredient and prep of each dish, plus the dish itself
  live_src as (
    select w.dish_id,
           w.component_type || ':' || w.component_id::text as key,
           case when w.component_type = 'ingredient'
                then jsonb_build_object(
                       'a', coalesce((select jsonb_agg(m.id order by m.ord) from main m where m.id = any(coalesce(i.allergens, '{}'::text[]))), '[]'::jsonb),
                       'r', coalesce(i.allergens_reviewed, false))
                else jsonb_build_object(
                       'add', coalesce((select jsonb_agg(m.id order by m.ord) from main m where m.id = any(coalesce(p.allergen_add, '{}'::text[]))), '[]'::jsonb),
                       'rem', coalesce((select jsonb_agg(m.id order by m.ord) from main m where m.id = any(coalesce(p.allergen_remove, '{}'::text[]))), '[]'::jsonb))
           end as sig,
           (w.component_type = 'ingredient' and not coalesce(i.allergens_reviewed, false)) as unreviewed
    from (select distinct dish_id, component_type, component_id from walk where component_id is not null) w
    left join cost_ingredients i on w.component_type = 'ingredient' and i.id = w.component_id
    left join cost_preps p on w.component_type = 'prep' and p.id = w.component_id
    union all
    select d.id, 'item:' || d.id::text,
           jsonb_build_object(
             'add', coalesce((select jsonb_agg(m.id order by m.ord) from main m where m.id = any(coalesce(d.allergen_add, '{}'::text[]))), '[]'::jsonb),
             'rem', coalesce((select jsonb_agg(m.id order by m.ord) from main m where m.id = any(coalesce(d.allergen_remove, '{}'::text[]))), '[]'::jsonb)),
           false
    from dishes d
  ),
  live as (
    select dish_id, jsonb_object_agg(key, sig) as ticks, bool_or(unreviewed) as has_unreviewed
    from live_src
    group by dish_id
  ),
  -- a sign-off counts only when it has a time, its stored components equal the dish's components now, its stored ticks equal the live
  -- snapshot, and every ingredient in the dish is reviewed now
  sign as (
    select d.id as dish_id,
           coalesce(nullif(d.dish_allergens ->> 'confirmed_at', '') is not null
                    and s.keys is not null
                    and s.keys @> coalesce(c.keys, '{}'::text[])
                    and coalesce(c.keys, '{}'::text[]) @> s.keys
                    and jsonb_typeof(d.dish_allergens -> 'ticks') = 'object'
                    and (d.dish_allergens -> 'ticks') = lv.ticks
                    and not coalesce(lv.has_unreviewed, true), false) as valid
    from dishes d
    left join stored s on s.dish_id = d.id
    left join closure c on c.dish_id = d.id
    left join live lv on lv.dish_id = d.id
  ),
  -- one row per dietary option a dish offers
  opts as (
    select d.id as dish_id, o.key as option_id, o.value as body
    from dishes d
    cross join lateral jsonb_each(case when jsonb_typeof(d.diet_options) = 'object' then d.diet_options else '{}'::jsonb end) o
    where o.key in ('gfo', 'vo', 'vgo', 'dfo') and jsonb_typeof(o.value) = 'object'
  ),
  -- the dish's own lines an option leaves out, by name
  left_out as (
    select op.dish_id, op.option_id, jsonb_agg(coalesce(i.name, p.name) order by rl.sort, rl.id) as names
    from opts op
    cross join lateral jsonb_array_elements_text(case when jsonb_typeof(op.body -> 'removed') = 'array' then op.body -> 'removed' else '[]'::jsonb end) r(line_id)
    join cost_recipe_lines rl on rl.parent_type = 'item' and rl.parent_id = op.dish_id and rl.id::text = r.line_id
    left join cost_ingredients i on rl.component_type = 'ingredient' and i.id = rl.component_id
    left join cost_preps p on rl.component_type = 'prep' and p.id = rl.component_id
    where coalesce(i.name, p.name) is not null
    group by op.dish_id, op.option_id
  ),
  -- the extra components an option adds, by name with the amount
  added as (
    select op.dish_id, op.option_id,
           jsonb_agg(
             jsonb_build_object(
               'name', coalesce(i.name, p.name),
               'qty', case when (a.elem ->> 'qty') ~ '^[0-9]+(\.[0-9]+)?$' then (a.elem ->> 'qty')::numeric else 0 end,
               'unit', a.elem ->> 'unit')
             order by a.ord) as items
    from opts op
    cross join lateral jsonb_array_elements(case when jsonb_typeof(op.body -> 'added') = 'array' then op.body -> 'added' else '[]'::jsonb end) with ordinality a(elem, ord)
    left join cost_ingredients i on (a.elem ->> 'component_type') = 'ingredient'
      and i.id = case when (a.elem ->> 'component_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (a.elem ->> 'component_id')::uuid end
    left join cost_preps p on (a.elem ->> 'component_type') = 'prep'
      and p.id = case when (a.elem ->> 'component_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (a.elem ->> 'component_id')::uuid end
    where coalesce(i.name, p.name) is not null
    group by op.dish_id, op.option_id
  )
  select json_build_object(
    'venue', (select json_build_object('slug', slug, 'name', name) from v),
    'cross_contact', (select nullif(btrim(text_value), '') from cost_settings where key = 'cross_contact_' || p_venue),
    'dishes', coalesce((
      select json_agg(
        json_build_object(
          'id', d.id,
          'name', d.name,
          'section', d.section,
          'dish_allergens', case when jsonb_typeof(d.dish_allergens) = 'object'
            then jsonb_build_object(
              'contains', d.dish_allergens -> 'contains',
              'without', d.dish_allergens -> 'without',
              -- the sign-off time only while it is still valid; otherwise absent, so the iPad reads Not checked
              'confirmed_at', case when sg.valid then d.dish_allergens -> 'confirmed_at' end)
            end,
          'marks', coalesce((
            select jsonb_agg(m.key order by m.key)
            from jsonb_each(case when jsonb_typeof(d.diet_options) = 'object' then d.diet_options else '{}'::jsonb end) m
            where m.key in ('gf', 'v', 'vg') and jsonb_typeof(m.value) = 'object'), '[]'::jsonb),
          'options', coalesce((
            select jsonb_object_agg(op.option_id, jsonb_build_object(
              'note', coalesce(op.body ->> 'note', ''),
              'left_out', coalesce(lo.names, '[]'::jsonb),
              'added', coalesce(ad.items, '[]'::jsonb)))
            from opts op
            left join left_out lo on lo.dish_id = op.dish_id and lo.option_id = op.option_id
            left join added ad on ad.dish_id = op.dish_id and ad.option_id = op.option_id
            where op.dish_id = d.id), '{}'::jsonb)
        )
        order by d.section nulls last, d.name)
      from dishes d
      left join sign sg on sg.dish_id = d.id), '[]'::json)
  )
  where exists (select 1 from v);
$$;

revoke all on function public.cost_kitchen_matrix(text) from public;
grant execute on function public.cost_kitchen_matrix(text) to anon, authenticated;

comment on function public.cost_kitchen_matrix(text) is 'Kitchen display (public iPad Allergy Matrix): one venue''s active Food dishes with their own allergens (contains, can-be-made-without notes, sign-off time ONLY while the sign-off is still valid: the dish''s components, through nested preps, and the allergen ticks on its ingredients, preps and the dish itself must equal those stored at sign-off, with every ingredient reviewed), hand-set marks and dietary options with the swap resolved to names, and the venue''s cross-contact line. Display fields only: never a price, surcharge, cost, who signed off, the components list or the ticks. Null when the venue slug does not exist.';
