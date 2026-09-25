import {
  MAX_PREP_DEPTH,
  SUSPICIOUS_GP,
  buildIndex,
  costItem,
  parentKey,
  unitBase,
  type ItemCost,
} from "./costing";
import { brisbaneToday, dealPackPrice, dealStatus } from "./deals";
import { isBeerItemId, parseBeerItemId, beerItemId } from "./beer";
import { isVirtualItemId, parseVirtualItemId } from "./gelato";
import { DEFAULT_SETTINGS } from "./types";
import type {
  Beer,
  CostingSettings,
  Ingredient,
  IngredientDeal,
  MenuItem,
  Offer,
  OfferLine,
  PackUnit,
  Prep,
  RecipeLine,
  Target,
  Venue,
} from "./types";

/**
 * Data Health: pure validation of the data the app has LOADED. It only reads and reports. It never writes a
 * sell price, a cost or anything else. Every check is a small function below; `validate` runs them all.
 *
 * What it can and cannot see: a recipe line that never loaded (the paging bug) leaves no trace in the data
 * itself, so `validate(data, { lineCountBaseline })` also compares each recipe's loaded line count with a
 * baseline (see "Line count baseline" further down).
 *
 * Exceptions, by design:
 *  - Virtual items (`gelato~prep~serve`, `beer~beer~serve`, or source "beer"/"gelato") are computed, never stored.
 *    They are exempt from the "no lines", "no sell price" and duplicate-line checks (a beer with no keg is
 *    reported once, on the beer). Their lines are still checked for missing components and units.
 *  - Old stored gelato and tap beer items that the virtual items replace are hidden (`replacedItemIds`), so
 *    their leftover recipe lines are not reported as orphans.
 *  - Items with source "special" are specials by design: they may have no menu sell price.
 *  - Inactive items are skipped by the checks about what is on sale (no price, GP, no lines).
 */

export type Severity = "error" | "warning" | "info";
export type IssueKind = "item" | "prep" | "ingredient" | "offer" | "beer" | "setting";

export interface Issue {
  code: string;
  severity: Severity;
  title: string;
  /** what it means, plain English, sentence case */
  detail: string;
  kind: IssueKind;
  id: string;
  name: string;
  /** venue slug (drift, chiobu, greedy, gelato) when the record belongs to one venue */
  venue?: string;
  /** deep link to the record */
  fixHref: string;
}

export interface CheckInfo {
  title: string;
  severity: Severity;
  /** one line: why this matters to a cost, GP or price */
  why: string;
}

export const CHECKS: Record<string, CheckInfo> = {
  line_missing_component: { title: "Recipe line points to something that is gone", severity: "error", why: "That line costs nothing, so the recipe cost and GP look better than they are." },
  line_missing_parent: { title: "Recipe lines belong to a deleted recipe", severity: "error", why: "Leftover lines can hide real recipes that lost their lines or their parent." },
  line_duplicate: { title: "Same line entered twice", severity: "warning", why: "A doubled line makes the cost too high, or points to a copy and paste slip." },
  item_no_lines: { title: "Menu item with no recipe", severity: "error", why: "With no lines the cost is $0, so GP shows 100% and any suggested price is wrong." },
  prep_no_lines: { title: "Prep with no recipe", severity: "warning", why: "A prep with no lines costs $0, which understates every dish that uses it." },
  prep_cycle: { title: "Preps that use each other in a loop", severity: "error", why: "The loop cannot be costed, so every recipe that uses it is wrong." },
  prep_too_deep: { title: "Preps nested too deeply", severity: "error", why: `Costing stops at ${MAX_PREP_DEPTH} levels of preps, so costs below that are missing.` },
  unit_mismatch: { title: "Unit does not match the ingredient", severity: "error", why: "Mixing weight, volume and each gives a wrong cost for the line." },
  ingredient_bad_pack_size: { title: "Ingredient with no pack size", severity: "error", why: "Pack size divides the price, so the ingredient costs $0 in every recipe." },
  ingredient_bad_price: { title: "Ingredient with no pack price", severity: "error", why: "A $0 price makes every recipe using it look cheaper than it is." },
  ingredient_bad_yield: { title: "Ingredient yield out of range", severity: "error", why: "Yield must be above 0% and no more than 100%, or the cost per unit is wrong." },
  ingredient_negative_cost: { title: "Rebate is as large as the price", severity: "warning", why: "The cost per unit works out to zero or less, which understates recipes." },
  prep_bad_yield: { title: "Prep with no yield", severity: "error", why: "Yield divides the batch cost, so the prep costs $0 per unit." },
  item_bad_portions: { title: "Menu item with no portions", severity: "error", why: "Portions is 0 or blank, so the cost is worked out as one portion, which may be wrong." },
  item_no_price: { title: "Menu item with no sell price", severity: "warning", why: "Without a sell price there is no GP, and it drops out of the averages." },
  gp_too_high: { title: "GP above 92%", severity: "warning", why: "A margin this high usually means a missing ingredient or a wrong quantity." },
  gp_negative: { title: "Sold below cost", severity: "warning", why: "The sell price is under the cost, so either the price or the cost is wrong." },
  inactive_in_use: { title: "Inactive ingredient or prep still in use", severity: "warning", why: "Its price may not be kept up to date, so the recipes that use it drift out of date." },
  duplicate_ingredient: { title: "Possible duplicate ingredient", severity: "warning", why: "Two copies mean one gets price updates and the other goes stale." },
  offer_missing_component: { title: "Special or combo uses a deleted item", severity: "error", why: "The offer cost leaves that item out, so its GP is overstated." },
  setting_gst_unusual: { title: "GST rate is not 10%", severity: "info", why: "Australian GST is 10%. Every price and GP uses this rate." },
  setting_range: { title: "Setting out of range", severity: "warning", why: "A bad setting changes rounding, alerts or GST across every price." },
  target_range: { title: "Target GP outside 30% to 90%", severity: "warning", why: "An odd target gives odd suggested prices and flags the wrong dishes." },
  deal_expired_active: { title: "Deal has ended but is still switched on", severity: "warning", why: "The app ignores it, but it clutters the deals list and may confuse people." },
  deal_bad_price: { title: "Deal does not give a usable price", severity: "warning", why: "The app ignores it, so the saving you expect is not in the costs." },
  deal_orphan: { title: "Deal for an ingredient that is gone", severity: "warning", why: "The deal can never apply, so the saving you expect is not in the costs." },
  beer_no_keg: { title: "Tap beer with no keg", severity: "error", why: "With no keg linked, every serve of this beer costs $0." },
  line_count_drop: { title: "Recipe has fewer lines than before", severity: "error", why: "Lines may have failed to load, which makes the cost and GP too good to be true." },
  load_cap: { title: "Table size looks capped", severity: "info", why: "A whole number of thousands can mean the load stopped at a page limit." },
};

