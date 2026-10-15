-- Ordering: "buy X, get Y free" on a product (Star Super Crisp keg: buy 8, the 9th is free, ordered 9 at a time).
-- The product carries the deal; every order line snapshots it, so a saved order always shows what was paid for.
-- Both columns are set together or not at all, and are whole numbers above zero.
alter table public.ordering_products
  add column if not exists deal_buy_qty integer,
  add column if not exists deal_free_qty integer;
alter table public.ordering_products drop constraint if exists ordering_products_deal_chk;
alter table public.ordering_products add constraint ordering_products_deal_chk
  check ((deal_buy_qty is null and deal_free_qty is null) or (deal_buy_qty > 0 and deal_free_qty > 0));

alter table public.ordering_order_lines
  add column if not exists deal_buy_qty integer,
  add column if not exists deal_free_qty integer;
alter table public.ordering_order_lines drop constraint if exists ordering_order_lines_deal_chk;
alter table public.ordering_order_lines add constraint ordering_order_lines_deal_chk
  check ((deal_buy_qty is null and deal_free_qty is null) or (deal_buy_qty > 0 and deal_free_qty > 0));
