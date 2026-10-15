-- Ordering: an optional "other supplier" price on a product, so the order screen can say when a dual-sourced item is 10% or more
-- cheaper elsewhere (owners' rule, 15 Oct 2026: order from Star unless another supplier is 10% cheaper). Advisory only: nothing here
-- changes who a product is ordered from. The price is for the SAME unit and size as the product's own price, inc GST.
alter table public.ordering_products
  add column if not exists alt_supplier_name text,
  add column if not exists alt_item_code text,
  add column if not exists alt_price_inc_gst numeric(10,2),
  add column if not exists alt_price_on date;
alter table public.ordering_products drop constraint if exists ordering_products_alt_price_chk;
alter table public.ordering_products add constraint ordering_products_alt_price_chk check (alt_price_inc_gst is null or alt_price_inc_gst > 0);
