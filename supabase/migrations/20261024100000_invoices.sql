-- Invoices: scanned supplier invoices are read, matched to products and ingredients, compared with the app's prices, and (under
-- rules Troy set on 24 Oct 2026) applied. Design: files/research/ (session plan). Everything here is NEW; the only change to an
-- existing table is one nullable column on ordering_price_log.
--
--  * invoice_files        one scanned PDF received (may hold many invoices).
--  * invoice_documents    one invoice / credit note found inside a file, with its own single-page-range PDF and checks.
--  * invoice_lines        every line as read, plus its match, landed cost and comparison (all the numbers behind a decision).
--  * invoice_price_changes  the undo ledger: every price the invoice system wrote, with the values before, so any change can be reversed.
--  * invoice_questions    things a person must answer (unmatched line, change over the limit, totals that do not add up...).
--  * invoice_suppliers    who an invoice is from (ABN and name variants), and per-supplier rules (allocation basis, auto-apply).
--  * invoice_item_map     what the system learned: supplier + item code (or description) -> ingredient / ordering product, with the
--                         pack conversion. rejected = true means "this is NOT that product".
--  * invoice_charge_rules editable rules that say what a delivery / fuel / deposit / discount line is and whether it is spread
--                         over the products (Troy: "I need to be able to ask you to change this in the future").
--  * invoice_digests      a record of each Slack digest and weekly email, so nothing is sent twice.
--  * ai_usage_log / ai_model_prices / ai_cost_viewers   what every AI call cost, who may see it (Troy and Abbey only).
--
-- Rules live in cost_settings (numeric): invoice_auto_apply_pct 0.05, invoice_learning_mode 1, invoice_average_days 90, ai_usd_to_aud.
-- RLS: everyone who can sign in sees and edits (cost_allowed_all), EXCEPT the AI cost tables (viewers only). The reader runs with
-- the service role (bypasses RLS) because the scanner script has no signed-in user.
-- Storage: private bucket invoice-pdfs; signed-in allowed users may read; only the service role writes.
-- Idempotent (create ... if not exists, drop policy/trigger if exists). No existing data is touched.

-- ---------------------------------------------------------------- invoice suppliers
create table if not exists public.invoice_suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> ''),
  abn text,                                         -- digits only, 11 characters when known
  aliases text[] not null default '{}',             -- other spellings seen on invoices (CD Australia Pty Ltd for Diablo Co)
  cost_supplier_id integer references public.cost_suppliers (id) on delete set null,
  allocation_basis text not null default 'value' check (allocation_basis in ('value', 'quantity')),
  auto_apply boolean not null default false,        -- per-supplier trust: only used once invoice_learning_mode is off
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text
);
create unique index if not exists invoice_suppliers_abn_key on public.invoice_suppliers (abn) where abn is not null;
create unique index if not exists invoice_suppliers_name_key on public.invoice_suppliers (lower(name));

-- ---------------------------------------------------------------- files and documents
create table if not exists public.invoice_files (
  id uuid primary key default gen_random_uuid(),
  venue_id integer not null references public.cost_venues (id),
  source_name text,                                 -- original file name in Drive
  drive_file_id text,
  storage_path text not null,                       -- invoice-pdfs bucket
  sha256 text not null,
  page_count integer,
  status text not null default 'received' check (status in ('received', 'sorting', 'reading', 'done', 'failed')),
  error text,
  attempts integer not null default 0,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint invoice_files_sha_key unique (venue_id, sha256)
);
create index if not exists invoice_files_status_idx on public.invoice_files (status, received_at);

