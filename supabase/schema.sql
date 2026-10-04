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
  ('glass', 'Mason Jar', 9), ('glass', 'Carafe', 10), ('glass', 'Jug', 11), ('glass', 'Fishbowl', 12),
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
-- A key present means the dish offers that option; the note says what changes. (Whether a dish IS gluten free,
-- dairy free, vegetarian or vegan is worked out from its ingredients, never typed.)
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

comment on column public.cost_menu_items.diet_options is 'Per-dish dietary option flags (gfo, vo, vgo, dfo) each with a required note on the swap. Never used to claim a dish IS gluten free; that is derived from ingredients.';
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
