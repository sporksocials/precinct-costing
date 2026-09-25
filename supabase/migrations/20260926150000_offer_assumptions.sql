-- Sales Needed simulator: the assumptions typed on an offer (usual sales, expected sales, cannibalisation, weeks, profit goal).
-- Simulation inputs only. Nothing here is a price and no price column is touched. Mirrored in supabase/schema.sql.
alter table public.cost_offers add column if not exists assumptions jsonb not null default '{}'::jsonb;
