-- Ordering: weekly drinks stock counts and supplier orders, replacing the per-venue order workbooks (design:
-- files/research/stock-and-ordering-architecture-2026-10-05.md). Foundation only: tables, constraints, RLS, edit stamps and
-- change history. No UI yet, no data, no backfill.
--
--  * EVERYTHING is separate per venue: every table has venue_id (references cost_venues) and every parent/child link is a
--    composite foreign key (id, venue_id), so a product can never point at another venue's supplier or category, a count line
--    never at another venue's session, and so on. Nothing is shared between venues (a new venue may copy a list as a start).
--  * Tables: ordering_suppliers, ordering_categories, ordering_products, ordering_count_sessions, ordering_count_lines,
--    ordering_orders, ordering_order_lines, ordering_price_uploads, ordering_price_log.
--  * Count lines: no row means not counted; a row with a null quantity means not counted in that place; 0 is a deliberate
--    zero. client_uuid (unique) makes an offline retry idempotent. product_name, par_at_count and unit_name are snapshots so
--    old counts still read correctly after a product is renamed or its Build To changes.
--  * One in-progress count per venue (partial unique index): "Start Count" resumes it instead of starting a second.
--  * Order lines keep name, unit, item code and price as they were when the order was made ("orders already sent never change").
--  * RLS: everyone who can sign in sees and edits everything (cost_allowed_all via cost_is_allowed()), as every cost_* table.
--  * Edit stamps: updated_at and updated_by (the signed-in email) are kept by the existing cost_stamp_edit() trigger function,
--    on insert and update, for every editable table.
--  * Change history (cost_change_history): the generic cost_history_log() trigger is attached to suppliers, categories,
--    products (so a Build To change is logged with who, when and the old value), count sessions, count lines, orders and
--    price uploads. NOT tracked: ordering_order_lines (a snapshot saved together with its order, whose exact text is kept in
--    ordering_orders.body_text) and ordering_price_log (itself a history table).
--    Count lines are logged ONLY once their session is finalised: while a count is in progress every tap is saved but nothing
--    is recorded (hundreds of rows of noise), and once it is finalised every later insert, edit or delete is logged with the old
--    values (Troy: "anyone can edit a count at any time, the history shows who and the old value"). To do that this file
--    REPLACES public.cost_history_log() with the same function plus ONE additive branch, switched on by a fourth trigger
--    argument ('when_session_finalised'). Every existing trigger passes no fourth argument, so tg_argv[3] is null and their
--    behaviour is unchanged. To roll back, re-run the function from 20261004240000_change_history.sql.
-- Safe to apply to the live database: creates new tables only (plus the one function replace above). Idempotent (create ...
-- if not exists, drop trigger/policy if exists, create or replace). No data is touched.

-- ---------------------------------------------------------------- suppliers
create table if not exists public.ordering_suppliers (
  id uuid primary key default gen_random_uuid(),
  venue_id integer not null references public.cost_venues (id),
  name text not null check (btrim(name) <> ''),
  -- how the order goes out: email (a draft is opened), website (a login page, list is copied) or app (e.g. Ordermentum)
  method text not null default 'email' check (method in ('email', 'website', 'app')),
  email_to text,            -- one or more addresses (comma or semicolon separated) for the email draft
  login_url text,           -- website suppliers: where to log in and paste the list
  rep_name text,
  rep_phone text,
  account_no text,
  min_order_value numeric check (min_order_value is null or min_order_value >= 0),   -- dollars inc GST; a warning only
  min_order_units numeric check (min_order_units is null or min_order_units >= 0),   -- cartons, kegs or bottles; a warning only
  show_prices_on_order boolean not null default false,   -- Star and anyone who requires prices on the order
  notes text,
  active boolean not null default true,
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text,
  constraint ordering_suppliers_venue_name_key unique (venue_id, name),
  constraint ordering_suppliers_id_venue_key unique (id, venue_id)
);

-- ---------------------------------------------------------------- categories
create table if not exists public.ordering_categories (
  id uuid primary key default gen_random_uuid(),
  venue_id integer not null references public.cost_venues (id),
  name text not null check (btrim(name) <> ''),
  sort integer not null default 0,   -- the shelf order the count screen follows
  second_location_label text,        -- 'Bar' or 'Coldroom'; null means Store only
  unit_name text not null default 'carton',   -- the default unit for the category (carton, keg, bag, bottle)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text,
  constraint ordering_categories_venue_name_key unique (venue_id, name),
  constraint ordering_categories_id_venue_key unique (id, venue_id)
);

