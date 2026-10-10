-- Allergy Matrix print log (Troy, 10 Oct 2026). Every time a matrix is printed from /matrix/print the app writes one row here, so each
-- printed sheet has a version number and the costing app can say "Last printed 10 Oct 2026, version 3" and "Changed since printed:
-- 2 added, 1 removed, 3 changed".
--   venue_id  the venue the sheet belongs to (a sheet is always one venue)
--   section   the menu section on the sheet, or '*' for the All Sections print
--   version   1, 2, 3 ... per (venue, section): the previous highest + 1 (the app reads the highest, the unique key stops a double write)
--   snapshot  { "<dish id>": "<short stable hash of that dish's printed row>" }: name, section, every cell state and note, and whether the
--             sign-off was valid. Comparing it with the matrix as it is now says which dishes were added, removed or changed since.
-- Read and insert only, for people on the allowed list (cost_is_allowed()). No update or delete policy: a print happened, it is never
-- edited. NOT tracked by the change history trigger (it is a log, not a record anyone edits). Idempotent.
create table if not exists public.cost_matrix_prints (
  id uuid primary key default gen_random_uuid(),
  venue_id integer not null references public.cost_venues (id),
  section text not null,
  version integer not null check (version >= 1),
  printed_at timestamptz not null default now(),
  printed_by text,
  snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(snapshot) = 'object'),
  unique (venue_id, section, version)
);

create index if not exists cost_matrix_prints_venue_idx on public.cost_matrix_prints (venue_id, section, version desc);

alter table public.cost_matrix_prints enable row level security;
drop policy if exists cost_matrix_prints_select on public.cost_matrix_prints;
create policy cost_matrix_prints_select on public.cost_matrix_prints for select to authenticated using (public.cost_is_allowed());
drop policy if exists cost_matrix_prints_insert on public.cost_matrix_prints;
create policy cost_matrix_prints_insert on public.cost_matrix_prints for insert to authenticated with check (public.cost_is_allowed());

comment on table public.cost_matrix_prints is 'Allergy Matrix print log: one row per print of a venue section (or * for all sections) with a version number and a hash snapshot of each dish row, so the app can say what changed since the last print. Insert and select only.';
