-- Troy, 9 Oct 2026: (1) the Pot is no longer sold at Drift, so nobody sells it; (2) a 500ml Glass serve exists for a one-off beer
-- (Tiger at Chiobu); (3) a beer can list the only serves it pours (`only_serves`), which beats the venue's usual serves.
update public.cost_beer_serves set not_sold_at = '{1,2,3}' where name = 'Pot';
insert into public.cost_beer_serves (name, sort, ml, not_sold_at) values ('500ml Glass', 3, 500, '{1,2,3}') on conflict (name) do nothing;
update public.cost_beer_serves set sort = 4 where name = 'Pint' and sort = 3;
update public.cost_beer_serves set sort = 5 where name = 'Jug' and sort = 4;
alter table public.cost_beers add column if not exists only_serves uuid[];
update public.cost_beers b set only_serves = array[(select id from public.cost_beer_serves where name = 'Jug'), (select id from public.cost_beer_serves where name = '500ml Glass')]
 where b.name = 'Tiger' and b.venue_id = 2;
insert into public.cost_beer_prices (beer_id, serve_id)
 select b.id, s.id from public.cost_beers b, public.cost_beer_serves s where b.name = 'Tiger' and b.venue_id = 2 and s.name = '500ml Glass'
 on conflict (beer_id, serve_id) do nothing;