create table if not exists public.invoice_documents (
  id uuid primary key default gen_random_uuid(),
  venue_id integer not null references public.cost_venues (id),
  file_id uuid not null references public.invoice_files (id) on delete cascade,
  supplier_id uuid references public.invoice_suppliers (id) on delete set null,
  supplier_name_read text,
  supplier_abn_read text,
  doc_type text not null default 'invoice' check (doc_type in ('invoice', 'credit_note', 'statement', 'delivery_docket', 'blank', 'other')),
  invoice_number text,
  invoice_date date,
  due_date date,
  pages integer[] not null default '{}',            -- 1-based page numbers inside the file
  page_pdf_path text,                               -- the split single-invoice PDF in the invoice-pdfs bucket
  bill_to text,
  ship_to text,
  venue_check text not null default 'unknown' check (venue_check in ('ok', 'mismatch', 'unknown')),
  price_basis text check (price_basis in ('ex', 'inc', 'mixed')),
  subtotal_ex numeric(12, 4),
  gst_total numeric(12, 4),
  total_inc numeric(12, 4),
  reconciled boolean not null default false,        -- line maths, subtotal, GST and total all agree
  recon_notes jsonb not null default '[]'::jsonb,
  fee_pool_ex numeric(12, 4) not null default 0,    -- delivery + fees + invoice-level discounts spread over the products
  status text not null default 'needs_review' check (status in ('needs_review', 'applied', 'partly_applied', 'nothing_to_apply', 'ignored', 'duplicate', 'failed')),
  mode text not null default 'learning' check (mode in ('learning', 'auto')),   -- the rule in force when it was processed
  duplicate_of uuid references public.invoice_documents (id) on delete set null,
  read_model text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text
);
create index if not exists invoice_documents_venue_idx on public.invoice_documents (venue_id, invoice_date desc);
create index if not exists invoice_documents_file_idx on public.invoice_documents (file_id);
create index if not exists invoice_documents_status_idx on public.invoice_documents (status);
-- the same invoice is never filed twice for a venue (a repeat scan is marked duplicate, not inserted as a live document)
create unique index if not exists invoice_documents_number_key
  on public.invoice_documents (venue_id, supplier_id, invoice_number)
  where supplier_id is not null and invoice_number is not null and status <> 'duplicate';

-- ---------------------------------------------------------------- lines
create table if not exists public.invoice_lines (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.invoice_documents (id) on delete cascade,
  venue_id integer not null references public.cost_venues (id),
  invoice_date date,                                -- copied from the document so cost history can be windowed without a join
  line_no integer not null,
  page integer,
  line_class text not null default 'product' check (line_class in ('product', 'delivery', 'fee', 'deposit', 'discount', 'credit', 'other')),
  item_code text,
  description text not null default '',
  qty numeric(14, 4),
  unit text,                                        -- as printed: KG, CTN, EA, KEG...
  unit_price_ex numeric(14, 4),                     -- ex GST, normalised by the engine from what was printed
  line_total_ex numeric(14, 4),
  gst text not null default 'unknown' check (gst in ('taxable', 'free', 'unknown')),
  gst_amount numeric(14, 4),
  math_ok boolean,                                  -- qty x unit price = line total (to the cent)
  -- match
  match_state text not null default 'unmatched' check (match_state in ('matched', 'unmatched', 'ambiguous', 'ignored')),
  match_method text check (match_method in ('code', 'alias', 'human')),
  map_id uuid,                                      -- foreign key added below, once invoice_item_map exists
  ingredient_id uuid references public.cost_ingredients (id) on delete set null,
  product_id uuid references public.ordering_products (id) on delete set null,
  packs_per_unit numeric(14, 4),                    -- costing packs in one invoice unit (24 cans per carton; 1 per kg)
  base_qty numeric(14, 4),                          -- quantity in the ingredient's base unit (kg, L, each)
  base_unit text,
  -- landed cost (ex GST): this line's share of the invoice's fee pool
  fee_share_ex numeric(14, 4) not null default 0,
  landed_total_ex numeric(14, 4),
  landed_unit_ex numeric(14, 4),                    -- per invoice unit
  landed_base_ex numeric(14, 4),                    -- per base unit (per kg, per L, per each)
  -- comparison with the app
  old_pack_price numeric(14, 4),                    -- the ingredient's pack_price now, in the ingredient's own basis (ex or inc)
  new_pack_price numeric(14, 4),                    -- what the invoice says it should be, same basis
  old_product_price numeric(14, 4),                 -- ordering product price_inc_gst now
  new_product_price numeric(14, 4),
  change_pct numeric(10, 6),                        -- (new - old) / old, signed
  decision text not null default 'none' check (decision in ('none', 'same', 'apply', 'needs_approval', 'skip')),
  decision_reason text,                             -- plain words: why it is not automatic
  state text not null default 'open' check (state in ('open', 'applied', 'confirmed', 'approved_skip', 'reverted', 'ignored')),
  created_at timestamptz not null default now()
);
create index if not exists invoice_lines_document_idx on public.invoice_lines (document_id, line_no);
create index if not exists invoice_lines_ingredient_idx on public.invoice_lines (ingredient_id, invoice_date desc) where ingredient_id is not null;
create index if not exists invoice_lines_product_idx on public.invoice_lines (product_id) where product_id is not null;
create index if not exists invoice_lines_venue_idx on public.invoice_lines (venue_id, invoice_date desc);

