-- Bar display (iPad cocktail station): glass, ordered method steps, ordered garnish list.
-- Nullable: only cocktail/mocktail items populate these; everything else stays null.
alter table public.cost_menu_items
  add column if not exists glass text,
  add column if not exists method jsonb,
  add column if not exists garnish jsonb;

comment on column public.cost_menu_items.glass is 'Bar display: which glass to serve in, e.g. "Rocks Glass, Salt Rim". Null for non-bar items.';
comment on column public.cost_menu_items.method is 'Bar display: ordered array of short method steps, e.g. ["Shake hard for 12 seconds","Strain into the glass"]. Null for non-bar items.';
comment on column public.cost_menu_items.garnish is 'Bar display: ordered array of garnish items, e.g. ["Dehydrated lime wheel"]. Null for non-bar items.';
