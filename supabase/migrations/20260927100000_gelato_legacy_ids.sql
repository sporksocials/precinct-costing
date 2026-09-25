-- Gelato serves remember the ids of the old stored flavour x serve menu items they replaced,
-- so those items stay hidden even if a serve is renamed or switched off. Ids only: no price or figure is touched.
-- Mirrored in supabase/schema.sql.
alter table public.cost_gelato_serves add column if not exists legacy_item_ids uuid[] not null default '{}';
