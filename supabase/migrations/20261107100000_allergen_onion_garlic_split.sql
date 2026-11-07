-- Allergy Matrix: Onion and Garlic split (Brendan, executive chef, 7 Nov 2026). Replaces cost_kitchen_matrix (20261010180000) with ONE change:
-- the id list the live ticks snapshot is built from.
--
-- Onion and Garlic are now two allergen ids, 'onion' and 'garlic' (they were one id, 'onion_garlic', which stays as a hidden LEGACY id: still stored
-- on old ingredients, preps and dishes, never offered again). The snapshot list is, in the fixed order (SNAPSHOT_ALLERGEN_IDS in lib/allergens.ts):
--      gluten, crustacea, egg, fish, milk, peanuts, sesame, soy, tree_nuts, lupin, molluscs, sulphites, chilli, onion, garlic, onion_garlic, nitrites
-- so an ingredient ticked 'onion' or 'garlic' now counts in the snapshot, and the RAW 'onion_garlic' is kept exactly where it was relative to
-- the old ids. The snapshot is NOT expanded (a legacy id is not turned into onion plus garlic here), so for data that exists today it produces
-- exactly the same arrays as before and no stored sign-off becomes invalid. (The app reads a legacy id as BOTH ids everywhere it shows
-- allergens, which is why the sign-off's `contains` list can stay as stored.)
--
-- Nothing else changes: the output shape, the re-check rule (components AND ticks equal, every ingredient reviewed), cross_contact, the
-- allow-list of display fields (never a price, surcharge, cost, target, supplier, who signed off, the components list or the ticks), the grants
-- and the comment. No data is changed. Apply AFTER 20261010180000_kitchen_matrix_ticks.sql. Idempotent (create or replace).
create or replace function public.cost_kitchen_matrix(p_venue text)
returns json
language sql
stable
security definer
set search_path = public
as $$
  with recursive
  v as (select id, slug, name from cost_venues where slug = p_venue),
  dishes as (
    select mi.id, mi.name, mi.section, mi.dish_allergens, mi.diet_options, mi.allergen_add, mi.allergen_remove
    from cost_menu_items mi
    join v on mi.venue_id = v.id
    where mi.active and mi.category = 'Food'
  ),
  -- every ingredient and prep each dish is made from: its own lines (depth 0), then the lines of each prep found (depth + 1)
  walk(dish_id, component_type, component_id, depth) as (
    select d.id, rl.component_type, rl.component_id, 0
    from dishes d
    join cost_recipe_lines rl on rl.parent_type = 'item' and rl.parent_id = d.id
    union
    select w.dish_id, rl.component_type, rl.component_id, w.depth + 1
    from walk w
    join cost_recipe_lines rl on rl.parent_type = 'prep' and rl.parent_id = w.component_id
    where w.component_type = 'prep' and w.depth < 8
  ),
  closure as (
    select dish_id, array_agg(distinct (component_type || ':' || component_id::text)) as keys
    from walk
    group by dish_id
  ),
  -- the components stored at sign-off (null when missing or not a list)
  stored as (
    select d.id as dish_id,
           case when jsonb_typeof(d.dish_allergens -> 'components') = 'array'
                then array(select distinct e from jsonb_array_elements_text(d.dish_allergens -> 'components') e)
           end as keys
    from dishes d
    where jsonb_typeof(d.dish_allergens) = 'object'
  ),
  -- the allergen ids of the snapshot in the fixed order (SNAPSHOT_ALLERGEN_IDS in lib/allergens.ts): the 16 main ids, plus the LEGACY
  -- onion_garlic, kept so every snapshot stored before Onion and Garlic were split still compares equal; alcohol is never part of it
  main(id, ord) as (
    select * from unnest(array['gluten','crustacea','egg','fish','milk','peanuts','sesame','soy','tree_nuts','lupin','molluscs','sulphites','chilli','onion','garlic','onion_garlic','nitrites']) with ordinality
  ),
  -- the LIVE snapshot rows: each distinct ingredient and prep of each dish, plus the dish itself
  live_src as (
    select w.dish_id,
           w.component_type || ':' || w.component_id::text as key,
           case when w.component_type = 'ingredient'
                then jsonb_build_object(
                       'a', coalesce((select jsonb_agg(m.id order by m.ord) from main m where m.id = any(coalesce(i.allergens, '{}'::text[]))), '[]'::jsonb),
                       'r', coalesce(i.allergens_reviewed, false))
                else jsonb_build_object(
                       'add', coalesce((select jsonb_agg(m.id order by m.ord) from main m where m.id = any(coalesce(p.allergen_add, '{}'::text[]))), '[]'::jsonb),
                       'rem', coalesce((select jsonb_agg(m.id order by m.ord) from main m where m.id = any(coalesce(p.allergen_remove, '{}'::text[]))), '[]'::jsonb))
           end as sig,
           (w.component_type = 'ingredient' and not coalesce(i.allergens_reviewed, false)) as unreviewed
    from (select distinct dish_id, component_type, component_id from walk where component_id is not null) w
    left join cost_ingredients i on w.component_type = 'ingredient' and i.id = w.component_id
    left join cost_preps p on w.component_type = 'prep' and p.id = w.component_id
    union all
    select d.id, 'item:' || d.id::text,
           jsonb_build_object(
             'add', coalesce((select jsonb_agg(m.id order by m.ord) from main m where m.id = any(coalesce(d.allergen_add, '{}'::text[]))), '[]'::jsonb),
             'rem', coalesce((select jsonb_agg(m.id order by m.ord) from main m where m.id = any(coalesce(d.allergen_remove, '{}'::text[]))), '[]'::jsonb)),
           false
    from dishes d
  ),
  live as (
    select dish_id, jsonb_object_agg(key, sig) as ticks, bool_or(unreviewed) as has_unreviewed
    from live_src
    group by dish_id
  ),
  -- a sign-off counts only when it has a time, its stored components equal the dish's components now, its stored ticks equal the live
  -- snapshot, and every ingredient in the dish is reviewed now
  sign as (
    select d.id as dish_id,
           coalesce(nullif(d.dish_allergens ->> 'confirmed_at', '') is not null
                    and s.keys is not null
                    and s.keys @> coalesce(c.keys, '{}'::text[])
                    and coalesce(c.keys, '{}'::text[]) @> s.keys
                    and jsonb_typeof(d.dish_allergens -> 'ticks') = 'object'
                    and (d.dish_allergens -> 'ticks') = lv.ticks
                    and not coalesce(lv.has_unreviewed, true), false) as valid
    from dishes d
    left join stored s on s.dish_id = d.id
    left join closure c on c.dish_id = d.id
    left join live lv on lv.dish_id = d.id
  ),
  -- one row per dietary option a dish offers
  opts as (
    select d.id as dish_id, o.key as option_id, o.value as body
    from dishes d
    cross join lateral jsonb_each(case when jsonb_typeof(d.diet_options) = 'object' then d.diet_options else '{}'::jsonb end) o
    where o.key in ('gfo', 'vo', 'vgo', 'dfo') and jsonb_typeof(o.value) = 'object'
  ),
  -- the dish's own lines an option leaves out, by name
  left_out as (
    select op.dish_id, op.option_id, jsonb_agg(coalesce(i.name, p.name) order by rl.sort, rl.id) as names
    from opts op
    cross join lateral jsonb_array_elements_text(case when jsonb_typeof(op.body -> 'removed') = 'array' then op.body -> 'removed' else '[]'::jsonb end) r(line_id)
    join cost_recipe_lines rl on rl.parent_type = 'item' and rl.parent_id = op.dish_id and rl.id::text = r.line_id
    left join cost_ingredients i on rl.component_type = 'ingredient' and i.id = rl.component_id
    left join cost_preps p on rl.component_type = 'prep' and p.id = rl.component_id
    where coalesce(i.name, p.name) is not null
    group by op.dish_id, op.option_id
  ),
  -- the extra components an option adds, by name with the amount
  added as (
    select op.dish_id, op.option_id,
           jsonb_agg(
             jsonb_build_object(
               'name', coalesce(i.name, p.name),
               'qty', case when (a.elem ->> 'qty') ~ '^[0-9]+(\.[0-9]+)?$' then (a.elem ->> 'qty')::numeric else 0 end,
               'unit', a.elem ->> 'unit')
             order by a.ord) as items
    from opts op
    cross join lateral jsonb_array_elements(case when jsonb_typeof(op.body -> 'added') = 'array' then op.body -> 'added' else '[]'::jsonb end) with ordinality a(elem, ord)
    left join cost_ingredients i on (a.elem ->> 'component_type') = 'ingredient'
      and i.id = case when (a.elem ->> 'component_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (a.elem ->> 'component_id')::uuid end
    left join cost_preps p on (a.elem ->> 'component_type') = 'prep'
      and p.id = case when (a.elem ->> 'component_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (a.elem ->> 'component_id')::uuid end
    where coalesce(i.name, p.name) is not null
    group by op.dish_id, op.option_id
  )
  select json_build_object(
    'venue', (select json_build_object('slug', slug, 'name', name) from v),
    'cross_contact', (select nullif(btrim(text_value), '') from cost_settings where key = 'cross_contact_' || p_venue),
    'dishes', coalesce((
      select json_agg(
        json_build_object(
          'id', d.id,
          'name', d.name,
          'section', d.section,
          'dish_allergens', case when jsonb_typeof(d.dish_allergens) = 'object'
            then jsonb_build_object(
              'contains', d.dish_allergens -> 'contains',
              'without', d.dish_allergens -> 'without',
              -- the sign-off time only while it is still valid; otherwise absent, so the iPad reads Not checked
              'confirmed_at', case when sg.valid then d.dish_allergens -> 'confirmed_at' end)
            end,
          'marks', coalesce((
            select jsonb_agg(m.key order by m.key)
            from jsonb_each(case when jsonb_typeof(d.diet_options) = 'object' then d.diet_options else '{}'::jsonb end) m
            where m.key in ('gf', 'v', 'vg') and jsonb_typeof(m.value) = 'object'), '[]'::jsonb),
          'options', coalesce((
            select jsonb_object_agg(op.option_id, jsonb_build_object(
              'note', coalesce(op.body ->> 'note', ''),
              'left_out', coalesce(lo.names, '[]'::jsonb),
              'added', coalesce(ad.items, '[]'::jsonb)))
            from opts op
            left join left_out lo on lo.dish_id = op.dish_id and lo.option_id = op.option_id
            left join added ad on ad.dish_id = op.dish_id and ad.option_id = op.option_id
            where op.dish_id = d.id), '{}'::jsonb)
        )
        order by d.section nulls last, d.name)
      from dishes d
      left join sign sg on sg.dish_id = d.id), '[]'::json)
  )
  where exists (select 1 from v);
$$;

revoke all on function public.cost_kitchen_matrix(text) from public;
grant execute on function public.cost_kitchen_matrix(text) to anon, authenticated;

comment on function public.cost_kitchen_matrix(text) is 'Kitchen display (public iPad Allergy Matrix): one venue''s active Food dishes with their own allergens (contains, can-be-made-without notes, sign-off time ONLY while the sign-off is still valid: the dish''s components, through nested preps, and the allergen ticks on its ingredients, preps and the dish itself must equal those stored at sign-off, with every ingredient reviewed), hand-set marks and dietary options with the swap resolved to names, and the venue''s cross-contact line. Display fields only: never a price, surcharge, cost, who signed off, the components list or the ticks. Null when the venue slug does not exist.';