-- ---------------------------------------------------------------- learning table
create table if not exists public.invoice_item_map (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.invoice_suppliers (id) on delete cascade,
  venue_id integer references public.cost_venues (id),     -- null = every venue
  item_code text,
  desc_key text,                                    -- the description, lower case, letters and digits only
  ingredient_id uuid references public.cost_ingredients (id) on delete cascade,
  product_id uuid references public.ordering_products (id) on delete cascade,
  packs_per_unit numeric(14, 4) not null default 1 check (packs_per_unit > 0),
  rejected boolean not null default false,          -- "this code / description is NOT that product"
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text,
  constraint invoice_item_map_key_chk check (item_code is not null or desc_key is not null)
);
create unique index if not exists invoice_item_map_key
  on public.invoice_item_map (supplier_id, coalesce(venue_id, 0), coalesce(item_code, ''), coalesce(desc_key, ''), coalesce(ingredient_id, '00000000-0000-0000-0000-000000000000'));
create index if not exists invoice_item_map_ingredient_idx on public.invoice_item_map (ingredient_id) where ingredient_id is not null;
alter table public.invoice_lines drop constraint if exists invoice_lines_map_fk;
alter table public.invoice_lines add constraint invoice_lines_map_fk foreign key (map_id) references public.invoice_item_map (id) on delete set null;

-- ---------------------------------------------------------------- charge rules (editable)
create table if not exists public.invoice_charge_rules (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid references public.invoice_suppliers (id) on delete cascade,   -- null = every supplier
  match_text text not null check (btrim(match_text) <> ''),                       -- case-insensitive "contains" on the description or item code
  line_class text not null check (line_class in ('delivery', 'fee', 'deposit', 'discount', 'credit', 'other', 'product')),
  spread boolean not null,                          -- true = spread over the products as landed cost; false = left out of cost
  note text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text
);
insert into public.invoice_charge_rules (supplier_id, match_text, line_class, spread, note)
select null, v.match_text, v.line_class, v.spread, v.note
from (values
  ('delivery', 'delivery', true, 'Delivery is spread over the products on the invoice.'),
  ('freight', 'fee', true, 'Freight is spread over the products.'),
  ('fuel levy', 'fee', true, 'Fuel levy is spread over the products.'),
  ('surcharge', 'fee', true, 'Surcharges are spread over the products.'),
  ('deposit', 'deposit', false, 'Deposits are refundable, so they are left out of cost.'),
  ('keg return', 'deposit', false, 'Returnable kegs are left out of cost.'),
  ('discount', 'discount', true, 'Invoice-level discounts reduce the cost of the products.'),
  ('rounding', 'other', false, 'Rounding lines are left out of cost.')
) as v(match_text, line_class, spread, note)
where not exists (select 1 from public.invoice_charge_rules);

