-- Kitchen Allergy Matrix feed (Troy, 10 Oct 2026). The public, no-login kitchen iPad shows the Allergy Matrix at
-- /kitchen/<venue>/matrix. Like cost_kitchen_data it reads through ONE narrow SECURITY DEFINER function and nothing else:
--   * only the venue's ACTIVE FOOD dishes (not gated by kitchen_ready: the matrix lists every active dish);
--   * per dish, an allow-list of display fields: id, name, section, the dish's own allergens (contains, can-be-made-without notes and
--     the sign-off TIME, never who signed it off), the hand-set marks (gf, v, vg) and each dietary option (gfo, vo, vgo, dfo);
--   * each option's swap is resolved to NAMES here ("left_out": ingredient and prep names; "added": name, qty, unit), so the iPad can say
--     "Leave out Brioche Bun. Add Tamari 15 ml." without reading any other table;
--   * NEVER a price: surcharge_inc is not selected, and no cost, GP, target or supplier appears anywhere.
-- Apply AFTER 20261010130000_dish_allergens.sql (the function reads cost_menu_items.dish_allergens). Malformed jsonb is skipped,
-- never an error: a bad value in one dish must not break the public feed. Idempotent.
create or replace function public.cost_kitchen_matrix(p_venue text)
returns json
language sql
stable
security definer
set search_path = public
as $$
  with
  v as (select id, slug, name from cost_venues where slug = p_venue),
  dishes as (
    select mi.id, mi.name, mi.section, mi.dish_allergens, mi.diet_options
    from cost_menu_items mi
    join v on mi.venue_id = v.id
    where mi.active and mi.category = 'Food'
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
    'dishes', coalesce((
      select json_agg(
        json_build_object(
          'id', d.id,
          'name', d.name,
          'section', d.section,
          'dish_allergens', case when jsonb_typeof(d.dish_allergens) = 'object'
            then jsonb_build_object('contains', d.dish_allergens -> 'contains', 'without', d.dish_allergens -> 'without', 'confirmed_at', d.dish_allergens -> 'confirmed_at')
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
      from dishes d), '[]'::json)
  )
  where exists (select 1 from v);
$$;

revoke all on function public.cost_kitchen_matrix(text) from public;
grant execute on function public.cost_kitchen_matrix(text) to anon, authenticated;

comment on function public.cost_kitchen_matrix(text) is 'Kitchen display (public iPad Allergy Matrix): one venue''s active Food dishes with their own allergens (contains, can-be-made-without notes, sign-off time), hand-set marks and dietary options with the swap resolved to names. Display fields only: never a price, surcharge, cost or who signed off. Null when the venue slug does not exist.';
