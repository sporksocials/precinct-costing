-- Thin order items: ONE CARD PER PRODUCT (Troy, 23 Nov 2026).
--
-- The same real product used to be stored twice: a costing ingredient (cost_ingredients) and a per-venue order item
-- (ordering_products) with its OWN name, supplier item code, price, bottles per carton and free-unit deal, and the two drifted
-- apart. From now on an order item is a thin per-venue shell: its shelf group (category_id, sort), Counted By (unit_name),
-- Build To (par), pack_multiple, notes and whether it is on the venue's order list (active). Everything about the PRODUCT is
-- the ingredient's:
--   supplier_id          already copied by trigger since 20261029200000_one_supplier_list.sql
--   name                 NOW copied by the same trigger: the ingredient's FULL name, size in brackets included
--   supplier_item_code   NOW copied by the same trigger: cost_ingredients.supplier_code
--   price, carton size, free-unit deal   worked out when read, in the app (lib/ordering-facts.ts); never stored here again
-- The copies exist so the count screen, its offline copy, the count snapshots and the history pages keep reading plain
-- product rows. No column is dropped: price_inc_gst, costing_packs_per_unit, deal_buy_qty, deal_free_qty and the alt_* columns
-- stay exactly as they are, and no screen shows or writes them any more.
--
-- RULES THE TRIGGERS KEEP
--   * An ACTIVE order item that has an ingredient always carries that ingredient's name, supplier code and supplier.
--   * An INACTIVE order item never blocks an active one: when an active item needs a name an inactive item in the same venue
--     category holds, the inactive one steps aside as "<name> (old)" ("(old 2)" and so on if that is taken too). An inactive
--     item that has an ingredient follows the ingredient's name when the name is free, and keeps its "(old)" name when not.
--   * Switching an item back on gives it the ingredient's name again.
--   * At most ONE active order item per ingredient per venue (the unique index at the end).
--   * An order item with NO ingredient is left alone in every way (there are a handful, kept working until they are given one).
--
-- THE BACKFILL (in this order)
--   1. Stops with a clear error, naming the rows, if an ingredient has two ACTIVE order items at one venue, or if two ACTIVE
--      order items would end up with the same name in one venue category. Neither is expected in the live data.
--   2. Supplier codes are copied UP to the ingredient where the ingredient has none. The ACTIVE order items of the ingredient
--      decide: when every active item that has a code has the same code (capitals and spaces ignored) the ingredient takes it;
--      when no active item has a code, the inactive items decide the same way. When they DISAGREE the ingredient's code is left
--      empty and, because the item code is then copied down from the ingredient, the order items' codes are cleared: each such
--      ingredient is named in a NOTICE so the right code can be typed once, on the ingredient.
--      An ingredient that ALREADY has a code keeps it; an order item code that differs is replaced by it (also in a NOTICE).
--   3. Every order item that has an ingredient takes the ingredient's name, code and supplier. An inactive item whose name is
--      then taken becomes "<name> (old)".
--
-- Safe with the change history and edit stamp triggers already on both tables (they are AFTER / BEFORE row triggers that only
-- read the row; an update that changes nothing writes no history). Idempotent: running the file twice changes nothing the
-- second time. Tested on a real Postgres (PGlite): tests/thin-order-items-sql.test.ts.

-- ------------------------------------------------------------------ 1. the checks before anything is changed

do $$
declare bad text;
begin
  select string_agg(format('%s at venue %s (%s)', i.name, d.venue_id, d.names), '; ' order by i.name, d.venue_id) into bad
  from (
    select venue_id, ingredient_id, string_agg(name, ', ' order by name) as names
    from ordering_products
    where active and ingredient_id is not null
    group by venue_id, ingredient_id
    having count(*) > 1
  ) d
  join cost_ingredients i on i.id = d.ingredient_id;
  if bad is not null then
    raise exception 'thin_order_items: an ingredient has more than one ACTIVE order item at one venue. Make all but one inactive, then run this again. %', bad;
  end if;

  select string_agg(format('"%s" at venue %s', t.target, t.venue_id), '; ' order by t.target, t.venue_id) into bad
  from (
    select p.venue_id, p.category_id, coalesce(i.name, p.name) as target
    from ordering_products p
    left join cost_ingredients i on i.id = p.ingredient_id
    where p.active
    group by p.venue_id, p.category_id, coalesce(i.name, p.name)
    having count(*) > 1
  ) t;
  if bad is not null then
    raise exception 'thin_order_items: two ACTIVE order items would have the same name in one category. Make one inactive or give it its own ingredient, then run this again. %', bad;
  end if;