-- ---------------------------------------------------------------- price changes (the undo ledger)
create table if not exists public.invoice_price_changes (
  id uuid primary key default gen_random_uuid(),
  line_id uuid not null references public.invoice_lines (id) on delete cascade,
  document_id uuid not null references public.invoice_documents (id) on delete cascade,
  venue_id integer not null references public.cost_venues (id),
  target text not null check (target in ('ingredient', 'ordering_product')),
  target_id uuid not null,
  kind text not null check (kind in ('price_change', 'price_confirmed')),
  mode text not null check (mode in ('auto', 'approved')),
  old_price numeric(14, 4),
  new_price numeric(14, 4),
  old_last_price_update date,                       -- ingredient only: restored on undo
  old_previous_price numeric(14, 4),                -- ingredient only
  old_source text,                                  -- ingredient only
  cost_log_id bigint,                               -- cost_price_log.id written by the change (ingredient)
  ordering_log_id uuid,                             -- ordering_price_log.id written by the change (ordering product)
  note text,
  status text not null default 'applied' check (status in ('applied', 'reverted')),
  applied_by text,
  applied_at timestamptz not null default now(),
  reverted_by text,
  reverted_at timestamptz,
  revert_note text
);
create index if not exists invoice_price_changes_document_idx on public.invoice_price_changes (document_id);
create index if not exists invoice_price_changes_target_idx on public.invoice_price_changes (target, target_id, applied_at desc);
create index if not exists invoice_price_changes_applied_idx on public.invoice_price_changes (applied_at desc);

-- the ordering price log can now say which invoice a price came from
alter table public.ordering_price_log add column if not exists invoice_document_id uuid references public.invoice_documents (id) on delete set null;

-- ---------------------------------------------------------------- questions
create table if not exists public.invoice_questions (
  id uuid primary key default gen_random_uuid(),
  venue_id integer not null references public.cost_venues (id),
  document_id uuid not null references public.invoice_documents (id) on delete cascade,
  line_id uuid references public.invoice_lines (id) on delete cascade,
  kind text not null check (kind in ('unmatched_line', 'ambiguous_match', 'unit_unclear', 'big_change', 'totals_mismatch', 'venue_mismatch', 'credit_unclear', 'new_supplier', 'other')),
  prompt text not null,                             -- plain words, written for Mon and Matt
  options jsonb not null default '[]'::jsonb,       -- candidate answers: [{ "id", "label", "ingredient_id"?, "product_id"?, "packs_per_unit"? }]
  status text not null default 'open' check (status in ('open', 'answered', 'dismissed')),
  answer jsonb,
  answered_by text,
  answered_at timestamptz,
  emailed_at timestamptz,                           -- when it went into a weekly email
  created_at timestamptz not null default now()
);
create index if not exists invoice_questions_open_idx on public.invoice_questions (status, venue_id, created_at);
create index if not exists invoice_questions_document_idx on public.invoice_questions (document_id);

-- ---------------------------------------------------------------- digests (Slack and weekly email), so nothing is sent twice
create table if not exists public.invoice_digests (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('slack', 'weekly_email')),
  venue_id integer references public.cost_venues (id),
  created_at timestamptz not null default now(),
  period_from timestamptz,
  period_to timestamptz,
  document_ids uuid[] not null default '{}',
  question_ids uuid[] not null default '{}',
  body text,
  sent_at timestamptz
);
create index if not exists invoice_digests_kind_idx on public.invoice_digests (kind, created_at desc);

-- ---------------------------------------------------------------- AI cost
create table if not exists public.ai_model_prices (
  model text primary key,
  input_per_mtok numeric(12, 4) not null,           -- US dollars per million input tokens
  output_per_mtok numeric(12, 4) not null,
  cache_read_per_mtok numeric(12, 4) not null default 0,
  checked_on date not null
);
-- from platform.claude.com/docs/en/about-claude/pricing, checked 24 Oct 2026
insert into public.ai_model_prices (model, input_per_mtok, output_per_mtok, cache_read_per_mtok, checked_on) values
  ('claude-sonnet-5-5', 2, 10, 0.1, '2026-10-24'),
  ('claude-haiku-5-5', 0.1, 0.5, 0.01, '2026-10-24'),
  ('claude-opus-5-5', 4, 20, 0.2, '2026-10-24'),
  ('claude-fable-5-1', 10, 50, 0.25, '2026-10-24')
on conflict (model) do nothing;

