-- Drinks Station: Drift's cold drinks (smoothies, iced coffees, frappes, milkshakes, spiders) join the cocktails and mocktails.
-- cost_menu_items.category is plain text with no check constraint, so 'Cold Drink' needs no schema change; only the two public
-- station functions list the categories they carry. Both are redefined here with 'Cold Drink' added to that list and nothing
-- else changed (the glass-and-method rule of 20261004210000 and the active-drink rules of 20261004140000 stay as they were).
create or replace function public.cost_bar_menu(p_venue text)
returns json
language sql
stable
security definer
set search_path = public
as $$
  select json_build_object(
    'venue', json_build_object('slug', v.slug, 'name', v.name),
    'items', coalesce((
      select json_agg(json_build_object(
          'id', mi.id,
          'name', mi.name,
          'category', mi.category,
          'glass', mi.glass,
          'photo', mi.bar_photo,
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
      where mi.venue_id = v.id and mi.active and mi.category in ('Cocktail', 'Mocktail', 'Cold Drink')
        and btrim(coalesce(mi.glass, '')) <> ''
        and coalesce(mi.method, '[]'::jsonb) <> '[]'::jsonb
    ), '[]'::json)
  )
  from cost_venues v
  where v.slug = p_venue;
$$;

revoke all on function public.cost_bar_menu(text) from public;
grant execute on function public.cost_bar_menu(text) to anon, authenticated;

comment on function public.cost_bar_menu(text) is 'Bar display (public iPad drinks station): one venue''s active cocktails, mocktails and cold drinks that have BOTH a glass and a method, with glass, method, garnish and recipe quantities. Display fields only, no prices or notes. Null when the venue slug does not exist.';

-- Pre-Mix Bottles page: a pre-mix is listed when an active cocktail, mocktail or cold drink uses it.
create or replace function public.cost_bar_premix(p_venue text)
returns json
language sql
stable
security definer
set search_path = public
as $$
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
            select json_agg(json_build_object(
                'drink', mi.name,
                'qty', ul.qty,
                'unit', ul.unit
              ) order by mi.name, ul.id)
            from cost_recipe_lines ul
            join cost_menu_items mi on mi.id = ul.parent_id
            where ul.parent_type = 'item' and ul.component_type = 'prep' and ul.component_id = p.id
              and mi.venue_id = v.id and mi.active and mi.category in ('Cocktail', 'Mocktail', 'Cold Drink')
          ), '[]'::json)
        ) order by p.name)
      from cost_preps p
      where p.venue_id = v.id and p.active and lower(p.prep_type) = 'pre-mix'
        and exists (
          select 1 from cost_recipe_lines ul
          join cost_menu_items mi on mi.id = ul.parent_id
          where ul.parent_type = 'item' and ul.component_type = 'prep' and ul.component_id = p.id
            and mi.venue_id = v.id and mi.active and mi.category in ('Cocktail', 'Mocktail', 'Cold Drink')
        )
    ), '[]'::json)
  )
  from cost_venues v
  where v.slug = p_venue;
$$;

revoke all on function public.cost_bar_premix(text) from public;
grant execute on function public.cost_bar_premix(text) to anon, authenticated;

comment on function public.cost_bar_premix(text) is 'Bar display (public iPad drinks station, Pre-Mix Bottles page): one venue''s active pre-mix preps (prep_type Pre-mix) with yield, ingredient lines and the active cocktails, mocktails and cold drinks that use each. Display fields only, no prices, costs or notes. Null when the venue slug does not exist.';