-- ---------------------------------------------------------------- products
create table if not exists public.ordering_products (
  id uuid primary key default gen_random_uuid(),
  venue_id integer not null references public.cost_venues (id),
  category_id uuid not null,
  sort integer not null default 0,
  name text not null check (btrim(name) <> ''),
  unit_name text not null,           -- what one counted and ordered unit is: carton, keg, bag, bottle
  supplier_id uuid,                  -- null: shown under "Unassigned" until someone picks a supplier
  supplier_item_code text,           -- e.g. Star's item number
  pack_multiple integer not null default 1 check (pack_multiple >= 1),   -- orders round UP to a multiple of this (Star spirits: 6 or 12)
  price_inc_gst numeric check (price_inc_gst is null or price_inc_gst >= 0),   -- price of one order unit
  ingredient_id uuid references public.cost_ingredients (id) on delete set null,   -- optional link to the costing ingredient
  costing_packs_per_unit numeric check (costing_packs_per_unit is null or costing_packs_per_unit > 0),   -- costing packs in one order unit (24 cans per carton)
  par numeric not null default 0 check (par >= 0),   -- "Build To", in the product's unit
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text,
  -- names repeat across categories at a venue (Coke as post-mix and as cans), so uniqueness is per category
  constraint ordering_products_venue_category_name_key unique (venue_id, category_id, name),
  constraint ordering_products_id_venue_key unique (id, venue_id),
  constraint ordering_products_category_fk foreign key (category_id, venue_id) references public.ordering_categories (id, venue_id),
  constraint ordering_products_supplier_fk foreign key (supplier_id, venue_id) references public.ordering_suppliers (id, venue_id)
);

-- ---------------------------------------------------------------- count sessions and lines
create table if not exists public.ordering_count_sessions (
  id uuid primary key default gen_random_uuid(),
  venue_id integer not null references public.cost_venues (id),
  started_by text,
  started_at timestamptz not null default now(),
  status text not null default 'in_progress' check (status in ('in_progress', 'finalised')),
  finalised_by text,
  finalised_at timestamptz,
  note text,
  source text,   -- null for a count taken in the app; 'sheet-import' for a count brought in from the old workbook
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text,
  constraint ordering_count_sessions_id_venue_key unique (id, venue_id)
);
-- one count in progress per venue: Start Count resumes it
create unique index if not exists ordering_count_sessions_one_open_idx on public.ordering_count_sessions (venue_id) where status = 'in_progress';

create table if not exists public.ordering_count_lines (
  id uuid primary key default gen_random_uuid(),
  venue_id integer not null references public.cost_venues (id),
  session_id uuid not null,
  product_id uuid not null,
  store_qty numeric check (store_qty is null or store_qty >= 0),    -- null: not counted in the store
  second_qty numeric check (second_qty is null or second_qty >= 0), -- null: not counted in the second place (Bar or Coldroom)
  counted_by text,
  counted_at timestamptz,            -- the device's clock when the person tapped; last write wins on sync
  client_uuid uuid,                  -- set by the device so a retried offline edit never saves twice
  product_name text,                 -- snapshots, so the count still reads right after a rename or a new Build To
  par_at_count numeric,
  unit_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text,
  constraint ordering_count_lines_session_product_key unique (session_id, product_id),
  constraint ordering_count_lines_client_uuid_key unique (client_uuid),
  constraint ordering_count_lines_session_fk foreign key (session_id, venue_id) references public.ordering_count_sessions (id, venue_id) on delete cascade,
  constraint ordering_count_lines_product_fk foreign key (product_id, venue_id) references public.ordering_products (id, venue_id)
);

-- ---------------------------------------------------------------- orders
create table if not exists public.ordering_orders (
  id uuid primary key default gen_random_uuid(),
  venue_id integer not null references public.cost_venues (id),
  supplier_id uuid not null,
  session_id uuid references public.ordering_count_sessions (id) on delete set null,   -- null for a top-up order
  status text not null default 'draft' check (status in ('draft', 'sent')),
  kind text not null default 'count' check (kind in ('count', 'top_up')),
  sent_by text,
  sent_at timestamptz,
  method text check (method is null or method in ('email', 'outlook', 'copy', 'website', 'other')),   -- how it was sent
  subject text,
  body_text text,                    -- the exact text that was sent or copied
  warning_text text,                 -- e.g. the minimum order warning shown at the time
  show_prices boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text,
  constraint ordering_orders_id_venue_key unique (id, venue_id),
  constraint ordering_orders_supplier_fk foreign key (supplier_id, venue_id) references public.ordering_suppliers (id, venue_id)
);

