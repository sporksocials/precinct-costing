-- Kitchen Allergy Matrix feed, round two (Troy, 10 Oct 2026). Replaces cost_kitchen_matrix (20261010140000) with two additions:
--
-- 1. THE RE-CHECK RULE, server side, so the public iPad can never show green for a dish whose ingredients changed after it was signed off.
--    A sign-off is only valid while the set of components the dish is made from is exactly the set stored when it was signed off
--    (dish_allergens.components: "ingredient:<id>" / "prep:<id>"). The set is the dish's own recipe lines plus the lines of every prep
--    they use, recursively (cycle safe, capped at 8 levels like COMPONENT_DEPTH in lib/dish-allergens.ts). The two sets are compared
--    as SETS (order and repeats do not matter, and no collation can reorder them). If they differ, or the stored list is missing
--    (a sign-off made before this rule), the dish is sent with NO confirmed_at, so the iPad reads grey Not checked. Amounts never
--    matter: only which ingredients and preps.
-- 2. cross_contact: the venue's standing cross-contact line from cost_settings (key cross_contact_<slug>, text_value; migration
--    20261010160000), or null when unset (the app then uses its default line).
--
-- Still an allow-list of display fields: never a price, surcharge, cost, target, supplier, who signed off, or the components list.
-- Apply AFTER 20261010160000_cross_contact_setting.sql (it reads cost_settings.text_value). Idempotent.
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
    select mi.id, mi.name, mi.section, mi.dish_allergens, mi.diet_options
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
  -- a sign-off counts only when it has a time and its stored components equal the dish's components now
  sign as (
    select d.id as dish_id,
           coalesce(nullif(d.dish_allergens ->> 'confirmed_at', '') is not null
                    and s.keys is not null
                    and s.keys @> coalesce(c.keys, '{}'::text[])
                    and coalesce(c.keys, '{}'::text[]) @> s.keys, false) as valid
    from dishes d
    left join stored s on s.dish_id = d.id
    left join closure c on c.dish_id = d.id
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

comment on function public.cost_kitchen_matrix(text) is 'Kitchen display (public iPad Allergy Matrix): one venue''s active Food dishes with their own allergens (contains, can-be-made-without notes, sign-off time ONLY while the sign-off is still valid: the dish''s components, through nested preps, must equal those stored at sign-off), hand-set marks and dietary options with the swap resolved to names, and the venue''s cross-contact line. Display fields only: never a price, surcharge, cost, who signed off or the components list. Null when the venue slug does not exist.';
