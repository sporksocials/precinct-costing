-- Research notes: manager-only suggestions and "sheet differs from the classic" flags on a recipe, with the cost and GP
-- effect worked out in the app from `changes`. Never shown on the public bar or kitchen stations (those read only their
-- own narrow SECURITY DEFINER functions, which do not touch this table).
create table if not exists public.cost_research_notes (
  id uuid primary key default gen_random_uuid(),
  item_id uuid references public.cost_menu_items (id) on delete cascade,
  prep_id uuid references public.cost_preps (id) on delete cascade,
  -- suggestion: research says add or change something; difference: the venue's sheet differs from the classic recipe
  kind text not null default 'suggestion' check (kind in ('suggestion', 'difference')),
  title text not null,
  body text not null default '',
  -- recipe change the note would make, so the app can price it: [{"ingredient_id": uuid, "qty": number, "unit": "g|kg|ml|L|each"}]
  -- qty is a DELTA: positive adds that much, negative takes that much off the line already in the recipe. Empty = no cost effect worked out.
  changes jsonb not null default '[]'::jsonb,
  -- [{"label": "Difford's Guide", "url": "https://..."}]
  sources jsonb not null default '[]'::jsonb,
  status text not null default 'open' check (status in ('open', 'approved', 'dismissed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (item_id is not null or prep_id is not null)
);

create index if not exists cost_research_notes_item_idx on public.cost_research_notes (item_id);
create index if not exists cost_research_notes_prep_idx on public.cost_research_notes (prep_id);
create index if not exists cost_research_notes_status_idx on public.cost_research_notes (status);

alter table public.cost_research_notes enable row level security;
drop policy if exists cost_allowed_all on public.cost_research_notes;
create policy cost_allowed_all on public.cost_research_notes for all to authenticated
  using (public.cost_is_allowed()) with check (public.cost_is_allowed());

create or replace function public.cost_research_notes_touch()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke execute on function public.cost_research_notes_touch() from public, anon, authenticated;

drop trigger if exists cost_research_notes_touch on public.cost_research_notes;
create trigger cost_research_notes_touch
before update on public.cost_research_notes
for each row execute function public.cost_research_notes_touch();

comment on table public.cost_research_notes is 'Manager-only research suggestions and sheet-vs-classic flags on a recipe (menu item or prep), with a priceable change list. Never exposed publicly.';
