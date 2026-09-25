-- Allergens: tick on ingredients; preps and dishes inherit through recipe lines (see lib/allergens.ts).
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
