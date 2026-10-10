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
