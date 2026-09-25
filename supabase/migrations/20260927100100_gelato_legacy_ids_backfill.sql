-- Backfill cost_gelato_serves.legacy_item_ids. Idempotent: only serves whose array is still empty are set.
-- Pure SELECT-derived UPDATE of that one column: no deletes, no changes to menu items, no prices.
-- Matching rule mirrors lib/gelato.ts buildGelato today: a stored cost_menu_items row in the Gelato Rumba venue
-- (cost_venues.slug = 'gelato') whose section, trimmed and case-insensitive, equals the serve name
-- (each legacy item is named '<flavour> - <serve name>' with section = serve name).
update public.cost_gelato_serves s
set legacy_item_ids = m.ids
from (
  select s2.id as serve_id, array_agg(i.id order by i.id) as ids
  from public.cost_gelato_serves s2
  join public.cost_venues v on v.id = s2.venue_id and v.slug = 'gelato'
  join public.cost_menu_items i
    on i.venue_id = s2.venue_id
   and lower(btrim(coalesce(i.section, ''))) = lower(btrim(s2.name))
  group by s2.id
) m
where s.id = m.serve_id
  and coalesce(cardinality(s.legacy_item_ids), 0) = 0;

-- Verification (run by hand, not part of the migration):
-- 1. total ids across serves:
--    select count(*) as total_ids from public.cost_gelato_serves s, unnest(s.legacy_item_ids);
-- 2. legacy items not in any serve's array (expect 0, or review the list):
--    select i.id, i.name, i.section from public.cost_menu_items i
--    join public.cost_venues v on v.id = i.venue_id and v.slug = 'gelato'
--    where exists (select 1 from public.cost_gelato_serves s where s.venue_id = i.venue_id and lower(btrim(s.name)) = lower(btrim(coalesce(i.section, ''))))
--      and not exists (select 1 from public.cost_gelato_serves s where i.id = any (s.legacy_item_ids));
-- 3. items claimed by more than one serve (expect 0):
--    select u.id, count(*) from public.cost_gelato_serves s, unnest(s.legacy_item_ids) as u(id) group by u.id having count(*) > 1;
