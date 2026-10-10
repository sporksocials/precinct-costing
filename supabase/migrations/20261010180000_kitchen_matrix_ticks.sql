-- Kitchen Allergy Matrix feed, ingredient-first allergens (Troy, 10 Oct 2026). Replaces cost_kitchen_matrix (20261010170000) with ONE addition
-- to the re-check rule, so the public iPad can never show green for a dish whose allergen ticks changed after it was confirmed.
--
-- Allergens are now ticked only on ingredients and a dish's allergens are worked out from them, so a sign-off is valid only while BOTH hold:
--   1. the dish's components (ingredients and preps, through nested preps, depth 8) equal dish_allergens.components, as before; AND
--   2. dish_allergens.ticks (the snapshot stored at Confirm) EQUALS the live snapshot built here from the live tables:
--        "ingredient:<id>" -> { a: allergens of the ingredient limited to the 15 main ids, r: allergens_reviewed is true }
--        "prep:<id>"       -> { add: allergen_add limited to the 15 main ids, rem: allergen_remove limited to the 15 main ids }
--        "item:<dishId>"   -> the dish itself, same shape as a prep
--      every id array is sorted in the fixed CONTAINS_IDS order (gluten, crustacea, egg, fish, milk, peanuts, sesame, soy, tree_nuts,
--      lupin, molluscs, sulphites, chilli, onion_garlic, nitrites; never alcohol) and is [] when empty. The comparison is jsonb equality:
--      key order does not matter, array order does, so the app must store the arrays in that order (lib/dish-allergens.ts).
--   A sign-off with no ticks key, or ticks that are not an object, is NOT valid (fail safe, grey). As a second fail-safe, every ingredient
--   in the dish's closure must have allergens_reviewed = true in the live data, whatever the stored snapshot says.
-- A sign-off that is not valid is sent with NO confirmed_at, so the iPad reads grey Not checked. Amounts never matter.
--
-- Everything else is identical to 20261010170000: the output shape, cross_contact (cost_settings.text_value, migration 20261010160000),
-- the allow-list of display fields (never a price, surcharge, cost, target, supplier, who signed off, the components list or the ticks),
-- the grants and the comment. Apply AFTER 20261010170000_kitchen_matrix_recheck.sql. Idempotent.
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
  -- the 15 main allergen ids in the fixed order (CONTAINS_IDS in lib/allergens.ts); alcohol is never part of the snapshot
  main(id, ord) as (
    select * from unnest(array['gluten','crustacea','egg','fish','milk','peanuts','sesame','soy','tree_nuts','lupin','molluscs','sulphites','chilli','onion_garlic','nitrites']) with ordinality
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