export interface IntegrityData {
  ingredients: Ingredient[];
  preps: Prep[];
  /** menu items exactly as the store shows them (stored items plus virtual gelato and beer items) */
  items: MenuItem[];
  /** recipe lines exactly as the store costs them (stored lines plus virtual lines) */
  lines: RecipeLine[];
  settings?: CostingSettings;
  targets?: Target[];
  venues?: Venue[];
  beers?: Beer[];
  offers?: Offer[];
  offerLines?: OfferLine[];
  deals?: IngredientDeal[];
  /** old stored items that virtual items replace (hidden), so their leftover lines are not orphans */
  replacedItemIds?: Iterable<string>;
  /** reuse the store's costs (same numbers as the app); computed here when absent */
  itemCosts?: Map<string, ItemCost>;
}

export interface ValidateOptions {
  /** most recipe lines ever seen per parent, keyed `item:<id>` / `prep:<id>` (see readLineBaseline) */
  lineCountBaseline?: Record<string, number> | null;
  /** yyyy-mm-dd in Brisbane; defaults to today */
  today?: string;
}

/* ------------------------------------------------------------------ helpers */

const SEVERITY_RANK: Record<Severity, number> = { error: 0, warning: 1, info: 2 };
export const severityRank = (s: Severity): number => SEVERITY_RANK[s];

