-- Kitchen feed: dietary option swaps (Troy, 10 Oct 2026). A dish's diet_options entries can now hold `removed` (recipe line
-- ids the option leaves out), `added` (extra components) and `surcharge_inc` (a price). The kitchen iPad is public, so:
--   * `surcharge_inc` is STRIPPED from every option before it leaves the database (the feed never carries a price);
--   * every recipe line is sent with its own `id`, so a left-out line can be named;
--   * the preps and ingredients an option ADDS are included (their names and allergen data), so "Add Tamari 15 ml" can be read.
-- No schema change: the swap data lives inside the existing cost_menu_items.diet_options jsonb. Apply this BEFORE anyone saves
-- a surcharge. Malformed jsonb is skipped, never an error: a bad value in one dish must not break the public feed.
create or replace function public.cost_kitchen_data(p_venue text)
returns json
language sql
stable
security definer
set search_path = public
as $$
  with recursive
  v as (select id, slug, name from cost_venues where slug = p_venue),
  dishes as (
    select mi.* from cost_menu_items mi, v
    where mi.venue_id = v.id and mi.active and mi.category = 'Food' and mi.kitchen_ready
  ),
  option_added as (
    select case when jsonb_typeof(a.value) = 'object' then a.value->>'component_type' end as component_type,
           case when jsonb_typeof(a.value) = 'object' and (a.value->>'component_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                then (a.value->>'component_id')::uuid end as component_id
    from dishes d,
         jsonb_each(case when jsonb_typeof(d.diet_options) = 'object' then d.diet_options else '{}'::jsonb end) o,
         jsonb_array_elements(case when jsonb_typeof(o.value) = 'object' and jsonb_typeof(o.value->'added') = 'array' then o.value->'added' else '[]'::jsonb end) a
  ),
  all_preps(id) as (
    select p.id from cost_preps p, v where (p.venue_id = v.id or p.venue_id is null) and p.active and p.kitchen_ready
    union
    select rl.component_id from cost_recipe_lines rl join dishes d on rl.parent_type = 'item' and rl.parent_id = d.id
      where rl.component_type = 'prep'
    union
    select oa.component_id from option_added oa where oa.component_type = 'prep' and oa.component_id is not null
    union
    select rl.component_id from cost_recipe_lines rl join all_preps ap on rl.parent_type = 'prep' and rl.parent_id = ap.id
      where rl.component_type = 'prep'
  ),
  used_lines as (
    select rl.* from cost_recipe_lines rl
    where (rl.parent_type = 'item' and rl.parent_id in (select id from dishes))
       or (rl.parent_type = 'prep' and rl.parent_id in (select id from all_preps))
  )
  select json_build_object(
    'venue', (select json_build_object('slug', slug, 'name', name) from v),
    'dishes', coalesce((
      select json_agg(json_build_object(
        'id', d.id, 'name', d.name, 'section', d.section, 'portions', d.portions,
        'method', coalesce(d.kitchen_method, '[]'::jsonb), 'plating', coalesce(d.kitchen_plating, '[]'::jsonb),
        'photo', d.kitchen_photo,
        'diet_options', (
          select coalesce(jsonb_object_agg(e.key, case when jsonb_typeof(e.value) = 'object' then e.value - 'surcharge_inc' else e.value end), '{}'::jsonb)
          from jsonb_each(case when jsonb_typeof(d.diet_options) = 'object' then d.diet_options else '{}'::jsonb end) e),
        'seafood_label', d.seafood_label,
        'allergen_add', d.allergen_add, 'allergen_remove', d.allergen_remove, 'allergen_notes', d.allergen_notes
      ) order by d.name) from dishes d), '[]'::json),
    'preps', coalesce((
      select json_agg(json_build_object(
        'id', p.id, 'name', p.name, 'prep_type', p.prep_type, 'yield_qty', p.yield_qty, 'yield_unit', p.yield_unit,
        'active', p.active, 'ready', p.kitchen_ready,
        'method', coalesce(p.kitchen_method, '[]'::jsonb), 'storage', p.kitchen_storage,
        'allergen_add', p.allergen_add, 'allergen_remove', p.allergen_remove, 'allergen_notes', p.allergen_notes
      ) order by p.name) from cost_preps p where p.id in (select id from all_preps)), '[]'::json),
    'ingredients', coalesce((
      select json_agg(json_build_object(
        'id', i.id, 'name', i.name, 'allergens', i.allergens, 'allergens_reviewed', i.allergens_reviewed, 'diet_flags', i.diet_flags,
        'seafood_origin', i.seafood_origin, 'seafood_exempt', i.seafood_exempt
      ) order by i.name) from cost_ingredients i
      where i.id in (select component_id from used_lines where component_type = 'ingredient')
         or i.id in (select oa.component_id from option_added oa where oa.component_type = 'ingredient' and oa.component_id is not null)), '[]'::json),
    'lines', coalesce((
      select json_agg(json_build_object(
        'id', ul.id, 'parent_type', ul.parent_type, 'parent_id', ul.parent_id, 'component_type', ul.component_type,
        'component_id', ul.component_id, 'qty', ul.qty, 'unit', ul.unit, 'note', ul.note, 'sort', ul.sort
      ) order by ul.parent_id, ul.sort, ul.id) from used_lines ul), '[]'::json)
  )
  where exists (select 1 from v);
$$;

revoke all on function public.cost_kitchen_data(text) from public;
grant execute on function public.cost_kitchen_data(text) to anon, authenticated;

comment on function public.cost_kitchen_data(text) is 'Kitchen display (public iPad kitchen station): one venue''s ready dishes and preps with the recipe lines, ingredient allergen data and overrides needed to roll allergens up, plus each dietary option''s swap (never its surcharge). Display fields only, no prices or notes. Null when the venue slug does not exist.';
