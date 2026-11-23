-- One card per product (Troy, 23 Nov 2026): how many of an ingredient's packs one CARTON holds is a fact about the product and its
-- supplier, not about a venue, so it lives on the ingredient. It used to be typed per venue on the order item
-- (ordering_products.costing_packs_per_unit). Null = nobody has said. 1 = the ingredient's own pack is the carton (a 24 pack of cans).
alter table public.cost_ingredients add column if not exists carton_qty numeric;
alter table public.cost_ingredients drop constraint if exists cost_ingredients_carton_qty_check;
alter table public.cost_ingredients add constraint cost_ingredients_carton_qty_check check (carton_qty is null or carton_qty > 0);
comment on column public.cost_ingredients.carton_qty is 'How many of this ingredient''s packs one carton holds (6 bottles a carton). Null = not recorded. 1 = the pack itself is the carton.';