function isVirtualItem(item: Pick<MenuItem, "id" | "source">): boolean {
  return isVirtualItemId(item.id) || item.source === "beer" || item.source === "gelato";
}
const isActive = (x: { active?: boolean | null }): boolean => x.active !== false;
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
};
const money = (n: number): string => `$${n.toFixed(2)}`;
const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** Lower case, trim, collapse runs of spaces (including odd unicode spaces). */
export function normaliseName(name: string | null | undefined): string {
  return (name ?? "").normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

export function recordHref(kind: IssueKind, id: string): string {
  switch (kind) {
    case "item": {
      const g = parseVirtualItemId(id);
      return g ? `/preps/${g.prepId}` : `/items/${id}`;
    }
    case "prep":
      return `/preps/${id}`;
    case "ingredient":
      return `/ingredients/${id}`;
    case "offer":
      return `/specials/${id}`;
    case "beer": {
      const b = parseBeerItemId(id);
      return `/beers/${b ? b.beerId : id}`;
    }
    case "setting":
      return "/settings";
  }
}

interface Ctx {
  data: IntegrityData;
  settings: CostingSettings;
  venueSlug: Map<number, string>;
  venueName: Map<number, string>;
  ingredients: Map<string, Ingredient>;
  preps: Map<string, Prep>;
  items: Map<string, MenuItem>;
  hidden: Set<string>;
  /** lines grouped by parent key, in input order */
  byParent: Map<string, RecipeLine[]>;
  usedIngredients: Set<string>;
  usedPreps: Set<string>;
  today: string;
}

function makeIssue(code: string, p: { kind: IssueKind; id: string; name: string; detail: string; venue?: string; fixHref?: string; severity?: Severity; title?: string }): Issue {
  const info = CHECKS[code];
  return {
    code,
    severity: p.severity ?? info.severity,
    title: p.title ?? info.title,
    detail: p.detail,
    kind: p.kind,
    id: p.id,
    name: p.name,
    venue: p.venue,
    fixHref: p.fixHref ?? recordHref(p.kind, p.id),
  };
}

function itemIssue(ctx: Ctx, code: string, item: MenuItem, detail: string, severity?: Severity): Issue {
  const kind: IssueKind = isBeerItemId(item.id) ? "beer" : "item";
  return makeIssue(code, { kind, id: item.id, name: item.name, detail, severity, venue: ctx.venueSlug.get(item.venue_id) });
}
function prepIssue(ctx: Ctx, code: string, prep: Prep, detail: string, severity?: Severity): Issue {
  return makeIssue(code, { kind: "prep", id: prep.id, name: prep.name, detail, severity, venue: prep.venue_id != null ? ctx.venueSlug.get(prep.venue_id) : undefined });
}
function ingredientVenue(ctx: Ctx, ing: Pick<Ingredient, "venues">): string | undefined {
  const v = normaliseName(ing.venues);
  if (!v) return undefined;
  const hits = (ctx.data.venues ?? []).filter((x) => v.includes(x.slug) || v.includes(normaliseName(x.name)) || v.includes(normaliseName(x.name).split(" ")[0]));
  return hits.length === 1 ? hits[0].slug : undefined;
}
function ingredientIssue(ctx: Ctx, code: string, ing: Ingredient, detail: string, severity?: Severity): Issue {
  return makeIssue(code, { kind: "ingredient", id: ing.id, name: ing.name, detail, severity, venue: ingredientVenue(ctx, ing) });
}

/** The parent of a line as a record: name, kind and venue, or null when it does not exist. */
function parentRecord(ctx: Ctx, l: Pick<RecipeLine, "parent_type" | "parent_id">): { name: string; issue: (code: string, detail: string, severity?: Severity) => Issue; active: boolean; virtual: boolean } | null {
  if (l.parent_type === "item") {
    const it = ctx.items.get(l.parent_id);
    return it ? { name: it.name, issue: (c, d, s) => itemIssue(ctx, c, it, d, s), active: isActive(it), virtual: isVirtualItem(it) } : null;
  }
  const p = ctx.preps.get(l.parent_id);
  return p ? { name: p.name, issue: (c, d, s) => prepIssue(ctx, c, p, d, s), active: isActive(p), virtual: false } : null;
}

function buildCtx(data: IntegrityData, opts: ValidateOptions): Ctx {
  const venueSlug = new Map<number, string>();
  const venueName = new Map<number, string>();
  for (const v of data.venues ?? []) {
    venueSlug.set(v.id, v.slug);
    venueName.set(v.id, v.name);
  }
  const byParent = new Map<string, RecipeLine[]>();
  const usedIngredients = new Set<string>();
  const usedPreps = new Set<string>();
  for (const l of data.lines) {
    const k = parentKey(l.parent_type, l.parent_id);
    const a = byParent.get(k);
    if (a) a.push(l);
    else byParent.set(k, [l]);
    if (l.component_type === "ingredient") usedIngredients.add(l.component_id);
    else usedPreps.add(l.component_id);
  }
  return {
    data,
    settings: data.settings ?? DEFAULT_SETTINGS,
    venueSlug,
    venueName,
    ingredients: new Map(data.ingredients.map((i) => [i.id, i])),
    preps: new Map(data.preps.map((p) => [p.id, p])),
    items: new Map(data.items.map((i) => [i.id, i])),
    hidden: new Set(data.replacedItemIds ?? []),
    byParent,
    usedIngredients,
    usedPreps,
    today: opts.today ?? brisbaneToday(),
  };
}

/* ------------------------------------------------------------------ line checks */

/** (a) a recipe line whose ingredient or prep does not exist. One issue per recipe. */
export function checkMissingComponents(ctx: Ctx): Issue[] {
  const perParent = new Map<string, RecipeLine[]>();
  for (const l of ctx.data.lines) {
    const exists = l.component_type === "ingredient" ? ctx.ingredients.has(l.component_id) : ctx.preps.has(l.component_id);
    if (exists) continue;
    const k = parentKey(l.parent_type, l.parent_id);
    const a = perParent.get(k);
    if (a) a.push(l);
    else perParent.set(k, [l]);
  }
  const out: Issue[] = [];
  for (const ls of perParent.values()) {
    const parent = parentRecord(ctx, ls[0]);
    if (!parent) continue; // reported by the orphan check
    const what = ls.map((l) => (l.component_type === "ingredient" ? "an ingredient" : "a prep")).filter((v, i, a) => a.indexOf(v) === i).join(" and ");
    out.push(parent.issue("line_missing_component", `${plural(ls.length, "line")} in this recipe point${ls.length === 1 ? "s" : ""} to ${what} that no longer exists, so ${ls.length === 1 ? "it costs" : "they cost"} $0.`));
  }
  return out;
}

/** (b) recipe lines whose parent (item or prep) does not exist. One issue per missing parent. */
export function checkOrphanLines(ctx: Ctx): Issue[] {
  const perParent = new Map<string, RecipeLine[]>();
  for (const l of ctx.data.lines) {
    if (l.parent_type === "item" && (ctx.items.has(l.parent_id) || ctx.hidden.has(l.parent_id))) continue;
    if (l.parent_type === "prep" && ctx.preps.has(l.parent_id)) continue;
    const k = parentKey(l.parent_type, l.parent_id);
    const a = perParent.get(k);
    if (a) a.push(l);
    else perParent.set(k, [l]);
  }
  const out: Issue[] = [];
  for (const [k, ls] of perParent) {
    const type = ls[0].parent_type;
    out.push(
      makeIssue("line_missing_parent", {
        kind: type === "prep" ? "prep" : "item",
        id: ls[0].parent_id,
        name: `Deleted ${type === "prep" ? "prep" : "menu item"} (id ending ${ls[0].parent_id.slice(-6)})`,
        detail: `${plural(ls.length, "recipe line")} belong${ls.length === 1 ? "s" : ""} to a ${type === "prep" ? "prep" : "menu item"} that no longer exists. If this is a recipe that lost its parent, its lines need attaching to the right record.`,
        fixHref: type === "prep" ? "/ingredients?type=preps" : "/menu",
      }),
    );
  }
  return out;
}

/** (c) exact duplicate lines (same component, quantity and unit) on one recipe. Virtual items are exempt. */
export function checkDuplicateLines(ctx: Ctx): Issue[] {
  const out: Issue[] = [];
  for (const ls of ctx.byParent.values()) {
    if (ls.length < 2) continue;
    const parent = parentRecord(ctx, ls[0]);
    if (!parent || parent.virtual) continue;
    const seen = new Map<string, number>();
    for (const l of ls) {
      const key = `${l.component_type}|${l.component_id}|${num(l.qty)}|${l.unit}`;
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    const dups = [...seen.entries()].filter(([, n]) => n > 1);
    if (!dups.length) continue;
    const names = dups.slice(0, 3).map(([key]) => {
      const [t, id] = key.split("|");
      return `"${(t === "ingredient" ? ctx.ingredients.get(id)?.name : ctx.preps.get(id)?.name) ?? "(missing)"}"`;
    });
    out.push(parent.issue("line_duplicate", `This recipe has the same line more than once: ${names.join(", ")}${dups.length > 3 ? ` and ${dups.length - 3} more` : ""}. Check it is not entered twice.`));
  }
  return out;
}

/** (d) active menu items and preps with no lines (virtual/legacy tap beer and gelato items are exempt). */
export function checkEmptyRecipes(ctx: Ctx): Issue[] {
  const out: Issue[] = [];
  for (const item of ctx.data.items) {
    if (!isActive(item) || isVirtualItem(item) || item.source === "special") continue;
    if ((ctx.byParent.get(parentKey("item", item.id))?.length ?? 0) === 0) out.push(itemIssue(ctx, "item_no_lines", item, "This menu item has no recipe lines, so its cost is $0 and its GP reads 100%."));
  }
  for (const prep of ctx.data.preps) {
    if (!isActive(prep)) continue;
    if ((ctx.byParent.get(parentKey("prep", prep.id))?.length ?? 0) > 0) continue;
    const used = ctx.usedPreps.has(prep.id);
    out.push(prepIssue(ctx, "prep_no_lines", prep, used ? "This prep has no recipe lines and is used in other recipes, so it costs $0 in all of them." : "This prep has no recipe lines, so it costs $0 if it is used.", used ? "error" : "warning"));
  }
  return out;
}

/** (e) prep cycles, and prep nesting deeper than MAX_PREP_DEPTH (costing stops there). */
export function checkPrepGraph(ctx: Ctx): Issue[] {
  const children = new Map<string, string[]>();
  for (const p of ctx.data.preps) {
    const kids: string[] = [];
    for (const l of ctx.byParent.get(parentKey("prep", p.id)) ?? []) if (l.component_type === "prep" && ctx.preps.has(l.component_id)) kids.push(l.component_id);
    children.set(p.id, kids);
  }
  const state = new Map<string, 1 | 2>();
  const depth = new Map<string, number>();
  const inCycle = new Set<string>();
  const cycles: string[][] = [];
  const seenCycles = new Set<string>();
  const path: string[] = [];
  const visit = (id: string): number => {
    state.set(id, 1);
    path.push(id);
    let d = 0;
    for (const c of children.get(id) ?? []) {
      const s = state.get(c);
      if (s === 1) {
        const members = path.slice(path.indexOf(c));
        const key = [...members].sort().join("|");
        if (!seenCycles.has(key)) {
          seenCycles.add(key);
          cycles.push(members);
        }
        for (const m of members) inCycle.add(m);
      } else if (s === 2) d = Math.max(d, depth.get(c) ?? 0);
      else d = Math.max(d, visit(c));
    }
    path.pop();
    state.set(id, 2);
    depth.set(id, d + 1);
    return d + 1;
  };
  for (const id of children.keys()) if (!state.has(id)) visit(id);

  const out: Issue[] = [];
  for (const members of cycles) {
    const first = ctx.preps.get(members[0])!;
    const names = members.map((m) => `"${ctx.preps.get(m)?.name ?? m}"`);
    out.push(prepIssue(ctx, "prep_cycle", first, `These preps use each other in a loop: ${names.join(" then ")} and back to ${names[0]}. None of them can be costed.`));
  }
  for (const p of ctx.data.preps) {
    if (inCycle.has(p.id)) continue;
    const d = depth.get(p.id) ?? 0;
    if (d > MAX_PREP_DEPTH) out.push(prepIssue(ctx, "prep_too_deep", p, `This prep sits at the top of ${d} levels of preps inside preps. Costing only goes ${MAX_PREP_DEPTH} deep.`));
  }
  for (const it of ctx.data.items) {
    let d = 0;
    for (const l of ctx.byParent.get(parentKey("item", it.id)) ?? []) if (l.component_type === "prep") d = Math.max(d, depth.get(l.component_id) ?? 0);
    if (d > MAX_PREP_DEPTH && !inCycle.has(it.id)) out.push(itemIssue(ctx, "prep_too_deep", it, `This menu item uses preps nested ${d} levels deep. Costing only goes ${MAX_PREP_DEPTH} deep.`));
  }
  return out;
}

/** (f) line unit incompatible with the component's unit (weight, volume or each). One issue per recipe. */
export function checkUnitMismatch(ctx: Ctx): Issue[] {
  const out: Issue[] = [];
  for (const ls of ctx.byParent.values()) {
    const bad: string[] = [];
    for (const l of ls) {
      let base: PackUnit | undefined;
      let name = "";
      if (l.component_type === "ingredient") {
        const c = ctx.ingredients.get(l.component_id);
        base = c?.pack_unit;
        name = c?.name ?? "";
      } else {
        const c = ctx.preps.get(l.component_id);
        base = c?.yield_unit;
        name = c?.name ?? "";
      }
      if (!base) continue;
      const lineBase = unitBase(l.unit);
      if (lineBase !== base) bad.push(`"${name}" is used in ${l.unit} but priced per ${base === "each" ? "each" : base}`);
    }
    if (!bad.length) continue;
    const parent = parentRecord(ctx, ls[0]);
    if (!parent) continue;
    out.push(parent.issue("unit_mismatch", `${bad.slice(0, 3).join("; ")}${bad.length > 3 ? `; and ${bad.length - 3} more` : ""}. Weight, volume and each cannot be swapped.`));
  }
  return out;
}

/* ------------------------------------------------------------------ ingredient and prep checks */

/** (g) ingredients used in a recipe with a bad pack size, pack price or yield, plus rebates that wipe out the price. */
export function checkIngredients(ctx: Ctx): Issue[] {
  const out: Issue[] = [];
  for (const ing of ctx.data.ingredients) {
    if (!ctx.usedIngredients.has(ing.id)) continue;
    const size = num(ing.pack_size);
    const price = ing.pack_price == null ? NaN : num(ing.pack_price);
    const y = num(ing.yield_pct);
    if (!(size > 0)) out.push(ingredientIssue(ctx, "ingredient_bad_pack_size", ing, `Pack size is ${ing.pack_size == null ? "blank" : ing.pack_size}, and this ingredient is used in recipes, so it costs $0 there.`));
    if (!(price > 0)) out.push(ingredientIssue(ctx, "ingredient_bad_price", ing, `Pack price is ${ing.pack_price == null ? "blank" : money(price)}, and this ingredient is used in recipes, so it costs $0 there.`));
    if (!(y > 0) || y > 1) out.push(ingredientIssue(ctx, "ingredient_bad_yield", ing, `Yield is ${Number.isFinite(y) ? `${Math.round(y * 1000) / 10}%` : "blank"}. It needs to be more than 0% and at most 100%.`));
    const rebate = num(ing.rebate) || 0;
    if (price > 0 && size > 0 && y > 0 && y <= 1 && rebate >= price) out.push(ingredientIssue(ctx, "ingredient_negative_cost", ing, `The rebate (${money(rebate)}) is as large as the pack price (${money(price)}), so it costs nothing.`));
  }
  return out;
}

/** (h) preps with a yield of 0 or less. Error when the prep is used, otherwise a warning. */
export function checkPrepYield(ctx: Ctx): Issue[] {
  const out: Issue[] = [];
  for (const p of ctx.data.preps) {
    if (num(p.yield_qty) > 0) continue;
    const used = ctx.usedPreps.has(p.id);
    out.push(prepIssue(ctx, "prep_bad_yield", p, `Yield is ${p.yield_qty == null ? "blank" : p.yield_qty}, so this prep costs $0 per ${p.yield_unit ?? "unit"}${used ? " in every recipe that uses it" : ""}.`, used ? "error" : "warning"));
  }
  return out;
}

/** (i) menu items with portions of 0 or less. */
export function checkPortions(ctx: Ctx): Issue[] {
  const out: Issue[] = [];
  for (const it of ctx.data.items) {
    if (isVirtualItem(it)) continue;
    if (!(num(it.portions) > 0)) out.push(itemIssue(ctx, "item_bad_portions", it, `Portions is ${it.portions == null ? "blank" : it.portions}. The cost is worked out as one portion instead.`));
  }
  return out;
}

/** (j) active stored menu items with no sell price (specials are exempt). */
export function checkSellPrices(ctx: Ctx): Issue[] {
  const out: Issue[] = [];
  for (const it of ctx.data.items) {
    if (!isActive(it) || isVirtualItem(it) || it.source === "special") continue;
    if (!(num(it.sell_price_inc) > 0)) out.push(itemIssue(ctx, "item_no_price", it, "This active menu item has no sell price, so it has no GP."));
  }
  return out;
}

/** (k) GP above 92% or below 0%. Items with no recipe are left to the "no recipe" check. */
export function checkGp(ctx: Ctx, costs: Map<string, ItemCost>): Issue[] {
  const out: Issue[] = [];
  for (const it of ctx.data.items) {
    if (!isActive(it)) continue;
    const c = costs.get(it.id);
    if (!c || c.gpPct == null) continue;
    if ((ctx.byParent.get(parentKey("item", it.id))?.length ?? 0) === 0) continue;
    if (c.gpPct > SUSPICIOUS_GP) out.push(itemIssue(ctx, "gp_too_high", it, `GP is ${(c.gpPct * 100).toFixed(1)}%. Cost per portion is ${money(c.costPerPortion)} against ${money(c.sellInc ?? 0)} inc GST. Check the recipe is complete.`));
    else if (c.gpPct < 0) out.push(itemIssue(ctx, "gp_negative", it, `GP is ${(c.gpPct * 100).toFixed(1)}%. Cost per portion is ${money(c.costPerPortion)} against ${money(c.sellInc ?? 0)} inc GST.`));
  }
  return out;
}

/** (l) inactive ingredients and preps still used by active recipes. One issue per component. */
export function checkInactiveInUse(ctx: Ctx): Issue[] {
  const users = new Map<string, Set<string>>();
  for (const l of ctx.data.lines) {
    const comp = l.component_type === "ingredient" ? ctx.ingredients.get(l.component_id) : ctx.preps.get(l.component_id);
    if (!comp || isActive(comp)) continue;
    const parent = parentRecord(ctx, l);
    if (!parent || !parent.active) continue;
    const k = `${l.component_type}:${l.component_id}`;
    const s = users.get(k);
    if (s) s.add(l.parent_id);
    else users.set(k, new Set([l.parent_id]));
  }
  const out: Issue[] = [];
  for (const [k, s] of users) {
    const [type, ...rest] = k.split(":");
    const id = rest.join(":");
    const what = `${plural(s.size, "active recipe")}`;
    if (type === "ingredient") {
      const ing = ctx.ingredients.get(id)!;
      out.push(ingredientIssue(ctx, "inactive_in_use", ing, `This ingredient is switched off but ${what} still use${s.size === 1 ? "s" : ""} it.`));
    } else {
      const p = ctx.preps.get(id)!;
      out.push(prepIssue(ctx, "inactive_in_use", p, `This prep is switched off but ${what} still use${s.size === 1 ? "s" : ""} it.`));
    }
  }
  return out;
}

/** (m) two ingredients with the same name (ignoring case and spacing) in the same venue scope. */
export function checkDuplicateIngredients(ctx: Ctx): Issue[] {
  const groups = new Map<string, Ingredient[]>();
  for (const ing of ctx.data.ingredients) {
    const n = normaliseName(ing.name);
    if (!n) continue;
    const key = `${n}|${normaliseName(ing.venues)}`;
    const g = groups.get(key);
    if (g) g.push(ing);
    else groups.set(key, [ing]);
  }
  const out: Issue[] = [];
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    const first = g[0];
    out.push(ingredientIssue(ctx, "duplicate_ingredient", first, `${g.length} ingredients share this name${first.venues ? ` at ${first.venues}` : ""}. Keep one and move recipes across, or rename them so it is clear which is which.`));
  }
  return out;
}

/* ------------------------------------------------------------------ offers, settings, targets, deals */

/** (n) offers whose components were deleted. Live offers are errors; drafts are warnings; retired are skipped. */
export function checkOffers(ctx: Ctx): Issue[] {
  const offers = ctx.data.offers ?? [];
  const lines = ctx.data.offerLines ?? [];
  if (!offers.length) return [];
  const by = new Map<string, OfferLine[]>();
  for (const l of lines) {
    const a = by.get(l.offer_id);
    if (a) a.push(l);
    else by.set(l.offer_id, [l]);
  }
  const out: Issue[] = [];
  for (const o of offers) {
    if (o.status === "retired") continue;
    let gone = 0;
    for (const l of by.get(o.id) ?? []) {
      const costId = l.component_kind === "item" ? l.item_id : l.beer_id && l.serve_id ? beerItemId(l.beer_id, l.serve_id) : null;
      if (!costId || !ctx.items.has(costId)) gone++;
    }
    if (gone)
      out.push(makeIssue("offer_missing_component", { kind: "offer", id: o.id, name: o.name, venue: ctx.venueSlug.get(o.venue_id), severity: o.status === "live" ? "error" : "warning", detail: `${plural(gone, "item")} in this ${o.status === "live" ? "live " : ""}offer ${gone === 1 ? "has" : "have"} been deleted, so the offer cost is short.` }));
  }
  return out;
}

const SETTING_LABEL: Record<string, string> = { gst_rate: "GST", round_to: "Round prices up to", alert_pct: "Price alert level", gelato_wastage: "Gelato wastage" };

/** (o) settings out of range. GST that is not about 10% is only an info. */
export function checkSettings(ctx: Ctx): Issue[] {
  const s = ctx.settings;
  const out: Issue[] = [];
  const add = (code: string, key: string, detail: string, severity?: Severity) => out.push(makeIssue(code, { kind: "setting", id: key, name: SETTING_LABEL[key] ?? key, detail, severity }));
  const gst = num(s.gst_rate);
  if (!Number.isFinite(gst) || gst < 0 || gst > 0.5) add("setting_range", "gst_rate", `GST is ${Number.isFinite(gst) ? `${Math.round(gst * 1000) / 10}%` : "blank"}, which is outside 0% to 50%. Every price and GP uses this.`);
  else if (Math.abs(gst - 0.1) > 0.0005) add("setting_gst_unusual", "gst_rate", `GST is set to ${Math.round(gst * 1000) / 10}%. If that is on purpose, ignore this. Australian GST is 10%.`);
  if (!(num(s.round_to) > 0)) add("setting_range", "round_to", `Round prices up to is ${money(num(s.round_to) || 0)}. It needs to be more than $0, or suggested prices are not rounded.`);
  if (!(num(s.alert_pct) > 0)) add("setting_range", "alert_pct", "Price alert level is 0% or less, so price rises never raise an alert.");
  const w = num(s.gelato_wastage);
  if (Number.isFinite(w) && (w < 0 || w >= 1)) add("setting_range", "gelato_wastage", `Gelato wastage is ${Math.round(w * 1000) / 10}%. It needs to be between 0% and 100%.`);
  return out;
}

export const TARGET_MIN = 0.3;
export const TARGET_MAX = 0.9;

/** (p) target GPs outside 30% to 90%: venue and category targets, item overrides and beer targets. */
export function checkTargets(ctx: Ctx): Issue[] {
  const out: Issue[] = [];
  const bad = (t: unknown) => {
    const n = num(t);
    return Number.isFinite(n) && (n < TARGET_MIN - 1e-9 || n > TARGET_MAX + 1e-9);
  };
  const pct = (t: unknown) => `${Math.round(num(t) * 1000) / 10}%`;
  for (const t of ctx.data.targets ?? []) {
    if (!bad(t.target_gp)) continue;
    const venue = ctx.venueName.get(t.venue_id) ?? `Venue ${t.venue_id}`;
    out.push(makeIssue("target_range", { kind: "setting", id: `${t.venue_id}:${t.category}`, name: `${venue} ${t.category} target`, venue: ctx.venueSlug.get(t.venue_id), detail: `The target GP is ${pct(t.target_gp)}. Targets are normally between 30% and 90%.` }));
  }
  for (const it of ctx.data.items) {
    if (isVirtualItem(it) || it.target_override == null || !bad(it.target_override)) continue;
    out.push(itemIssue(ctx, "target_range", it, `This item has its own target GP of ${pct(it.target_override)}. Targets are normally between 30% and 90%.`));
  }
  for (const b of ctx.data.beers ?? []) {
    if (b.target_gp == null || !bad(b.target_gp)) continue;
    out.push(makeIssue("target_range", { kind: "beer", id: b.id, name: b.name, venue: ctx.venueSlug.get(b.venue_id), detail: `This beer has its own target GP of ${pct(b.target_gp)}. Targets are normally between 30% and 90%.` }));
  }
  return out;
}

/** Tap beers that are active but have no keg. Virtual beer items are exempt from "no lines", so this is where it shows. */
export function checkBeers(ctx: Ctx): Issue[] {
  const out: Issue[] = [];
  for (const b of ctx.data.beers ?? []) {
    if (!isActive(b)) continue;
    if (!b.ingredient_id) out.push(makeIssue("beer_no_keg", { kind: "beer", id: b.id, name: b.name, venue: ctx.venueSlug.get(b.venue_id), detail: "This beer is not linked to a keg ingredient, so all its serves cost $0." }));
    else if (!ctx.ingredients.has(b.ingredient_id)) out.push(makeIssue("beer_no_keg", { kind: "beer", id: b.id, name: b.name, venue: ctx.venueSlug.get(b.venue_id), detail: "The keg this beer points to no longer exists, so all its serves cost $0." }));
  }
  return out;
}

/** (q) deals that ended but are still switched on, and deals that give no usable price (zero or less). */
export function checkDeals(ctx: Ctx): Issue[] {
  const out: Issue[] = [];
  for (const d of ctx.data.deals ?? []) {
    if (!d.active) continue;
    const ing = ctx.ingredients.get(d.ingredient_id);
    if (!ing) {
      out.push(makeIssue("deal_orphan", { kind: "ingredient", id: d.ingredient_id, name: "Deleted ingredient", fixHref: "/ingredients", detail: "A deal is switched on for an ingredient that no longer exists." }));
      continue;
    }
    if (dealStatus(d, ctx.today) === "expired") out.push(ingredientIssue(ctx, "deal_expired_active", ing, `A deal ended on ${d.ends_on} but is still switched on. Switch it off or set new dates.`));
    const base = num(ing.pack_price) > 0 ? num(ing.pack_price) : 1;
    if (dealPackPrice(base, d) == null) out.push(ingredientIssue(ctx, "deal_bad_price", ing, "A switched-on deal works out to a price of $0 or less, or is missing its numbers, so the app ignores it."));
  }
  return out;
}

/* ------------------------------------------------------------------ line count baseline */

/** (expectedShape) items and preps whose loaded line count is below the baseline. */
export function checkLineBaseline(ctx: Ctx, baseline: Record<string, number>): Issue[] {
  const out: Issue[] = [];
  const check = (key: string, count: number, make: (detail: string) => Issue) => {
    const was = baseline[key];
    if (typeof was === "number" && was > count) out.push(make(`This recipe has ${plural(count, "line")} now and has had ${was} before. ${was - count === 1 ? "A line" : `${was - count} lines`} may have failed to load, or been deleted on purpose. If it was on purpose, use Accept Current Line Counts.`));
  };
  for (const it of ctx.data.items) {
    if (isVirtualItem(it)) continue;
    const k = parentKey("item", it.id);
    check(k, ctx.byParent.get(k)?.length ?? 0, (d) => itemIssue(ctx, "line_count_drop", it, d));
  }
  for (const p of ctx.data.preps) {
    const k = parentKey("prep", p.id);
    check(k, ctx.byParent.get(k)?.length ?? 0, (d) => prepIssue(ctx, "line_count_drop", p, d));
  }
  return out;
}

/** Row counts that are an exact multiple of 1,000 look like a load that stopped at a page limit. */
export function checkLoadCaps(ctx: Ctx): Issue[] {
  const out: Issue[] = [];
  const stored = ctx.data.lines.filter((l) => !isVirtualItemId(l.parent_id)).length;
  const tables: [string, number][] = [["recipe lines", stored], ["ingredients", ctx.data.ingredients.length], ["menu items", ctx.data.items.filter((i) => !isVirtualItem(i)).length], ["preps", ctx.data.preps.length]];
  for (const [label, n] of tables) {
    if (n > 0 && n % 1000 === 0) out.push(makeIssue("load_cap", { kind: "setting", id: `cap:${label}`, name: `${n.toLocaleString("en-AU")} ${label}`, fixHref: "/settings", detail: `Exactly ${n.toLocaleString("en-AU")} ${label} loaded. That is a round page size, so check nothing was cut off. Reload the app to load them again.` }));
  }
  return out;
}

/* ------------------------------------------------------------------ validate */

/** Run every check. Errors first, then warnings, then info; within a severity by check, then name. */
export function validate(data: IntegrityData, opts: ValidateOptions = {}): Issue[] {
  const ctx = buildCtx(data, opts);
  let costs = data.itemCosts;
  if (!costs) {
    const index = buildIndex(data.ingredients, data.preps, data.lines, data.deals, ctx.today);
    costs = new Map();
    const cache = new Map();
    for (const it of data.items) costs.set(it.id, costItem(it, index, ctx.settings, data.targets ?? [], cache));
  }
  const issues: Issue[] = [
    ...checkMissingComponents(ctx),
    ...checkOrphanLines(ctx),
    ...checkDuplicateLines(ctx),
    ...checkEmptyRecipes(ctx),
    ...checkPrepGraph(ctx),
    ...checkUnitMismatch(ctx),
    ...checkIngredients(ctx),
    ...checkPrepYield(ctx),
    ...checkPortions(ctx),
    ...checkSellPrices(ctx),
    ...checkGp(ctx, costs),
    ...checkInactiveInUse(ctx),
    ...checkDuplicateIngredients(ctx),
    ...checkOffers(ctx),
    ...checkSettings(ctx),
    ...checkTargets(ctx),
    ...checkBeers(ctx),
    ...checkDeals(ctx),
    ...checkLoadCaps(ctx),
  ];
  if (opts.lineCountBaseline) issues.push(...checkLineBaseline(ctx, opts.lineCountBaseline));
  return issues.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.code.localeCompare(b.code) || a.name.localeCompare(b.name));
}

