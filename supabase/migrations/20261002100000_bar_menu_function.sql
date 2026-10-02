-- Bar display (iPad cocktail station, /bar/<venue>): a public, read-only view of one venue's cocktails and mocktails.
-- The station has no login, and every cost_* table is locked to signed-in allowed users by RLS, so this
-- SECURITY DEFINER function is the only thing anonymous visitors can call. It returns display fields ONLY:
-- names, glass, method, garnish and recipe quantities. No prices, costs, targets, suppliers or internal notes.
-- Only items that have been built out for the bar (a glass, method or garnish set in the recipe editor) are
-- listed, so imported cocktails with no bar card yet (e.g. Chiobu's) don't appear half-finished on the iPad.
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
      where mi.venue_id = v.id and mi.active and mi.category in ('Cocktail', 'Mocktail')
        and (mi.glass is not null
          or coalesce(mi.method, '[]'::jsonb) <> '[]'::jsonb
          or coalesce(mi.garnish, '[]'::jsonb) <> '[]'::jsonb)
    ), '[]'::json)
  )
  from cost_venues v
  where v.slug = p_venue;
$$;

revoke all on function public.cost_bar_menu(text) from public;
grant execute on function public.cost_bar_menu(text) to anon, authenticated;

comment on function public.cost_bar_menu(text) is 'Bar display (public iPad cocktail station): one venue''s active cocktails/mocktails that have a glass, method or garnish set, with glass, method, garnish and recipe quantities. Display fields only, no prices or notes. Null when the venue slug does not exist.';
