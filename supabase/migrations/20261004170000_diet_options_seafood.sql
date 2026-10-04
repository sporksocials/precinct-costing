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