end $$;

-- An ACTIVE item whose present name is the name ANOTHER active item in its category is about to take gets a placeholder first,
-- so the copy below can never trip over a name that is only in the way for a moment. It is given its real name in step 3.
-- (Runs before the new trigger exists; on a second run no row qualifies.)
update ordering_products p
set name = '~' || p.id::text
from cost_ingredients i
where i.id = p.ingredient_id
  and p.active
  and p.name <> i.name
  and exists (
    select 1
    from ordering_products o
    join cost_ingredients oi on oi.id = o.ingredient_id
    where o.active and o.id <> p.id and o.venue_id = p.venue_id and o.category_id = p.category_id and oi.name = p.name
  );

-- ------------------------------------------------------------------ 2. supplier codes copied up to the ingredient

do $$
declare
  r record;
begin
  for r in
    select i.id, i.name, nullif(btrim(i.supplier_code), '') as own,
           count(*) filter (where p.active) as active_n,
           count(distinct lower(btrim(p.supplier_item_code))) filter (where p.active) as active_codes,
           min(btrim(p.supplier_item_code)) filter (where p.active) as active_code,
           count(distinct lower(btrim(p.supplier_item_code))) as all_codes,
           min(btrim(p.supplier_item_code)) as any_code,
           string_agg(distinct btrim(p.supplier_item_code), ', ') as codes
    from ordering_products p
    join cost_ingredients i on i.id = p.ingredient_id
    where nullif(btrim(p.supplier_item_code), '') is not null
    group by i.id, i.name, i.supplier_code
  loop
    if r.own is not null then
      if r.all_codes > 1 or lower(r.any_code) <> lower(r.own) then
        raise notice 'thin_order_items: "%" keeps its supplier code %; its order items had % and now carry the ingredient''s code', r.name, r.own, r.codes;
      end if;
    elsif r.active_n > 0 and r.active_codes = 1 then
      update cost_ingredients set supplier_code = r.active_code where id = r.id;
    elsif r.active_n = 0 and r.all_codes = 1 then
      update cost_ingredients set supplier_code = r.any_code where id = r.id;
    else
      raise notice 'thin_order_items: "%" has no supplier code and its order items disagree (%): the code is left EMPTY, type the right one on the ingredient', r.name, r.codes;
    end if;
  end loop;
end $$;

-- ------------------------------------------------------------------ 3. the triggers

-- "<name> (old)", or "(old 2)", "(old 3)" when that is taken in the venue category: the name an inactive item steps aside to
create or replace function ordering_products_old_name(p_venue integer, p_category uuid, p_name text, p_self uuid) returns text
language plpgsql set search_path = public as $$
declare
  base text := regexp_replace(p_name, ' \(old( \d+)?\)$', '');
  n integer := 1;
  candidate text := base || ' (old)';
begin
  while exists (select 1 from ordering_products where venue_id = p_venue and category_id = p_category and name = candidate and id <> p_self) loop
    n := n + 1;
    candidate := base || ' (old ' || n || ')';
  end loop;
  return candidate;
end $$;

-- an order item that has an ingredient takes its supplier from the ingredient (as before) and, while it is ACTIVE, its name and
-- supplier item code too. An inactive item holding the name in the same venue category steps aside first.
create or replace function ordering_products_follow_ingredient() returns trigger
language plpgsql set search_path = public as $$
declare
  i record;
