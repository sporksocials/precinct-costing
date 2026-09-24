-- Reference schema for Precinct Costing.
-- The production database already has these tables and the price-log trigger;
-- this file documents the shape the app is built against and the RLS pattern.
-- Apply selectively — do not blindly re-run against a live project.

create table if not exists public.cost_allowed_users (
  email text primary key
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
  category text,
  supplier_id int references public.cost_suppliers (id),
  supplier_code text,
  pack_size numeric not null default 1,
  pack_unit text not null default 'kg' check (pack_unit in ('kg', 'L', 'each')),
  pack_price numeric not null default 0,
  price_inc_gst boolean not null default false,
  gst_free boolean not null default false,
  rebate numeric not null default 0,
  yield_pct numeric not null default 1,
  venues text,
  active boolean not null default true,
  last_price_update date,
  previous_price numeric,
  source text,
  notes text,
  updated_at timestamptz not null default now()
);

create table if not exists public.cost_preps (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
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
  notes text
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
    new.last_price_update := current_date;
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
