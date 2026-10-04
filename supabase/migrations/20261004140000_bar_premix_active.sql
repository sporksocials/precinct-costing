-- Pre-Mix Bottles page: list only bottles that at least one ACTIVE cocktail or mocktail uses, so switching a drink off
-- on the station also takes its bottle off the Pre-Mix page. Replaces cost_bar_premix from 20261004130000_bar_premix.sql.
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
              and mi.venue_id = v.id and mi.active and mi.category in ('Cocktail', 'Mocktail')
          ), '[]'::json)
        ) order by p.name)
      from cost_preps p
      where p.venue_id = v.id and p.active and lower(p.prep_type) = 'pre-mix'
        and exists (
          select 1 from cost_recipe_lines ul
          join cost_menu_items mi on mi.id = ul.parent_id
          where ul.parent_type = 'item' and ul.component_type = 'prep' and ul.component_id = p.id
            and mi.venue_id = v.id and mi.active and mi.category in ('Cocktail', 'Mocktail')
        )
    ), '[]'::json)
  )
  from cost_venues v
  where v.slug = p_venue;
$$;

revoke all on function public.cost_bar_premix(text) from public;
grant execute on function public.cost_bar_premix(text) to anon, authenticated;

comment on function public.cost_bar_premix(text) is 'Bar display (public iPad cocktail station, Pre-Mix Bottles page): one venue''s active pre-mix preps (prep_type Pre-mix) with yield, ingredient lines and the active cocktails/mocktails that use each. Display fields only, no prices, costs or notes. Null when the venue slug does not exist.';
