-- Data fingerprint: one round trip that describes every table the app loads as {count, hash}, so the app can prove
-- its load was complete (row counts) and notice when someone else changed a table (hash). Read only.
--
--  * security invoker: RLS applies exactly as it does to the app's own reads. A user RLS blocks gets zero counts,
--    which the app reports as "no access" rather than as empty data.
--  * hash = md5 of every row's text form (all columns, so any change shows) ordered by primary key.
--  * cost_price_log covers rows changed on or after p_since (the app loads the last 90 days; it passes its own cut-off).
--  * Expected runtime: a single sequential scan per table, ~7k rows in total and about 0.5 MB of row text hashed at
--    today's size; tens of milliseconds server side, comparable to one page of the recipe lines fetch. No indexes needed.
--  * Execute is granted to authenticated only.
-- Idempotent.
create or replace function public.cost_data_fingerprint(p_since timestamptz default (now() - interval '90 days'))
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'generated_at', now(),
    'cost_venues', (select jsonb_build_object('count', count(*), 'hash', md5(coalesce(string_agg(t::text, E'\n' order by t.id), ''))) from public.cost_venues t),
    'cost_settings', (select jsonb_build_object('count', count(*), 'hash', md5(coalesce(string_agg(t::text, E'\n' order by t.key), ''))) from public.cost_settings t),
    'cost_targets', (select jsonb_build_object('count', count(*), 'hash', md5(coalesce(string_agg(t::text, E'\n' order by t.venue_id, t.category), ''))) from public.cost_targets t),
    'cost_suppliers', (select jsonb_build_object('count', count(*), 'hash', md5(coalesce(string_agg(t::text, E'\n' order by t.id), ''))) from public.cost_suppliers t),
    'cost_ingredients', (select jsonb_build_object('count', count(*), 'hash', md5(coalesce(string_agg(t::text, E'\n' order by t.id), ''))) from public.cost_ingredients t),
    'cost_preps', (select jsonb_build_object('count', count(*), 'hash', md5(coalesce(string_agg(t::text, E'\n' order by t.id), ''))) from public.cost_preps t),
    'cost_menu_items', (select jsonb_build_object('count', count(*), 'hash', md5(coalesce(string_agg(t::text, E'\n' order by t.id), ''))) from public.cost_menu_items t),
    'cost_recipe_lines', (select jsonb_build_object('count', count(*), 'hash', md5(coalesce(string_agg(t::text, E'\n' order by t.id), ''))) from public.cost_recipe_lines t),
    'cost_price_log', (select jsonb_build_object('count', count(*), 'hash', md5(coalesce(string_agg(t::text, E'\n' order by t.id), ''))) from public.cost_price_log t where t.changed_at >= p_since),
    'cost_specials', (select jsonb_build_object('count', count(*), 'hash', md5(coalesce(string_agg(t::text, E'\n' order by t.id), ''))) from public.cost_specials t),
    'cost_allowed_users', (select jsonb_build_object('count', count(*), 'hash', md5(coalesce(string_agg(t::text, E'\n' order by t.email), ''))) from public.cost_allowed_users t),
    'cost_gelato_serves', (select jsonb_build_object('count', count(*), 'hash', md5(coalesce(string_agg(t::text, E'\n' order by t.id), ''))) from public.cost_gelato_serves t),
    'cost_gelato_serve_lines', (select jsonb_build_object('count', count(*), 'hash', md5(coalesce(string_agg(t::text, E'\n' order by t.id), ''))) from public.cost_gelato_serve_lines t),
    'cost_beer_serves', (select jsonb_build_object('count', count(*), 'hash', md5(coalesce(string_agg(t::text, E'\n' order by t.id), ''))) from public.cost_beer_serves t),
    'cost_beers', (select jsonb_build_object('count', count(*), 'hash', md5(coalesce(string_agg(t::text, E'\n' order by t.id), ''))) from public.cost_beers t),
    'cost_beer_prices', (select jsonb_build_object('count', count(*), 'hash', md5(coalesce(string_agg(t::text, E'\n' order by t.id), ''))) from public.cost_beer_prices t),
    'cost_offers', (select jsonb_build_object('count', count(*), 'hash', md5(coalesce(string_agg(t::text, E'\n' order by t.id), ''))) from public.cost_offers t),
    'cost_offer_lines', (select jsonb_build_object('count', count(*), 'hash', md5(coalesce(string_agg(t::text, E'\n' order by t.id), ''))) from public.cost_offer_lines t),
    'cost_ingredient_deals', (select jsonb_build_object('count', count(*), 'hash', md5(coalesce(string_agg(t::text, E'\n' order by t.id), ''))) from public.cost_ingredient_deals t)
  );
$$;

revoke all on function public.cost_data_fingerprint(timestamptz) from public, anon;
grant execute on function public.cost_data_fingerprint(timestamptz) to authenticated;
