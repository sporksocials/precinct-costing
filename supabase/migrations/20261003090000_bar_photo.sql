-- Bar display: the reference photo is now stored on the item (bar_photo = a file in public/bar/cocktails/),
-- not derived from its name. Renaming a drink in the costing app ("Pina Colada" -> "Piña Colada") used to
-- silently drop its photo, because the file was found by slugifying the name. Items with no bar_photo still
-- fall back to the name slug in the app, so a brand new drink with a matching file keeps working.
alter table public.cost_menu_items
  add column if not exists bar_photo text;

comment on column public.cost_menu_items.bar_photo is 'Bar display: reference photo file name in public/bar/cocktails/, e.g. "mai-tai.jpg". Null falls back to a slug of the item name.';

-- Pin every Drift cocktail that already has a photo file to that file, so a later rename can't orphan it.
update public.cost_menu_items mi
set bar_photo = trim(both '-' from regexp_replace(lower(replace(mi.name, '''', '')), '[^a-z0-9]+', '-', 'g')) || '.jpg'
from public.cost_venues v
where v.id = mi.venue_id and v.slug = 'drift' and mi.category in ('Cocktail', 'Mocktail')
  and mi.bar_photo is null
  and (mi.glass is not null or coalesce(mi.method, '[]'::jsonb) <> '[]'::jsonb or coalesce(mi.garnish, '[]'::jsonb) <> '[]'::jsonb);

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
