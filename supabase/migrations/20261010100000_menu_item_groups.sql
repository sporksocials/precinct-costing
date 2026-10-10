-- Menu groups (Troy, 10 Oct 2026): a display grouping for items that are variations of one thing, such as the Kids Milkshakes
-- (Vanilla, Chocolate, Caramel, Strawberry) or the Spiders. cost_menu_items.menu_group is plain text, e.g. 'Kids Milkshakes'.
--   null / empty  the item stands on its own (every item that exists today)
--   a name        items at the same venue with the same name (ignoring capitals and spaces) are shown together as one card on the
--                 Drinks Station, which opens to the flavours
-- It is DISPLAY ONLY: every item keeps its own recipe, price, cost, GP, photo, alerts and history. Nothing in costing reads it.
-- Nullable with no default, so existing rows and the app work before and after this is applied. Idempotent.
alter table public.cost_menu_items add column if not exists menu_group text;

comment on column public.cost_menu_items.menu_group is 'Display grouping only: items at the same venue sharing this name show as one card on the Drinks Station that opens to the flavours. Null = stands alone. Not used by costing, alerts or GP.';
