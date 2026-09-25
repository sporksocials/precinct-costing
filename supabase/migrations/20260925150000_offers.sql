-- Specials & combos: offers built from existing menu items and tap beer serves, saved apart from the master menu.
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
