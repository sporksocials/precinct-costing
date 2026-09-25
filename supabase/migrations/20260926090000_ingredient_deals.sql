-- Supplier deals on ingredients: buy X get Y free, volume discounts, temporary special prices, standing percent off.
-- A deal changes what a unit COSTS (see lib/deals.ts); it never rewrites cost_ingredients.pack_price, so the
-- price-log trigger on cost_ingredients is not involved and price history stays clean.
-- Idempotent.
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