create table if not exists public.ordering_order_lines (
  id uuid primary key default gen_random_uuid(),
  venue_id integer not null references public.cost_venues (id),
  order_id uuid not null,
  product_id uuid references public.ordering_products (id) on delete set null,
  product_name text not null,        -- snapshots as at the order
  supplier_item_code text,
  unit_name text,
  suggested_qty numeric,
  ordered_qty numeric not null check (ordered_qty >= 0),
  pack_multiple integer,
  price_inc_gst numeric,
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text,
  constraint ordering_order_lines_order_fk foreign key (order_id, venue_id) references public.ordering_orders (id, venue_id) on delete cascade
);

-- ---------------------------------------------------------------- price uploads and log (tables only for now)
create table if not exists public.ordering_price_uploads (
  id uuid primary key default gen_random_uuid(),
  venue_id integer not null references public.cost_venues (id),   -- one row per venue the upload was applied to
  supplier_id uuid references public.ordering_suppliers (id) on delete set null,
  file_name text not null,
  uploaded_by text,
  uploaded_at timestamptz not null default now(),
  rows_matched integer not null default 0,
  rows_changed integer not null default 0,
  rows_unmatched integer not null default 0,
  updated_costing boolean not null default false,   -- the linked costing ingredients were updated too
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text
);

