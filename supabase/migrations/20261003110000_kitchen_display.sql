-- Kitchen display (iPad kitchen station, /kitchen/<venue>): how to make and plate a dish, how to make a prep, and a
-- per-record "Ready For Kitchen" sign-off. Nothing reaches the kitchen screen until the head chef ticks it.
alter table public.cost_menu_items
  add column if not exists kitchen_method jsonb,
  add column if not exists kitchen_plating jsonb,
  add column if not exists kitchen_photo text,
  add column if not exists kitchen_ready boolean not null default false;

alter table public.cost_preps
  add column if not exists kitchen_method jsonb,
  add column if not exists kitchen_storage text,
  add column if not exists kitchen_ready boolean not null default false;

comment on column public.cost_menu_items.kitchen_method is 'Kitchen display: ordered array of short make/assemble steps. Null when not written.';
comment on column public.cost_menu_items.kitchen_plating is 'Kitchen display: ordered array of plating points. Null when not written.';
comment on column public.cost_menu_items.kitchen_photo is 'Kitchen display: photo of the plated dish, an uploaded storage path ("uploads/...") in the bar-photos bucket. Null = none.';
comment on column public.cost_menu_items.kitchen_ready is 'Kitchen display: the head chef has checked this dish; only ready dishes show on the kitchen screen.';
comment on column public.cost_preps.kitchen_method is 'Kitchen display: ordered array of short method steps for the prep. Null when not written.';
comment on column public.cost_preps.kitchen_storage is 'Kitchen display: how to store it and how long it keeps, e.g. "Airtight container, fridge, 5 days".';
comment on column public.cost_preps.kitchen_ready is 'Kitchen display: the head chef has checked this prep; only ready preps show on the kitchen screen Prep tab and link from dishes.';

-- Public, read-only feed for one venue's kitchen station. The iPads have no login and every cost_* table is locked to
-- signed-in allowed users, so this SECURITY DEFINER function is the only thing anonymous visitors can call. It returns
-- DISPLAY fields only: names, weights, methods, plating, allergen data. No prices, costs, suppliers or internal notes.
-- Dishes: active Food items the head chef marked ready. Preps: ready ones, plus every prep those dishes (and ready preps)
-- use, however deep, so the allergen roll-up on the screen is complete. Ingredients: the ones those recipes use.
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
  all_preps(id) as (
    select p.id from cost_preps p, v where (p.venue_id = v.id or p.venue_id is null) and p.active and p.kitchen_ready
    union
    select rl.component_id from cost_recipe_lines rl join dishes d on rl.parent_type = 'item' and rl.parent_id = d.id
      where rl.component_type = 'prep'
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
        'id', i.id, 'name', i.name, 'allergens', i.allergens, 'allergens_reviewed', i.allergens_reviewed, 'diet_flags', i.diet_flags
      ) order by i.name) from cost_ingredients i
      where i.id in (select component_id from used_lines where component_type = 'ingredient')), '[]'::json),
    'lines', coalesce((
      select json_agg(json_build_object(
        'parent_type', ul.parent_type, 'parent_id', ul.parent_id, 'component_type', ul.component_type,
        'component_id', ul.component_id, 'qty', ul.qty, 'unit', ul.unit, 'note', ul.note, 'sort', ul.sort
      ) order by ul.parent_id, ul.sort, ul.id) from used_lines ul), '[]'::json)
  )
  where exists (select 1 from v);
$$;

revoke all on function public.cost_kitchen_data(text) from public;
grant execute on function public.cost_kitchen_data(text) to anon, authenticated;

comment on function public.cost_kitchen_data(text) is 'Kitchen display (public iPad kitchen station): one venue''s ready dishes and preps with the recipe lines, ingredient allergen data and overrides needed to roll allergens up. Display fields only, no prices or notes. Null when the venue slug does not exist.';
