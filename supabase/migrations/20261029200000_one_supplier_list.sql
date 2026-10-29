-- One supplier list (Troy, 29 Oct 2026: "the ordering suppliers should link to the suppliers in the ingredients").
-- cost_suppliers is THE supplier list. ordering_suppliers keeps one row per (venue, supplier) for the per-venue terms (rep, email,
-- account, minimum, how it is sent) and now points at it. An ordering product linked to an ingredient takes its supplier from the
-- ingredient (change it on the ingredient and every venue's order list follows). invoice_suppliers link to it too.

alter table cost_suppliers add column if not exists active boolean not null default true;
alter table ordering_suppliers add column if not exists cost_supplier_id integer references cost_suppliers(id);
create index if not exists ordering_suppliers_cost_supplier_idx on ordering_suppliers (cost_supplier_id);

-- "Glass House" and "Glasshouse" are one name: compare with everything but letters and digits taken out
create or replace function cost_supplier_key(t text) returns text language sql immutable as $$
  select regexp_replace(lower(coalesce(t, '')), '[^a-z0-9]+', '', 'g')
$$;

-- The supplier a name means: the same name, else the supplier whose name the given name starts with ("Bidfood Sunshine Coast" is
-- Bidfood), else a new supplier. Never guesses across different companies: only whole-name matches and name prefixes.
create or replace function cost_supplier_resolve(p_name text) returns integer language plpgsql as $$
declare r integer; k text := cost_supplier_key(p_name);
begin
  if k = '' then return null; end if;
  select id into r from cost_suppliers where cost_supplier_key(name) = k order by id limit 1;
  if found then return r; end if;
  select id into r from cost_suppliers
    where length(cost_supplier_key(name)) >= 4 and cost_supplier_key(name) not in ('various', 'house') and k like cost_supplier_key(name) || '%'
    order by length(name) desc, id limit 1;
  if found then return r; end if;
  insert into cost_suppliers (name) values (btrim(p_name)) returning id into r;
  return r;
end $$;

-- The (venue, supplier) terms row, made when it is not there yet and filled from the same supplier's row at another venue
-- (method, address, rep, minimums; never the account number, which is per venue).
create or replace function ordering_terms_row(p_venue integer, p_supplier integer) returns uuid language plpgsql as $$
declare r uuid;
begin
  select id into r from ordering_suppliers where venue_id = p_venue and cost_supplier_id = p_supplier;
  if found then return r; end if;
  insert into ordering_suppliers (venue_id, name, cost_supplier_id, method, email_to, login_url, rep_name, rep_phone, min_order_value, min_order_units, show_prices_on_order, notes, active, sort)
  select p_venue, cs.name, cs.id, coalesce(o.method, 'email'), o.email_to, o.login_url, o.rep_name, o.rep_phone, o.min_order_value, o.min_order_units, false, o.notes, true,
         coalesce((select max(sort) + 1 from ordering_suppliers where venue_id = p_venue), 0)
  from cost_suppliers cs
  left join lateral (select * from ordering_suppliers x where x.cost_supplier_id = cs.id and x.venue_id <> p_venue order by x.created_at limit 1) o on true
  where cs.id = p_supplier
  returning id into r;
  return r;
end $$;

-- a terms row always points at a supplier, and always carries that supplier's name
create or replace function ordering_suppliers_link() returns trigger language plpgsql as $$
begin
  if new.cost_supplier_id is null then new.cost_supplier_id := cost_supplier_resolve(new.name); end if;
  select name into new.name from cost_suppliers where id = new.cost_supplier_id;
  return new;
end $$;
drop trigger if exists ordering_suppliers_link_trg on ordering_suppliers;
create trigger ordering_suppliers_link_trg before insert or update of name, cost_supplier_id on ordering_suppliers for each row execute function ordering_suppliers_link();

-- renaming a supplier renames it everywhere
create or replace function cost_suppliers_rename() returns trigger language plpgsql as $$
begin
  update ordering_suppliers set name = new.name where cost_supplier_id = new.id and name <> new.name;
  return new;
end $$;
drop trigger if exists cost_suppliers_rename_trg on cost_suppliers;
create trigger cost_suppliers_rename_trg after update of name on cost_suppliers for each row when (old.name is distinct from new.name) execute function cost_suppliers_rename();

-- an ordering product linked to an ingredient takes its supplier from the ingredient (null when the ingredient has none)
create or replace function ordering_products_follow_ingredient() returns trigger language plpgsql as $$
declare s integer;
begin
  if new.ingredient_id is not null then
    select supplier_id into s from cost_ingredients where id = new.ingredient_id;
    new.supplier_id := case when s is null then null else ordering_terms_row(new.venue_id, s) end;
  end if;
  return new;
end $$;
drop trigger if exists ordering_products_follow_ingredient_trg on ordering_products;
create trigger ordering_products_follow_ingredient_trg before insert or update of ingredient_id, supplier_id on ordering_products for each row execute function ordering_products_follow_ingredient();

-- changing an ingredient's supplier moves every venue's ordering product for it
create or replace function cost_ingredients_supplier_moved() returns trigger language plpgsql as $$
begin
  update ordering_products set ingredient_id = ingredient_id where ingredient_id = new.id;
  return new;
end $$;
drop trigger if exists cost_ingredients_supplier_moved_trg on cost_ingredients;
create trigger cost_ingredients_supplier_moved_trg after update of supplier_id on cost_ingredients for each row when (old.supplier_id is distinct from new.supplier_id) execute function cost_ingredients_supplier_moved();

-- an invoice supplier (made silently when an invoice names a new one) is linked to, or creates, the supplier it is
create or replace function invoice_suppliers_link() returns trigger language plpgsql as $$
begin
  if new.cost_supplier_id is null then new.cost_supplier_id := cost_supplier_resolve(new.name); end if;
  return new;
end $$;
drop trigger if exists invoice_suppliers_link_trg on invoice_suppliers;
create trigger invoice_suppliers_link_trg before insert on invoice_suppliers for each row execute function invoice_suppliers_link();

-- once every row is linked (the live data was linked by hand first): required, and one terms row per (venue, supplier)
do $$ begin
  if not exists (select 1 from ordering_suppliers where cost_supplier_id is null) then
    alter table ordering_suppliers alter column cost_supplier_id set not null;
    create unique index if not exists ordering_suppliers_venue_supplier_key on ordering_suppliers (venue_id, cost_supplier_id);
  end if;
  create unique index if not exists invoice_suppliers_cost_supplier_key on invoice_suppliers (cost_supplier_id) where active and cost_supplier_id is not null;
end $$;
