-- Gelato dietary labels: set each flavour that is on the laminated "Dietary Requirements" sheet exactly as the sheet says.
-- NOT a migration: run it by hand, once, AFTER supabase/migrations/20261005100000_gelato_dietary_labels.sql.
--
-- The sheet (photographed 5 Oct 2026, transcribed in files/source/gelato-dietary-sheet-2026-10-05.json) is the master.
-- Flavours matched by their exact prep name in the Gelato Rumba venue. Flavours that are NOT on the sheet are left alone:
-- their dietary_labels stay NULL, which means Automatic (worked out from the ingredients, never stored).
--
-- After this, a seeded flavour is "Set by hand": its ingredients no longer change it. Reset To Automatic on the flavour page
-- (or `update cost_preps set dietary_labels = null where id = ...`) puts it back on the ingredients.
-- Changes are recorded by the history trigger as "System" (direct database work).

-- 1. Back up the gelato preps first (house rule before any bulk change). Safe to re-run.
create schema if not exists backup;
create table if not exists backup.preps_20261005 as
  select p.* from public.cost_preps p join public.cost_venues v on v.id = p.venue_id where v.slug = 'gelato';

-- 2. Set the labels. Order inside each array does not matter (the app prints them in the sheet's order).
--    Sheet spellings resolved: "Vegan Chocolate Peanut Butter" is Vegan Peanut Butter Chocolate; "Tim & Tam" is Tim Tam (so
--    Tim Tam is Contains Gluten as well as Contains Egg); "Maltster" is the Malteser (already listed as "Malteser").
--    Dairy Free and Vegan for the vegan gelatos and the sorbet come from the sheet's rules ("All vegan gelatos", "All sorbets").
with sheet(prep_name, labels) as (
  values
    ('Tim Tam Gelato Mix',                       array['egg', 'gluten']),
    ('Tiramisu Gelato Mix',                      array['egg', 'soy', 'gluten']),
    ('Toblerone Gelato Mix',                     array['egg', 'nuts', 'gluten']),
    ('Rum & Raisin Gelato Mix',                  array['egg']),
    ('Cookies & Cream Gelato Mix',               array['egg', 'soy', 'gluten']),
    ('Salted Caramel Gelato Mix',                array['egg']),
    ('Gingerbread Gelato Mix',                   array['egg', 'soy', 'nuts', 'gluten']),
    ('Biscoff Gelato Mix',                       array['soy', 'gluten']),
    ('Vegan Chocolate Gelato Mix',               array['dairy_free', 'vegan', 'soy', 'nuts']),
    ('Vegan Peanut Butter Chocolate Gelato Mix', array['dairy_free', 'vegan', 'soy', 'nuts']),
    ('Snickers Gelato Mix',                      array['nuts']),
    ('Hazelnut Gelato Mix',                      array['nuts']),
    ('Pistachio Gelato Mix',                     array['nuts']),
    ('Ferrero Gelato Mix',                       array['nuts', 'gluten']),
    ('Caramel Macadamia Gelato Mix',             array['nuts']),
    ('Jaffa Gelato Mix',                         array['gluten']),
    ('Liquorice Gelato Mix',                     array['gluten']),
    ('Malteser Gelato Mix',                      array['gluten']),
    ('Golden Gaytime Gelato Mix',                array['gluten']),
    ('Cheesecake Gelato Mix',                    array['gluten']),
    ('Apple Pie Gelato Mix',                     array['gluten']),
    ('superlemon sorbet Gelato Mix',             array['dairy_free', 'vegan'])
)
update public.cost_preps p
   set dietary_labels = s.labels::text[]
  from sheet s, public.cost_venues v
 where v.slug = 'gelato'
   and p.venue_id = v.id
   and p.name = s.prep_name;
-- expect: UPDATE 22

-- 3. Check (run on its own): 22 rows, and every other gelato flavour still null.
-- select p.name, p.dietary_labels from public.cost_preps p join public.cost_venues v on v.id = p.venue_id
--  where v.slug = 'gelato' and p.prep_type = 'Gelato flavour mix' order by p.name;

-- On the sheet, with no flavour in the app (nothing to set; add the flavour later and these labels are one tap away):
--   Plain cones / Plain Cones   (the sheet lists them under Dairy Free, Vegan, Contains Soy and Contains Gluten: printed as fixed rows)
--   All sorbets, All vegan gelatos   (rules: covered by the sorbet and the two vegan flavours above)
--   Pavlova            Contains Egg, Contains Gluten (listed twice under Egg)
--   Vegan Coconut      Vegan, Contains Nuts
--   Butterscotch       Contains Gluten (the Golden Gaytime recipe uses butterscotch syrup and flavouring)
--   Chocolate Fudge Brownie   Contains Gluten
--
-- In the app and NOT on the sheet (left NULL, so Automatic): After Dinner Mint, Banana, Bubblegum, Caramelised Fig Mascarpone,
-- Chocolate, Espresso, Honeycomb, Mars Bar, Milkshake Vanilla, Mixed Berry, Pomegranate, Red Skin, Strawberry, Turkish Delight,
-- Vanilla Bean, White Chocolate.