create table if not exists public.ai_usage_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  feature text not null,                            -- invoice_sort, invoice_read, ...
  model text not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cache_read_tokens integer not null default 0,
  cost_usd numeric(12, 6) not null default 0,       -- worked out from ai_model_prices when the call was made
  venue_id integer references public.cost_venues (id),
  file_id uuid references public.invoice_files (id) on delete set null,
  document_id uuid references public.invoice_documents (id) on delete set null,
  ok boolean not null default true,
  note text
);
create index if not exists ai_usage_log_at_idx on public.ai_usage_log (at desc);
create index if not exists ai_usage_log_file_idx on public.ai_usage_log (file_id) where file_id is not null;

create table if not exists public.ai_cost_viewers (
  email text primary key
);
insert into public.ai_cost_viewers (email) values ('hello@sporksocials.com.au') on conflict (email) do nothing;

-- ---------------------------------------------------------------- settings
insert into public.cost_settings (key, value) values
  ('invoice_auto_apply_pct', 0.05),    -- price changes under this (up or down) may apply themselves
  ('invoice_learning_mode', 1),        -- 1 = every price needs a tap; 0 = suppliers with auto_apply may apply themselves
  ('invoice_average_days', 90),        -- window for the quantity-weighted average cost
  ('ai_usd_to_aud', 1.55)              -- an estimate for showing AI cost in AUD; edit in Settings
on conflict (key) do nothing;

-- ---------------------------------------------------------------- RLS
do $$
declare t text;
begin
  foreach t in array array[
    'invoice_suppliers', 'invoice_files', 'invoice_documents', 'invoice_lines', 'invoice_item_map', 'invoice_charge_rules',
    'invoice_price_changes', 'invoice_questions', 'invoice_digests', 'ai_model_prices'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists cost_allowed_all on public.%I', t);
    execute format('create policy cost_allowed_all on public.%I for all to authenticated using (public.cost_is_allowed()) with check (public.cost_is_allowed())', t);
  end loop;
end $$;

-- AI cost: only the listed viewers (Troy and Abbey) can read it; nobody signed in can change it (the service role writes it)
alter table public.ai_usage_log enable row level security;
alter table public.ai_cost_viewers enable row level security;
drop policy if exists ai_usage_viewers_select on public.ai_usage_log;
create policy ai_usage_viewers_select on public.ai_usage_log for select to authenticated
  using (exists (select 1 from public.ai_cost_viewers v where lower(v.email) = lower(coalesce(auth.jwt() ->> 'email', ''))));
drop policy if exists ai_cost_viewers_select on public.ai_cost_viewers;
create policy ai_cost_viewers_select on public.ai_cost_viewers for select to authenticated
  using (lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));

-- ---------------------------------------------------------------- edit stamps
drop trigger if exists invoice_suppliers_stamp on public.invoice_suppliers;
create trigger invoice_suppliers_stamp before insert or update on public.invoice_suppliers
  for each row execute function public.cost_stamp_edit();
drop trigger if exists invoice_documents_stamp on public.invoice_documents;
create trigger invoice_documents_stamp before insert or update on public.invoice_documents
  for each row execute function public.cost_stamp_edit();
drop trigger if exists invoice_item_map_stamp on public.invoice_item_map;
create trigger invoice_item_map_stamp before insert or update on public.invoice_item_map
  for each row execute function public.cost_stamp_edit();
drop trigger if exists invoice_charge_rules_stamp on public.invoice_charge_rules;
create trigger invoice_charge_rules_stamp before insert or update on public.invoice_charge_rules
  for each row execute function public.cost_stamp_edit();

-- ---------------------------------------------------------------- storage (private)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('invoice-pdfs', 'invoice-pdfs', false, 52428800, array['application/pdf'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists invoice_pdfs_select on storage.objects;
create policy invoice_pdfs_select on storage.objects for select to authenticated
  using (bucket_id = 'invoice-pdfs' and public.cost_is_allowed());
-- no insert/update/delete policy: only the service role (the reader) writes files

comment on table public.invoice_documents is 'One invoice or credit note read from a scanned file: supplier, number, date, totals, the checks it passed, and its split PDF.';
comment on table public.invoice_price_changes is 'Undo ledger: every price the invoice system wrote (or confirmed), with the values before, so it can be reversed.';
comment on table public.ai_usage_log is 'Cost of every AI call (invoice reading). Readable only by ai_cost_viewers.';