export interface HealthSummary {
  errors: number;
  warnings: number;
  info: number;
  /** errors plus warnings: what "needs a look" */
  attention: number;
}

export function summarise(issues: Issue[]): HealthSummary {
  let errors = 0;
  let warnings = 0;
  let info = 0;
  for (const i of issues) {
    if (i.severity === "error") errors++;
    else if (i.severity === "warning") warnings++;
    else info++;
  }
  return { errors, warnings, info, attention: errors + warnings };
}

/** Brisbane time, e.g. "25 Sep 2026, 3:42 pm". */
export function formatBrisbane(d: Date): string {
  const s = new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Brisbane", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true }).format(d);
  return s.replace(/\bam\b/i, "am").replace(/\bpm\b/i, "pm");
}

/** Plain text report for pasting into a message. */
export function reportText(issues: Issue[], checkedAt: Date, venueLabel = "All venues"): string {
  const s = summarise(issues);
  const head = [`Data Health, ${venueLabel}`, `Checked ${formatBrisbane(checkedAt)} (Brisbane time)`, s.attention === 0 ? "All checks passed." : `${plural(s.errors, "error")}, ${plural(s.warnings, "warning")}${s.info ? `, ${plural(s.info, "note")}` : ""}.`];
  const lines: string[] = [head.join("\n")];
  for (const sev of ["error", "warning", "info"] as Severity[]) {
    const list = issues.filter((i) => i.severity === sev);
    if (!list.length) continue;
    lines.push(`\n${sev === "error" ? "ERRORS" : sev === "warning" ? "WARNINGS" : "NOTES"} (${list.length})`);
    for (const i of list) lines.push(`- ${i.title}: ${i.name}${i.venue ? ` [${i.venue}]` : ""}. ${i.detail}`);
  }
  return lines.join("\n");
}

