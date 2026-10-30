-- Boba on the Drinks Station (Troy, 30 Oct 2026): "boba should get its own chip and on the screen also with boozy and normal".
-- 'Boba' is a drink category like Cold Drink. The Pre-Mix Bottles page also lists a pre-mix that only goes INTO another pre-mix
-- (the green tea inside each boba mix), listing the mixes it feeds under "Used In".

create or replace function cost_bar_menu(p_venue text) returns json
language sql stable security definer set search_path to 'public' as $$
  select json_build_object(
    'venue', json_build_object('slug', v.slug, 'name', v.name),
    'items', coalesce((
      select json_agg(json_build_object(
          'id', mi.id,
          'name', mi.name,
          'category', mi.category,
          'glass', mi.glass,
          'photo', mi.bar_photo,
          'menu_group', mi.menu_group,
          'method', coalesce(mi.method, '[]'::jsonb),
          'garnish', coalesce(mi.garnish, '[]'::jsonb),
          'lines', coalesce((
            select json_agg(json_build_object(
                'name', coalesce(ing.name, pr.name),
                'qty', rl.qty,
                'unit', rl.unit,
                'note', rl.note
              ) order by rl.sort nulls last, rl.id)
            from cost_recipe_lines rl
            left join cost_ingredients ing on rl.component_type = 'ingredient' and ing.id = rl.component_id
            left join cost_preps pr on rl.component_type = 'prep' and pr.id = rl.component_id
            where rl.parent_type = 'item' and rl.parent_id = mi.id
          ), '[]'::json)
        ) order by mi.name)
      from cost_menu_items mi
      where mi.venue_id = v.id and mi.active and mi.category in ('Cocktail', 'Mocktail', 'Cold Drink', 'Boba')
        and btrim(coalesce(mi.glass, '')) <> ''
        and coalesce(mi.method, '[]'::jsonb) <> '[]'::jsonb
    ), '[]'::json)
  )
  from cost_venues v
  where v.slug = p_venue;
$$;

create or replace function cost_bar_premix(p_venue text) returns json
language sql stable security definer set search_path to 'public' as $$
  select json_build_object(
    'venue', json_build_object('slug', v.slug, 'name', v.name),
    'premixes', coalesce((
      select json_agg(json_build_object(
          'id', p.id,
          'name', p.name,
          'yield_qty', p.yield_qty,
          'yield_unit', p.yield_unit,
          'lines', coalesce((
            select json_agg(json_build_object(
                'name', coalesce(ing.name, sub.name),
                'qty', rl.qty,
                'unit', rl.unit,
                'sort', rl.sort
              ) order by rl.sort, rl.id)
            from cost_recipe_lines rl
            left join cost_ingredients ing on rl.component_type = 'ingredient' and ing.id = rl.component_id
            left join cost_preps sub on rl.component_type = 'prep' and sub.id = rl.component_id
            where rl.parent_type = 'prep' and rl.parent_id = p.id
          ), '[]'::json),
          'used_in', coalesce((
            select json_agg(u.entry order by u.name, u.id)
            from (
              select json_build_object('drink', mi.name, 'qty', ul.qty, 'unit', ul.unit) as entry, mi.name as name, ul.id as id
              from cost_recipe_lines ul
              join cost_menu_items mi on mi.id = ul.parent_id
              where ul.parent_type = 'item' and ul.component_type = 'prep' and ul.component_id = p.id
                and mi.venue_id = v.id and mi.active and mi.category in ('Cocktail', 'Mocktail', 'Cold Drink', 'Boba')
              union all
              select json_build_object('drink', pp.name, 'qty', pl.qty, 'unit', pl.unit), pp.name, pl.id
              from cost_recipe_lines pl
              join cost_preps pp on pp.id = pl.parent_id
              where pl.parent_type = 'prep' and pl.component_type = 'prep' and pl.component_id = p.id
                and pp.venue_id = v.id and pp.active and lower(pp.prep_type) = 'pre-mix'
                and exists (
                  select 1 from cost_recipe_lines ul2
                  join cost_menu_items mi2 on mi2.id = ul2.parent_id
                  where ul2.parent_type = 'item' and ul2.component_type = 'prep' and ul2.component_id = pp.id
                    and mi2.venue_id = v.id and mi2.active and mi2.category in ('Cocktail', 'Mocktail', 'Cold Drink', 'Boba')
                )
            ) u
          ), '[]'::json)
        ) order by p.name)
      from cost_preps p
      where p.venue_id = v.id and p.active and lower(p.prep_type) = 'pre-mix'
        and (
          exists (
            select 1 from cost_recipe_lines ul
            join cost_menu_items mi on mi.id = ul.parent_id
            where ul.parent_type = 'item' and ul.component_type = 'prep' and ul.component_id = p.id
              and mi.venue_id = v.id and mi.active and mi.category in ('Cocktail', 'Mocktail', 'Cold Drink', 'Boba')
          )
          or exists (
            select 1 from cost_recipe_lines pl
            join cost_preps pp on pp.id = pl.parent_id
            where pl.parent_type = 'prep' and pl.component_type = 'prep' and pl.component_id = p.id
              and pp.venue_id = v.id and pp.active and lower(pp.prep_type) = 'pre-mix'
              and exists (
                select 1 from cost_recipe_lines ul2
                join cost_menu_items mi2 on mi2.id = ul2.parent_id
                where ul2.parent_type = 'item' and ul2.component_type = 'prep' and ul2.component_id = pp.id
                  and mi2.venue_id = v.id and mi2.active and mi2.category in ('Cocktail', 'Mocktail', 'Cold Drink', 'Boba')
              )
          )
        )
    ), '[]'::json)
  )
  from cost_venues v
  where v.slug = p_venue;
$$;
