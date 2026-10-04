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
