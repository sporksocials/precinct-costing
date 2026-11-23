-- Merge Into Another Ingredient (Troy, 23 Nov 2026). The same real product had been entered as several ingredients ("Lime Juice (L)",
-- "Lime Juice (2L)" and a PFD "Lime Juice"), which split its cost, supplier and order lists; merging them by hand in SQL then made four
-- signed-off dishes read "Not checked" on the Allergy Matrix, because a dish's allergen sign-off stores the ids of its ingredients.
--
-- cost_merge_ingredient(p_source, p_target) moves everything that points at the SOURCE ingredient onto the TARGET (the one that is
-- kept), in ONE transaction, so a recipe is never left half moved (recipe lines are not atomic from the browser). The app's plan for
-- the same merge, shown to the person before they press the button, is lib/merge-ingredient.ts (planMerge); the two follow the same rules.
--
-- It never deletes anything, never changes a price, and never changes the target's own allergens, diet flags or reviewed state.
-- SECURITY INVOKER: it runs as the signed-in person, so RLS (cost_is_allowed()) guards every table exactly as it does for the app's
-- own writes, the history and edit-stamp triggers record who did it, and a person who is not allowed finds no ingredient to merge.
--
-- REFUSED, with a plain reason (nothing is written): source = target, either is missing, the target is inactive, the two are priced in
-- different kinds of unit (weight g/kg, volume ml/L, count each), or a recipe line that would move is in a unit the target cannot be
-- costed in (the test lib/costing.ts uses for a line: the line's unit must be of the ingredient's pack unit). Nothing is ever converted
-- between kinds of unit.
--
-- WHAT POINTS AT AN INGREDIENT, and what happens to each:
--   cost_recipe_lines (component_type 'ingredient')   moved to the target
--   cost_gelato_serve_lines.ingredient_id             moved (a serve's packaging lines; checked for units like recipe lines)
--   cost_beers.ingredient_id                          moved (the keg a tap beer pours from)
--   cost_ingredient_deals.ingredient_id               moved ONLY when the target has no deal of its own AND both are the same pack
--                                                     (size and unit), so a deal worked out per pack still means the same thing;
--                                                     otherwise the target's deals win and the source's stay on the source, where they
--                                                     stop applying (the source goes inactive). The app says which before the merge.
--   ordering_products.ingredient_id                   moved (the existing trigger then gives it the target's supplier). Where the target
--                                                     ALREADY has an active order list item at that venue, the source's item is moved and
--                                                     made inactive (the target's item wins; one product, one line on the order list).
--                                                     costing_packs_per_unit is restated for the target's pack size (see below).
--   invoice_item_map.ingredient_id                    moved, so the next invoice matches the target. A row that would duplicate one the
--                                                     target already has (the unique key) is NOT moved: the target's row wins, and the
--                                                     source's row is marked rejected so the code is never matched to the merged
--                                                     ingredient again (two live rows for one code would read as an ambiguous match).
--                                                     packs_per_unit is restated for the target's pack size.
--   invoice_lines.ingredient_id                       moved, so Cost From Invoices follows the kept ingredient. A line whose numbers were
--                                                     worked out against the source's pack and price is refused by the app's own live
--                                                     check when someone approves it, and any invoice not yet applied that has an open
--                                                     line for the source is marked for the free re-check (analysis_version 0).
--   invoice_questions.options (jsonb, open only)      the source's id is replaced by the target's in the candidate answers
--   cost_research_notes.changes (jsonb, open only)    the source's id is replaced by the target's
--   cost_menu_items.diet_options (jsonb)              "added" entries that add the source add the target instead
--   cost_menu_items.dish_allergens (jsonb)            the allergen sign-off: see below
--   NOT moved, on purpose: cost_price_log and invoice_price_changes (the source's own price history and undo ledger stay with the
--   source, whose price is not touched), cost_ignored_alerts (keys of alerts about the source, which goes inactive), and
--   cost_change_history (the record of what happened).
--
-- PACK COUNTS: costing_packs_per_unit and packs_per_unit are "costing packs in one order or invoice unit", so they depend on the
-- ingredient's pack size. Same pack size: unchanged. Different: value x source pack size / target pack size when that is exact to four
-- decimal places (12 one litre packs in a carton are 6 two litre packs), otherwise NULL, which already means "nobody has said" (the
-- engine then works it out safely or asks). A rounded pack count can never reach a price. (scaledPacks in lib/merge-ingredient.ts.)
--
-- ALLERGEN SIGN-OFFS: dish_allergens.components holds "ingredient:<id>" keys and dish_allergens.ticks a snapshot per ingredient
-- { "a": [...], "r": boolean }. The snapshot entry of the source and of the target is worked out here with the SAME expression
-- cost_kitchen_matrix uses (the ids of SNAPSHOT_ALLERGEN_IDS in the fixed order, and allergens_reviewed). When the two entries are
-- IDENTICAL, every stored sign-off is rewritten: "ingredient:<source>" becomes "ingredient:<target>" in components (kept sorted and
-- unique) and the ticks entry moves to the target's key (when the target already has an entry there, the source's is just dropped), so
-- every valid sign-off stays valid and nobody re-confirms. When they DIFFER, stored sign-offs are left untouched and those dishes
-- correctly read "Re-check Needed". (carrySignOff in lib/merge-ingredient.ts is the same rewrite; a test runs both.)
--
-- THE SOURCE is then renamed "<name> (merged)" (a number is added when that name is taken; the name stays unique) and made inactive.
--
-- Returns counts: lines, recipes, serve_lines, beers, deals, deals_left, order_items, order_items_stopped, invoice_maps,
-- invoice_maps_kept, invoice_lines, questions, research_notes, option_dishes, signoffs_carried, signoffs_left, same_allergens, merged_name.
--
-- Idempotent (create or replace). No data is changed by applying this migration.
create or replace function public.cost_merge_ingredient(p_source uuid, p_target uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  -- the allergen ids of the sign-off snapshot in the fixed order (SNAPSHOT_ALLERGEN_IDS in lib/allergens.ts; the same list as cost_kitchen_matrix)
  snap_ids constant text[] := array['gluten','crustacea','egg','fish','milk','peanuts','sesame','soy','tree_nuts','lupin','molluscs','sulphites','chilli','onion','garlic','onion_garlic','nitrites'];
  s public.cost_ingredients%rowtype;
  t public.cost_ingredients%rowtype;
  sk text;
  tk text;
  s_kind text;
  t_kind text;
  same_size boolean;
  same_ticks boolean;
  target_has_deals boolean;
  new_name text;
  k integer := 1;
  n_bad integer := 0;
  n_lines integer := 0;
  n_recipes integer := 0;
  n_serve integer := 0;
  n_beers integer := 0;
  n_deals integer := 0;
  n_deals_left integer := 0;
  n_order integer := 0;
  n_order_stopped integer := 0;
  n_maps integer := 0;
  n_maps_kept integer := 0;
  n_inv_lines integer := 0;
  n_questions integer := 0;
  n_notes integer := 0;
  n_options integer := 0;
  n_carried integer := 0;
  n_left integer := 0;
begin
  if p_source is null or p_target is null then
    raise exception 'Pick the ingredient to merge and the ingredient to keep';
  end if;
  if p_source = p_target then
    raise exception 'An ingredient cannot be merged into itself';
  end if;

  -- lock both rows, always in the same order, so two merges at once cannot deadlock or cross over
  perform 1 from cost_ingredients where id in (p_source, p_target) order by id for update;
  select * into s from cost_ingredients where id = p_source;
  if not found then
    raise exception 'The ingredient to merge was not found';
  end if;
  select * into t from cost_ingredients where id = p_target;
  if not found then
    raise exception 'The ingredient to keep was not found';
  end if;
  if not coalesce(t.active, true) then
    raise exception '% is inactive. Make it active first, or keep a different ingredient', t.name;
  end if;

  -- ---- the unit rule: the same kind of unit, and never a conversion between kinds
  s_kind := case when s.pack_unit in ('g', 'kg') then 'weight' when s.pack_unit in ('ml', 'L') then 'volume' else s.pack_unit end;
  t_kind := case when t.pack_unit in ('g', 'kg') then 'weight' when t.pack_unit in ('ml', 'L') then 'volume' else t.pack_unit end;
  if s_kind is distinct from t_kind or s.pack_unit is distinct from t.pack_unit then
    raise exception '% is priced per % and % per %. They are different kinds of unit, so they cannot be merged', s.name, s.pack_unit, t.name, t.pack_unit;
  end if;
  -- a line can be costed when its unit is of the ingredient's pack unit (lib/costing.ts unitBase): g and kg for kg, ml and L for L, each for each
  select
    (select count(*) from cost_recipe_lines rl
      where rl.component_type = 'ingredient' and rl.component_id = p_source
        and (case when rl.unit in ('g', 'kg') then 'kg' when rl.unit in ('ml', 'L') then 'L' else rl.unit end) is distinct from t.pack_unit)
    + (select count(*) from cost_gelato_serve_lines gl
      where gl.ingredient_id = p_source
        and (case when gl.unit in ('g', 'kg') then 'kg' when gl.unit in ('ml', 'L') then 'L' else gl.unit end) is distinct from t.pack_unit)
  into n_bad;
  if n_bad > 0 then
    raise exception '% recipe line(s) use a unit % cannot be costed in. Fix those lines first', n_bad, t.name;
  end if;

  sk := 'ingredient:' || p_source::text;
  tk := 'ingredient:' || p_target::text;
  same_size := s.pack_size is not distinct from t.pack_size;

  -- ---- recipes
  select count(distinct (parent_type || ':' || parent_id::text)) into n_recipes
  from cost_recipe_lines where component_type = 'ingredient' and component_id = p_source;
  update cost_recipe_lines set component_id = p_target where component_type = 'ingredient' and component_id = p_source;
  get diagnostics n_lines = row_count;

  update cost_gelato_serve_lines set ingredient_id = p_target where ingredient_id = p_source;
  get diagnostics n_serve = row_count;

  update cost_beers set ingredient_id = p_target where ingredient_id = p_source;
  get diagnostics n_beers = row_count;

  -- ---- supplier deals: only onto a target with none of its own, and only when a pack is the same pack
  select exists (select 1 from cost_ingredient_deals where ingredient_id = p_target) into target_has_deals;
  if not target_has_deals and same_size then
    update cost_ingredient_deals set ingredient_id = p_target where ingredient_id = p_source;
    get diagnostics n_deals = row_count;
  else
    select count(*) into n_deals_left from cost_ingredient_deals where ingredient_id = p_source;
  end if;

  -- ---- order lists: the target's own item at a venue wins; the source's item there is moved and stopped (never deleted)
  select count(*) into n_order_stopped
  from ordering_products p
  where p.ingredient_id = p_source and p.active
    and exists (select 1 from ordering_products o where o.ingredient_id = p_target and o.venue_id = p.venue_id and o.active);
  update ordering_products p
  set ingredient_id = p_target,
      active = case when p.active and exists (select 1 from ordering_products o where o.ingredient_id = p_target and o.venue_id = p.venue_id and o.active) then false else p.active end,
      costing_packs_per_unit = case
        when p.costing_packs_per_unit is null or same_size then p.costing_packs_per_unit
        when s.pack_size > 0 and t.pack_size > 0 and p.costing_packs_per_unit * s.pack_size / t.pack_size > 0
             and round(p.costing_packs_per_unit * s.pack_size / t.pack_size, 4) = p.costing_packs_per_unit * s.pack_size / t.pack_size
          then round(p.costing_packs_per_unit * s.pack_size / t.pack_size, 4)
        else null end
  where p.ingredient_id = p_source;
  get diagnostics n_order = row_count;

  -- ---- invoices: what was learned about the source now teaches the target
  -- a source row that would duplicate a row the target already has: the lines that used it point at the target's row, and it is
  -- marked rejected (kept, never deleted) so the code is not matched to the merged ingredient again
  update invoice_lines l
  set map_id = x.id
  from invoice_item_map m
  join invoice_item_map x
    on x.ingredient_id = p_target and x.supplier_id = m.supplier_id
   and coalesce(x.venue_id, 0) = coalesce(m.venue_id, 0)
   and coalesce(x.item_code, '') = coalesce(m.item_code, '')
   and coalesce(x.desc_key, '') = coalesce(m.desc_key, '')
   and x.product_id is not distinct from m.product_id
  where m.ingredient_id = p_source and l.map_id = m.id;
  update invoice_item_map m
  set rejected = true
  where m.ingredient_id = p_source
    and exists (
      select 1 from invoice_item_map x
      where x.ingredient_id = p_target and x.supplier_id = m.supplier_id
        and coalesce(x.venue_id, 0) = coalesce(m.venue_id, 0)
        and coalesce(x.item_code, '') = coalesce(m.item_code, '')
        and coalesce(x.desc_key, '') = coalesce(m.desc_key, '')
        and x.product_id is not distinct from m.product_id);
  get diagnostics n_maps_kept = row_count;
  update invoice_item_map m
  set ingredient_id = p_target,
      packs_per_unit = case
        when m.packs_per_unit is null or same_size then m.packs_per_unit
        when s.pack_size > 0 and t.pack_size > 0 and m.packs_per_unit * s.pack_size / t.pack_size > 0
             and round(m.packs_per_unit * s.pack_size / t.pack_size, 4) = m.packs_per_unit * s.pack_size / t.pack_size
          then round(m.packs_per_unit * s.pack_size / t.pack_size, 4)
        else null end
  where m.ingredient_id = p_source
    and not exists (
      select 1 from invoice_item_map x
      where x.ingredient_id = p_target and x.supplier_id = m.supplier_id
        and coalesce(x.venue_id, 0) = coalesce(m.venue_id, 0)
        and coalesce(x.item_code, '') = coalesce(m.item_code, '')
        and coalesce(x.desc_key, '') = coalesce(m.desc_key, '')
        and x.product_id is not distinct from m.product_id);
  get diagnostics n_maps = row_count;

  -- an invoice that is not applied yet and has an open line for the source is looked at again (the free re-check, no AI call)
  update invoice_documents d
  set analysis_version = 0
  where d.status not in ('applied', 'partly_applied', 'ignored', 'duplicate')
    and exists (select 1 from invoice_lines l where l.document_id = d.id and l.ingredient_id = p_source and l.state = 'open');
  update invoice_lines set ingredient_id = p_target where ingredient_id = p_source;
  get diagnostics n_inv_lines = row_count;

  -- ---- ids held inside jsonb. A uuid is unique text, so replacing the source's id with the target's touches nothing else.
  update invoice_questions
  set options = replace(options::text, p_source::text, p_target::text)::jsonb
  where status = 'open' and options::text like '%' || p_source::text || '%';
  get diagnostics n_questions = row_count;

  update cost_research_notes
  set changes = replace(changes::text, p_source::text, p_target::text)::jsonb
  where status = 'open' and changes::text like '%' || p_source::text || '%';
  get diagnostics n_notes = row_count;

  -- a menu option's "added" entries ({ component_type: 'ingredient', component_id }); its "removed" list holds recipe LINE ids, never ingredient ids
  update cost_menu_items
  set diet_options = replace(diet_options::text, p_source::text, p_target::text)::jsonb
  where diet_options is not null and diet_options::text like '%' || p_source::text || '%';
  get diagnostics n_options = row_count;

  -- ---- allergen sign-offs: the snapshot entry of each, worked out exactly as cost_kitchen_matrix works it out
  select
    coalesce((select jsonb_agg(m.id order by m.ord) from unnest(snap_ids) with ordinality as m(id, ord) where m.id = any(coalesce(s.allergens, '{}'::text[]))), '[]'::jsonb)
      = coalesce((select jsonb_agg(m.id order by m.ord) from unnest(snap_ids) with ordinality as m(id, ord) where m.id = any(coalesce(t.allergens, '{}'::text[]))), '[]'::jsonb)
    and coalesce(s.allergens_reviewed, false) = coalesce(t.allergens_reviewed, false)
  into same_ticks;

  if same_ticks then
    update cost_menu_items mi
    set dish_allergens = (
      select case
               when jsonb_typeof(c.da -> 'ticks') = 'object' and (c.da -> 'ticks') ? sk
                 then jsonb_set(c.da, '{ticks}',
                        case when (c.da -> 'ticks') ? tk
                             then (c.da -> 'ticks') - sk
                             else ((c.da -> 'ticks') - sk) || jsonb_build_object(tk, c.da -> 'ticks' -> sk) end)
               else c.da end
      from (
        select case
                 when jsonb_typeof(mi.dish_allergens -> 'components') = 'array' and (mi.dish_allergens -> 'components') ? sk
                   then jsonb_set(mi.dish_allergens, '{components}',
                          (select coalesce(jsonb_agg(x.comp order by x.comp collate "C"), '[]'::jsonb)
                           from (select distinct case when e = sk then tk else e end as comp
                                 from jsonb_array_elements_text(mi.dish_allergens -> 'components') e) x))
                 else mi.dish_allergens end as da
      ) c)
    where jsonb_typeof(mi.dish_allergens) = 'object'
      and ((jsonb_typeof(mi.dish_allergens -> 'components') = 'array' and (mi.dish_allergens -> 'components') ? sk)
        or (jsonb_typeof(mi.dish_allergens -> 'ticks') = 'object' and (mi.dish_allergens -> 'ticks') ? sk));
    get diagnostics n_carried = row_count;
  else
    select count(*) into n_left
    from cost_menu_items mi
    where jsonb_typeof(mi.dish_allergens) = 'object'
      and nullif(mi.dish_allergens ->> 'confirmed_at', '') is not null
      and jsonb_typeof(mi.dish_allergens -> 'components') = 'array'
      and (mi.dish_allergens -> 'components') ? sk;
  end if;

  -- ---- the source: kept, renamed and made inactive. Its price is not touched.
  if s.name ~ '\(merged( [0-9]+)?\)$' then
    new_name := s.name;
  else
    new_name := left(btrim(s.name), 120) || ' (merged)';
    while exists (select 1 from cost_ingredients where name = new_name and id <> p_source) loop
      k := k + 1;
      new_name := left(btrim(s.name), 120) || ' (merged ' || k::text || ')';
    end loop;
  end if;
  update cost_ingredients set active = false, name = new_name where id = p_source;

  return jsonb_build_object(
    'lines', n_lines,
    'recipes', n_recipes,
    'serve_lines', n_serve,
    'beers', n_beers,
    'deals', n_deals,
    'deals_left', n_deals_left,
    'order_items', n_order,
    'order_items_stopped', n_order_stopped,
    'invoice_maps', n_maps,
    'invoice_maps_kept', n_maps_kept,
    'invoice_lines', n_inv_lines,
    'questions', n_questions,
    'research_notes', n_notes,
    'option_dishes', n_options,
    'signoffs_carried', n_carried,
    'signoffs_left', n_left,
    'same_allergens', same_ticks,
    'merged_name', new_name);
end $$;

revoke all on function public.cost_merge_ingredient(uuid, uuid) from public, anon;
grant execute on function public.cost_merge_ingredient(uuid, uuid) to authenticated;

comment on function public.cost_merge_ingredient(uuid, uuid) is 'Merge one ingredient into another in one transaction (the Merge Into Another Ingredient button): recipe lines, gelato serve lines, tap beer kegs, order list items, invoice matches and lines, and menu option additions move to the target; supplier deals move only onto a target with none and the same pack; stored allergen sign-offs are rewritten only when both ingredients have the same allergen snapshot; the source is renamed "(merged)" and made inactive. Nothing is deleted and no price changes. SECURITY INVOKER: RLS applies.';