/* ------------------------------------------------------------------ line count baseline storage */

/**
 * LINE COUNT BASELINE. A recipe line that never loads leaves no trace in the data, so we remember the most
 * lines each recipe has ever had on this device (`item:<id>` / `prep:<id>` -> count) in localStorage and flag
 * any recipe that now loads fewer. The hook (lib/use-data-health.ts) raises the baseline after each check
 * (never lowers it, so a bad load cannot hide itself). A recipe that legitimately loses a line would stay
 * flagged, so the store should call `rebaselineParent` when it saves lines or deletes a recipe, and the Data
 * Health page offers "Accept Current Line Counts" for the rest.
 * SERVER SIDE (later): a small table or view `cost_line_counts(parent_type, parent_id, n)` refreshed by trigger,
 * fetched with the data and passed as `lineCountBaseline` gives every device the same baseline.
 */
export const LINE_BASELINE_KEY = "precinct-costing:line-baseline:v1";

export function readLineBaseline(storage?: Pick<Storage, "getItem"> | null): Record<string, number> {
  try {
    const s = storage ?? (typeof localStorage !== "undefined" ? localStorage : null);
    const raw = s?.getItem(LINE_BASELINE_KEY);
    if (!raw) return {};
    const o = JSON.parse(raw) as unknown;
    if (!o || typeof o !== "object") return {};
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) if (typeof v === "number" && Number.isFinite(v) && v >= 0) out[k] = v;
    return out;
  } catch {
    return {};
  }
}

