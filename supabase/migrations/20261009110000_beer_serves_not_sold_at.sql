-- Tap beer: a serve can be left out at some venues. Troy, 9 Oct 2026: Chiobu and Greedy Gringo's sell only the Schooner and the Jug.
-- `not_sold_at` lists the venue ids (cost_venues.id) that do NOT pour the serve; empty = sold everywhere. Existing Pot and Pint prices at Chiobu are kept, just not shown.
alter table public.cost_beer_serves add column if not exists not_sold_at integer[] not null default '{}';
update public.cost_beer_serves set not_sold_at = '{2,3}' where name in ('Pot', 'Pint');