begin
  if new.ingredient_id is null then
    return new;
  end if;
  select supplier_id, name, supplier_code into i from cost_ingredients where id = new.ingredient_id;
  if not found then
    new.supplier_id := null;
    return new;
  end if;
  new.supplier_id := case when i.supplier_id is null then null else ordering_terms_row(new.venue_id, i.supplier_id) end;
  if new.active then
    new.name := i.name;
    new.supplier_item_code := nullif(btrim(i.supplier_code), '');
    update ordering_products o
    set name = ordering_products_old_name(o.venue_id, o.category_id, o.name, o.id)
    where o.venue_id = new.venue_id and o.category_id = new.category_id and o.name = new.name and o.id is distinct from new.id and not o.active;
  end if;
  return new;
end $$;
drop trigger if exists ordering_products_follow_ingredient_trg on ordering_products;
create trigger ordering_products_follow_ingredient_trg
  before insert or update of ingredient_id, supplier_id, name, supplier_item_code, active, category_id on ordering_products
  for each row execute function ordering_products_follow_ingredient();

-- Brings every order item of one ingredient into step with it, at every venue. Active items first (the trigger above does the
-- work and moves an inactive holder of the name aside), then the inactive ones one at a time: each takes the ingredient's name
-- when it is free in its category and keeps (or takes) an "(old)" name when it is not.
create or replace function ordering_products_sync_ingredient(p_ingredient uuid) returns void
language plpgsql set search_path = public as $$
declare
  i record;
  r record;
  code text;
  want text;
begin
  select name, supplier_code into i from cost_ingredients where id = p_ingredient;
  if not found then
    return;
  end if;
  code := nullif(btrim(i.supplier_code), '');
  update ordering_products set ingredient_id = ingredient_id where ingredient_id = p_ingredient and active;
  for r in
    select id, venue_id, category_id, name from ordering_products where ingredient_id = p_ingredient and not active order by created_at, id
  loop
    if not exists (select 1 from ordering_products o where o.venue_id = r.venue_id and o.category_id = r.category_id and o.name = i.name and o.id <> r.id) then
      want := i.name;
    elsif left(r.name, length(i.name) + 5) = i.name || ' (old' and right(r.name, 1) = ')' then
      want := r.name;
    else
      want := ordering_products_old_name(r.venue_id, r.category_id, i.name, r.id);
    end if;
    update ordering_products set name = want, supplier_item_code = code, ingredient_id = ingredient_id where id = r.id;
  end loop;
end $$;

-- changing an ingredient's supplier, NAME or SUPPLIER CODE flows to every venue's order item for it
create or replace function cost_ingredients_supplier_moved() returns trigger
language plpgsql set search_path = public as $$
begin
  perform ordering_products_sync_ingredient(new.id);
  return new;
end $$;
drop trigger if exists cost_ingredients_supplier_moved_trg on cost_ingredients;
create trigger cost_ingredients_supplier_moved_trg
  after update of supplier_id, name, supplier_code on cost_ingredients
  for each row
  when (old.supplier_id is distinct from new.supplier_id or old.name is distinct from new.name or old.supplier_code is distinct from new.supplier_code)
  execute function cost_ingredients_supplier_moved();

-- ------------------------------------------------------------------ 4. every order item that has an ingredient takes its name, code and supplier

do $$
declare
  r record;
begin
  for r in select distinct ingredient_id from ordering_products where ingredient_id is not null loop
    perform ordering_products_sync_ingredient(r.ingredient_id);
  end loop;
end $$;

-- ------------------------------------------------------------------ 5. one active order item per ingredient per venue

create unique index if not exists ordering_products_one_active_per_ingredient
  on ordering_products (venue_id, ingredient_id)
  where active and ingredient_id is not null;

comment on column ordering_products.name is 'A copy of the ingredient''s full name, kept by trigger ordering_products_follow_ingredient while the item is active. An item with no ingredient keeps the name it had.';
comment on column ordering_products.supplier_item_code is 'A copy of cost_ingredients.supplier_code, kept by trigger. Type the code on the ingredient.';
comment on column ordering_products.price_inc_gst is 'No longer shown or written by the app (23 Nov 2026): the order price is worked out from the ingredient. Read only as the fallback for an item with no ingredient.';