export function writeLineBaseline(b: Record<string, number>, storage?: Pick<Storage, "setItem"> | null): void {
  try {
    const s = storage ?? (typeof localStorage !== "undefined" ? localStorage : null);
    s?.setItem(LINE_BASELINE_KEY, JSON.stringify(b));
  } catch {
    /* storage full or blocked: the check simply has no baseline */
  }
}

/** Line counts per stored parent from the loaded lines (virtual items skipped). */
export function countLinesByParent(lines: RecipeLine[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const l of lines) {
    if (isVirtualItemId(l.parent_id) || isBeerItemId(l.parent_id)) continue;
    const k = parentKey(l.parent_type, l.parent_id);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

/** Baseline raised to the highest counts seen (pure). Only recipes that exist are tracked. */
export function raiseBaseline(baseline: Record<string, number>, counts: Record<string, number>): Record<string, number> {
  const out = { ...baseline };
  for (const [k, n] of Object.entries(counts)) if (n > (out[k] ?? 0)) out[k] = n;
  return out;
}

/** Set one recipe's baseline to a count (call after a deliberate save or delete). count null removes it. */
export function rebaselineParent(parentType: "item" | "prep", parentId: string, count: number | null, storage?: (Pick<Storage, "getItem"> & Pick<Storage, "setItem">) | null): void {
  const b = readLineBaseline(storage);
  const k = parentKey(parentType, parentId);
  if (count == null) delete b[k];
  else b[k] = count;
  writeLineBaseline(b, storage);
}