create table if not exists public.ordering_price_log (
  id uuid primary key default gen_random_uuid(),
  venue_id integer not null references public.cost_venues (id),
  product_id uuid not null references public.ordering_products (id) on delete cascade,
  old_price numeric,
  new_price numeric,
  upload_id uuid references public.ordering_price_uploads (id) on delete set null,
  changed_by text,
  changed_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- indexes (venue first, then every foreign key)
create index if not exists ordering_suppliers_venue_idx on public.ordering_suppliers (venue_id, sort, name);
create index if not exists ordering_categories_venue_idx on public.ordering_categories (venue_id, sort, name);
create index if not exists ordering_products_venue_idx on public.ordering_products (venue_id, category_id, sort, name);
create index if not exists ordering_products_supplier_idx on public.ordering_products (supplier_id) where supplier_id is not null;
create index if not exists ordering_products_category_idx on public.ordering_products (category_id);
create index if not exists ordering_products_ingredient_idx on public.ordering_products (ingredient_id) where ingredient_id is not null;
create index if not exists ordering_count_sessions_venue_idx on public.ordering_count_sessions (venue_id, started_at desc);
create index if not exists ordering_count_lines_venue_product_idx on public.ordering_count_lines (venue_id, product_id);
create index if not exists ordering_count_lines_product_idx on public.ordering_count_lines (product_id);
create index if not exists ordering_orders_venue_idx on public.ordering_orders (venue_id, created_at desc);
create index if not exists ordering_orders_supplier_idx on public.ordering_orders (supplier_id);
create index if not exists ordering_orders_session_idx on public.ordering_orders (session_id) where session_id is not null;
create index if not exists ordering_order_lines_order_idx on public.ordering_order_lines (order_id, sort);
create index if not exists ordering_order_lines_venue_product_idx on public.ordering_order_lines (venue_id, product_id) where product_id is not null;
create index if not exists ordering_price_uploads_venue_idx on public.ordering_price_uploads (venue_id, uploaded_at desc);
create index if not exists ordering_price_uploads_supplier_idx on public.ordering_price_uploads (supplier_id) where supplier_id is not null;
create index if not exists ordering_price_log_product_idx on public.ordering_price_log (product_id, changed_at desc);
create index if not exists ordering_price_log_venue_idx on public.ordering_price_log (venue_id, changed_at desc);
create index if not exists ordering_price_log_upload_idx on public.ordering_price_log (upload_id) where upload_id is not null;

-- ---------------------------------------------------------------- row level security (same as every cost_* table)
alter table public.ordering_suppliers enable row level security;
drop policy if exists cost_allowed_all on public.ordering_suppliers;
create policy cost_allowed_all on public.ordering_suppliers for all to authenticated
  using (public.cost_is_allowed()) with check (public.cost_is_allowed());

alter table public.ordering_categories enable row level security;
drop policy if exists cost_allowed_all on public.ordering_categories;
create policy cost_allowed_all on public.ordering_categories for all to authenticated
  using (public.cost_is_allowed()) with check (public.cost_is_allowed());

alter table public.ordering_products enable row level security;
drop policy if exists cost_allowed_all on public.ordering_products;
create policy cost_allowed_all on public.ordering_products for all to authenticated
  using (public.cost_is_allowed()) with check (public.cost_is_allowed());

alter table public.ordering_count_sessions enable row level security;
drop policy if exists cost_allowed_all on public.ordering_count_sessions;
create policy cost_allowed_all on public.ordering_count_sessions for all to authenticated
  using (public.cost_is_allowed()) with check (public.cost_is_allowed());

alter table public.ordering_count_lines enable row level security;
drop policy if exists cost_allowed_all on public.ordering_count_lines;
create policy cost_allowed_all on public.ordering_count_lines for all to authenticated
  using (public.cost_is_allowed()) with check (public.cost_is_allowed());

alter table public.ordering_orders enable row level security;
drop policy if exists cost_allowed_all on public.ordering_orders;
create policy cost_allowed_all on public.ordering_orders for all to authenticated
  using (public.cost_is_allowed()) with check (public.cost_is_allowed());

alter table public.ordering_order_lines enable row level security;
drop policy if exists cost_allowed_all on public.ordering_order_lines;
create policy cost_allowed_all on public.ordering_order_lines for all to authenticated
  using (public.cost_is_allowed()) with check (public.cost_is_allowed());

alter table public.ordering_price_uploads enable row level security;
drop policy if exists cost_allowed_all on public.ordering_price_uploads;
create policy cost_allowed_all on public.ordering_price_uploads for all to authenticated
  using (public.cost_is_allowed()) with check (public.cost_is_allowed());

alter table public.ordering_price_log enable row level security;
drop policy if exists cost_allowed_all on public.ordering_price_log;
create policy cost_allowed_all on public.ordering_price_log for all to authenticated
  using (public.cost_is_allowed()) with check (public.cost_is_allowed());

-- ---------------------------------------------------------------- edit stamps (updated_at, updated_by)
drop trigger if exists ordering_suppliers_stamp on public.ordering_suppliers;
create trigger ordering_suppliers_stamp before insert or update on public.ordering_suppliers
  for each row execute function public.cost_stamp_edit();
drop trigger if exists ordering_categories_stamp on public.ordering_categories;
create trigger ordering_categories_stamp before insert or update on public.ordering_categories
  for each row execute function public.cost_stamp_edit();
drop trigger if exists ordering_products_stamp on public.ordering_products;
create trigger ordering_products_stamp before insert or update on public.ordering_products
  for each row execute function public.cost_stamp_edit();
drop trigger if exists ordering_count_sessions_stamp on public.ordering_count_sessions;
create trigger ordering_count_sessions_stamp before insert or update on public.ordering_count_sessions
  for each row execute function public.cost_stamp_edit();
drop trigger if exists ordering_count_lines_stamp on public.ordering_count_lines;
create trigger ordering_count_lines_stamp before insert or update on public.ordering_count_lines
  for each row execute function public.cost_stamp_edit();
drop trigger if exists ordering_orders_stamp on public.ordering_orders;
create trigger ordering_orders_stamp before insert or update on public.ordering_orders
  for each row execute function public.cost_stamp_edit();
drop trigger if exists ordering_order_lines_stamp on public.ordering_order_lines;
create trigger ordering_order_lines_stamp before insert or update on public.ordering_order_lines
  for each row execute function public.cost_stamp_edit();
drop trigger if exists ordering_price_uploads_stamp on public.ordering_price_uploads;
create trigger ordering_price_uploads_stamp before insert or update on public.ordering_price_uploads
  for each row execute function public.cost_stamp_edit();

-- ---------------------------------------------------------------- change history
-- The function below is cost_history_log() exactly as in 20261004240000_change_history.sql plus one block, marked NEW, that
-- returns early for a count line whose session is not finalised (only when the trigger passes 'when_session_finalised').
create or replace function public.cost_history_log()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  skip constant text[] := array['updated_at', 'updated_by', 'created_at', 'sort'];
  o jsonb;
  n jsonb;
  r jsonb;
  col text;
  parts text[] := '{}';
  fields text[] := '{}';
  k text;
  ptable text;
  pid text;
  who text;
begin
  begin
    o := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
    n := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
    r := coalesce(n, o);

    -- NEW: ordering count lines are recorded only after their count is finalised (fourth trigger argument)
    if tg_argv[3] = 'when_session_finalised' then
      if not exists (
        select 1 from public.ordering_count_sessions s
        where s.id = nullif(r ->> 'session_id', '')::uuid and s.status = 'finalised'
      ) then
        return null;
      end if;
    end if;

    foreach col in array string_to_array(coalesce(tg_argv[0], 'id'), ',') loop
      parts := parts || coalesce(r ->> btrim(col), '');
    end loop;
    k := array_to_string(parts, '|');

    if tg_op = 'UPDATE' then
      select coalesce(array_agg(c order by c), '{}') into fields
        from jsonb_object_keys(n) as c
        where c <> all (skip) and (o -> c) is distinct from (n -> c);
      -- only bookkeeping changed, or nothing did: not a change worth recording
      if cardinality(fields) = 0 then
        return null;
      end if;
    end if;

    if tg_table_name = 'cost_recipe_lines' then
      ptable := case r ->> 'parent_type' when 'item' then 'cost_menu_items' when 'prep' then 'cost_preps' else null end;
      pid := case when ptable is null then null else r ->> 'parent_id' end;
    elsif tg_argv[1] is not null and tg_argv[2] is not null then
      ptable := tg_argv[1];
      pid := r ->> tg_argv[2];
    end if;

    begin
      who := nullif(auth.jwt() ->> 'email', '');
    exception when others then
      who := null;
    end;

    insert into public.cost_change_history (table_name, row_key, op, old_row, new_row, changed_fields, parent_table, parent_id, changed_by)
    values (tg_table_name, k, lower(tg_op), o, n, fields, ptable, pid, who);
  exception when others then
    raise warning 'cost_history_log: could not record % on %: % (%)', tg_op, tg_table_name, sqlerrm, sqlstate;
  end;
  return null;
end $$;
revoke execute on function public.cost_history_log() from public, anon, authenticated;

drop trigger if exists ordering_suppliers_history on public.ordering_suppliers;
create trigger ordering_suppliers_history after insert or update or delete on public.ordering_suppliers
  for each row execute function public.cost_history_log('id');
drop trigger if exists ordering_categories_history on public.ordering_categories;
create trigger ordering_categories_history after insert or update or delete on public.ordering_categories
  for each row execute function public.cost_history_log('id');
drop trigger if exists ordering_products_history on public.ordering_products;
create trigger ordering_products_history after insert or update or delete on public.ordering_products
  for each row execute function public.cost_history_log('id');
drop trigger if exists ordering_count_sessions_history on public.ordering_count_sessions;
create trigger ordering_count_sessions_history after insert or update or delete on public.ordering_count_sessions
  for each row execute function public.cost_history_log('id');
drop trigger if exists ordering_count_lines_history on public.ordering_count_lines;
create trigger ordering_count_lines_history after insert or update or delete on public.ordering_count_lines
  for each row execute function public.cost_history_log('id', 'ordering_count_sessions', 'session_id', 'when_session_finalised');
drop trigger if exists ordering_orders_history on public.ordering_orders;
create trigger ordering_orders_history after insert or update or delete on public.ordering_orders
  for each row execute function public.cost_history_log('id');
drop trigger if exists ordering_price_uploads_history on public.ordering_price_uploads;
create trigger ordering_price_uploads_history after insert or update or delete on public.ordering_price_uploads
  for each row execute function public.cost_history_log('id');

comment on table public.ordering_suppliers is 'Ordering: one venue''s suppliers (how to send an order, rep, account, minimum order, whether to print prices). Separate per venue.';
comment on table public.ordering_categories is 'Ordering: one venue''s count categories in shelf order, with the second place label (null = Store only) and the default unit.';
comment on table public.ordering_products is 'Ordering: one venue''s drinks products with unit, supplier, item code, pack multiple, price, Build To (par) and an optional link to a costing ingredient.';
comment on table public.ordering_count_sessions is 'Ordering: a weekly stock count for one venue (in_progress then finalised). One in progress per venue.';
comment on table public.ordering_count_lines is 'Ordering: one product''s counted quantities in a session. No row = not counted; null quantity = not counted in that place; 0 = deliberate zero. Edits after the session is finalised are logged in cost_change_history.';
comment on table public.ordering_orders is 'Ordering: one supplier order for one venue (from a count, or a top-up), with the exact text that was sent.';
comment on table public.ordering_order_lines is 'Ordering: the lines of an order, with name, unit, code and price as they were when the order was made.';
comment on table public.ordering_price_uploads is 'Ordering: a supplier price sheet applied to one venue (who, when, file, how many rows matched, changed and unmatched).';
comment on table public.ordering_price_log is 'Ordering: every change to a product''s order price (old and new, who, when, and the upload it came from).';
