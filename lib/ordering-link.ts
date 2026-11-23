/**
 * Ingredients and Ordering are one system (Troy, 29 Oct 2026: "this system should all be interconnected in every way"), and
 * since 23 Nov 2026 ONE CARD PER PRODUCT: an order item is a thin per-venue shell over its ingredient. The ingredient page is
 * the ONLY editor: it is where a product is put on a venue's order list and taken off it, where its shelf group, Counted By and
 * Build To are set, and where everything about the product itself lives (name, supplier, item code, price, how many a carton
 * holds). The database copies the name, supplier and item code onto the order item; the price is worked out at read
 * (lib/ordering-facts.ts). This file holds:
 *   - the pure rules and wording (which venues, the product name, the sentences) with tests in tests/ordering-link.test.ts, and
 *   - the few data helpers the ingredient screens need, over the same Supabase client the rest of the app uses.
 * Every insert goes through lib/ordering-data.ts `createProduct`, which uses insertRow (strips null keys). Nothing here
 * edits the Ordering screens' own data layer.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { unitWord } from "./ordering";
import { createProduct, T, updateProduct } from "./ordering-data";
import { isCartonUnit } from "./ordering-facts";
import { looksLikeKeg } from "./ingredient-categories";
import type { PackUnit } from "./types";

/* ------------------------------------------------------------------ shapes (the columns this feature reads) */

export interface LinkVenue {
  id: number;
  slug: string;
  name: string;
  sort?: number;
}
export interface LinkCategory {
  id: string;
  venue_id: number;
  name: string;
  unit_name: string;
  sort: number;
}
export interface LinkProduct {
  id: string;
  venue_id: number;
  category_id: string;
  name: string;
  unit_name: string;
  supplier_id: string | null;
  ingredient_id: string | null;
  par: number;
  active: boolean;
  /** orders round up to a multiple of this; absent on rows read before it was selected (reads as 1) */
  pack_multiple?: number | null;
  notes?: string | null;
  supplier_item_code?: string | null;
  /** the stored price: read only as the fallback for an item with no ingredient */
  price_inc_gst?: number | null;
}
/** The columns the ingredient screens read from an order item. */
const LINK_PRODUCT_COLUMNS = "id,venue_id,category_id,name,unit_name,supplier_id,ingredient_id,par,active,pack_multiple,notes,supplier_item_code,price_inc_gst";
export interface LinkTerms {
  id: string;
  venue_id: number;
  name: string;
  cost_supplier_id: number | null;
}

/* ------------------------------------------------------------------ pure rules */

/**
 * The order item's name for an ingredient: the ingredient's FULL name, size in brackets included ("Red (750ml)" stays
 * "Red (750ml)"). The database forces this on every order item that has an ingredient, so this is only what an insert sends.
 */
export function orderingProductName(ingredientName: string): string {
  return ingredientName.trim();
}

/** The venues that have an ordering list at all (at least one category), in venue order. A venue with none cannot be ordered from yet. */
export function orderableVenues<V extends LinkVenue>(venues: readonly V[], categories: readonly Pick<LinkCategory, "venue_id">[]): V[] {
  const has = new Set(categories.map((c) => c.venue_id));
  return venues.filter((v) => has.has(v.id)).sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || a.name.localeCompare(b.name));
}

export function categoriesOf<C extends Pick<LinkCategory, "venue_id" | "sort" | "name">>(categories: readonly C[], venueId: number): C[] {
  return categories.filter((c) => c.venue_id === venueId).sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
}

/** Order unit suggestions for an ingredient, best guess first. The category's own unit is added by the caller. */
export function unitSuggestions(ing: { name: string; pack_unit?: PackUnit | string | null; category?: string | null }): string[] {
  const text = `${ing.name} ${ing.category ?? ""}`.toLowerCase();
  const first = /\bkeg\b/.test(text) ? "keg" : ing.pack_unit === "each" ? "bottle" : ing.pack_unit === "kg" ? "bag" : ing.pack_unit === "L" ? "bottle" : "carton";
  return [first, ...["carton", "bottle", "keg", "bag"].filter((u) => u !== first)];
}

/**
 * The Counted By chips: the category's own unit (when it has one) leads, then the units that venue already counts by (most
 * used first), then the ingredient's best guesses, no repeats.
 */
export function unitChips(ing: Parameters<typeof unitSuggestions>[0], categoryUnit?: string | null, venueUnits: readonly string[] = []): string[] {
  const used = new Map<string, number>();
  for (const raw of venueUnits) {
    const u = raw.trim().toLowerCase();
    if (u) used.set(u, (used.get(u) ?? 0) + 1);
  }
  const byUse = [...used.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([u]) => u);
  const out: string[] = [];
  for (const u of [categoryUnit?.trim().toLowerCase(), ...byUse, ...unitSuggestions(ing)]) if (u && !out.includes(u)) out.push(u);
  return out;
}

/** A Build To typed by a person: a whole or half number of zero or more, else null. Blank means 0. */
export function parsePar(text: string): number | null {
  const t = text.trim();
  if (t === "") return 0;
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/**
 * The ordering_products row an "Order At" creates: the per-venue things only (shelf group, Counted By, Build To). No price,
 * item code or deal is ever sent: the database copies the name, supplier and item code from the ingredient and the price is
 * worked out at read. Nulls are left for the database defaults (insertRow strips them).
 */
export function linkedProductDraft(input: { ingredientId: string; ingredientName: string; categoryId: string; unit: string; par: number }) {
  return {
    category_id: input.categoryId,
    sort: 0,
    name: orderingProductName(input.ingredientName),
    unit_name: input.unit.trim() || "carton",
    supplier_id: null,
    supplier_item_code: null,
    pack_multiple: 1,
    price_inc_gst: null,
    deal_buy_qty: null,
    deal_free_qty: null,
    ingredient_id: input.ingredientId,
    costing_packs_per_unit: null,
    par: input.par,
    notes: null,
    active: true,
  };
}

export interface LinkedProductView {
  product: LinkProduct;
  categoryName: string;
  /** the terms row's name, which the database keeps equal to the supplier's name; null when the ingredient has no supplier */
  supplierName: string | null;
}

export interface VenueLink {
  venue: LinkVenue;
  /** false for a venue with no ordering categories yet: its row is shown switched off with one line saying so */
  hasList: boolean;
  categories: LinkCategory[];
  /** products linked to this ingredient that are on this venue's order list */
  active: LinkedProductView[];
  /** a linked product that was stopped (turning the venue on again re-activates it) when none is active */
  stopped: LinkedProductView | null;
}

/** Venues that never get an Ordering row (Gelato Rumba sells gelato; it does not order stock this way). */
export const NO_ORDERING_VENUES: readonly string[] = ["gelato"];

/** One entry per venue that can have an order list (Gelato is left out), with what is linked to the ingredient there. */
export function venueLinks(input: { venues: readonly LinkVenue[]; categories: readonly LinkCategory[]; products: readonly LinkProduct[]; terms: readonly LinkTerms[] }): VenueLink[] {
  const catName = new Map(input.categories.map((c) => [c.id, c.name]));
  const termName = new Map(input.terms.map((t) => [t.id, t.name]));
  return input.venues
    .filter((v) => !NO_ORDERING_VENUES.includes(v.slug))
    .slice()
    .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || a.name.localeCompare(b.name))
    .map((venue) => {
      const mine = input.products
        .filter((p) => p.venue_id === venue.id)
        .map((product) => ({ product, categoryName: catName.get(product.category_id) ?? "", supplierName: product.supplier_id ? (termName.get(product.supplier_id) ?? null) : null }));
      const active = mine.filter((m) => m.product.active).sort((a, b) => a.categoryName.localeCompare(b.categoryName));
      const stopped = active.length ? null : (mine.find((m) => !m.product.active) ?? null);
      const categories = categoriesOf(input.categories, venue.id);
      return { venue, hasList: categories.length > 0, categories, active, stopped };
    });
}

/** "Bar Mixers, counted by the carton, DCG Wines": where it sits on the order list. The supplier is always the ingredient's, never a separate choice. */
export function orderedDetail(v: LinkedProductView): string {
  return [v.categoryName, `counted by the ${v.product.unit_name}`, v.supplierName ?? "no supplier yet"].filter(Boolean).join(", ");
}

/** "Chiobu: Bar Mixers, counted by the carton, DCG Wines". */
export function orderedAtSentence(venueName: string, v: LinkedProductView): string {
  return `${venueName}: ${orderedDetail(v)}`;
}

export const notOrderedSentence = (venueName: string): string => `Not ordered at ${venueName}`;

/** The one line on a venue row that cannot be switched on yet. */
export const noListSentence = (venueName: string): string => `${venueName} has no order list set up yet`;

export const NO_SUPPLIER_LINE = "Set a supplier first so it lands on the right order.";
export const SUPPLIER_EVERYWHERE_LINE = "This is the supplier on every order list.";

/** The toast after "Order At": names the supplier the database gave the product, or says what is missing. */
export function addedToast(venueName: string, supplierName: string | null): string {
  return supplierName ? `Added to ${venueName}'s order list under ${supplierName}` : `Added to ${venueName}'s order list. Set a supplier on the ingredient to put it on an order.`;
}

export const stoppedToast = (ingredientName: string, venueName: string): string => `${ingredientName} is off ${venueName}'s order list`;
export const orderAgainToast = (ingredientName: string, venueName: string): string => `${ingredientName} is back on ${venueName}'s order list`;

/** The counts and orders of one order item (the per-product History page). */
export const productHistoryHref = (venueSlug: string, productId: string): string => `/ordering/${venueSlug}/history/products/${productId}`;

/* ------------------------------------------------------------------ a carton, and changing Counted By */

/**
 * The word for ONE of the ingredient's packs, for "A Carton Holds 6 bottles": what a venue counts it by when that is not the
 * carton (bottle, keg, bag, tub), else a guess from the ingredient, else "pack".
 */
export function packWord(ing: DefaultsIngredient, countedBy: readonly string[] = []): string {
  const other = countedBy.map((u) => u.trim().toLowerCase()).find((u) => u && !isCartonUnit(u) && u !== "each");
  if (other) return other;
  if (ing.pack_unit === "each" && (Number(ing.pack_size) || 0) > 1) return "pack";
  const guess = fallbackUnit(ing);
  return guess === "carton" ? "pack" : guess;
}

/** A carton size typed by a person: a number above zero, or null for an empty box. `undefined` means it is not a usable number. */
export function parseCartonQty(text: string): number | null | undefined {
  const t = text.trim();
  if (t === "") return null;
  if (!/^\d+(\.\d+)?$/.test(t)) return undefined;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** A pack multiple typed by a person: a whole number of 1 or more, else null. Blank means 1. */
export function parseMultiple(text: string): number | null {
  const t = text.trim();
  if (t === "") return 1;
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return n >= 1 ? n : null;
}

const numText = (n: number): string => String(Math.round(n * 100) / 100);

export interface CountedByPlan {
  /** nothing changes: the same unit was picked */
  same: boolean;
  /** the Build To to start the box at in the new unit; null when it cannot be worked out, so the person types it */
  suggestedPar: number | null;
  /** "Build To 30 bottles is about 5 cartons." or "Build To is 30 bottles now. Type the new Build To in kegs." */
  parSentence: string;
  /** when orders go in multiples today: what happens to that ("Orders went in 6s. They will go one carton at a time...") */
  multipleSentence: string | null;
}

/**
 * What changing Counted By means, in words, BEFORE it is saved. Build To, the pack multiple and the price are all in the
 * counted unit, so a new unit changes the meaning of every one of them (a Build To of 30 bottles left as "30 cartons" is a
 * six times order). The new Build To is worked out only between the carton and the ingredient's own pack, and only when the
 * ingredient says how many a carton holds; in every other case the person types it.
 */
export function countedByPlan(input: { fromUnit: string; toUnit: string; par: number; packMultiple?: number | null; cartonQty?: number | null }): CountedByPlan {
  const from = input.fromUnit.trim().toLowerCase();
  const to = input.toUnit.trim().toLowerCase();
  const par = Math.max(0, Number(input.par) || 0);
  const qty = Number(input.cartonQty);
  const knows = Number.isFinite(qty) && qty > 0;
  const multiple = Math.max(1, Math.floor(Number(input.packMultiple) || 1));
  const now = `${numText(par)} ${unitWord(from, par)}`;
  if (!to || to === from) return { same: true, suggestedPar: par, parSentence: `Build To is ${now}.`, multipleSentence: null };

  let suggestedPar: number | null = null;
  let parSentence = `Build To is ${now} now. Type the new Build To in ${unitWord(to, 2)}.`;
  if (par === 0) {
    suggestedPar = 0;
    parSentence = `Build To is 0 now. Type the new Build To in ${unitWord(to, 2)}.`;
  } else if (knows && isCartonUnit(to) && !isCartonUnit(from)) {
    suggestedPar = Math.max(1, Math.round(par / qty));
    parSentence = `Build To ${now} is about ${numText(suggestedPar)} ${unitWord(to, suggestedPar)} (a carton holds ${numText(qty)}).`;
  } else if (knows && isCartonUnit(from) && !isCartonUnit(to)) {
    suggestedPar = Math.round(par * qty * 100) / 100;
    parSentence = `Build To ${now} is ${numText(suggestedPar)} ${unitWord(to, suggestedPar)} (a carton holds ${numText(qty)}).`;
  }
  const multipleSentence = multiple > 1 ? `Orders go in multiples of ${multiple} ${unitWord(from, multiple)} today. That goes back to one ${unitWord(to, 1)} at a time unless you keep it.` : null;
  return { same: false, suggestedPar, parSentence, multipleSentence };
}

/* ------------------------------------------------------------------ smart defaults (one tap per venue, Troy 29 Oct 2026) */

/** Words in a category name that say nothing about WHAT it is, so they never decide a match ("Bar Mixers" must not match "Bar consumable"). */
const WEAK_WORDS = new Set(["bar", "food", "other", "supplies", "supply", "non", "alc", "and", "the", "packaged", "consumable", "beverage", "kitchen"]);

/** The meaningful lower-case words of a category name, plural trimmed ("Liqueurs" gives "liqueur"). */
function categoryWords(name: string): string[] {
  return (name.toLowerCase().match(/[a-z]+/g) ?? []).filter((w) => w.length >= 3 && !WEAK_WORDS.has(w)).map((w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w));
}

const nameKeyOf = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

interface DefaultsIngredient {
  name: string;
  category?: string | null;
  pack_unit?: PackUnit | string | null;
  pack_size?: number | null;
}

const isKeg = (ing: DefaultsIngredient): boolean => looksLikeKeg(ing.name) || /keg/i.test(ing.category ?? "");

/**
 * The venue category whose NAME says what this ingredient is: the same name as the ingredient's category, or sharing a meaningful
 * word with it (or "keg" for a keg). The best score wins; two with the same best score is not an answer. Null when there is no
 * single clear match.
 */
function categoryByName<C extends LinkCategory>(ing: DefaultsIngredient, categories: readonly C[]): C | null {
  const words = new Set(categoryWords(ing.category ?? ""));
  if (isKeg(ing)) words.add("keg");
  const ingKey = nameKeyOf(ing.category ?? "");
  const scored = categories
    .map((c) => ({ c, score: (ingKey && nameKeyOf(c.name) === ingKey ? 10 : 0) + categoryWords(c.name).filter((w) => words.has(w)).length }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  if (!scored.length) return null;
  if (scored.length > 1 && scored[1].score === scored[0].score) return null;
  return scored[0].c;
}

/** "keg" for a keg, "bottle" for a bottle size, else "carton". */
export function fallbackUnit(ing: DefaultsIngredient): string {
  if (isKeg(ing)) return "keg";
  const size = Number(ing.pack_size) || 0;
  if ((ing.pack_unit === "L" && size > 0 && size <= 3) || /\b\d+(\.\d+)?\s*(ml|cl)\b/i.test(ing.name)) return "bottle";
  return "carton";
}

export interface OrderDefaults {
  /** the category to use, or null when there is no confident answer (the person picks; it is never guessed) */
  categoryId: string | null;
  unit: string;
  confident: boolean;
  /** how the category was found */
  basis: "same-ingredient-category" | "category-name" | "none";
}

/**
 * What turning a venue on uses without asking. CATEGORY: the ordering category used most at THAT venue by other products whose
 * linked ingredient has the same ingredient category (Spirits, Liqueurs, Wine...). A tie goes to the tied category whose name fits.
 * With no such products, a category whose name matches the ingredient's category or pack (keg, wine). If there is still no single
 * confident answer the category stays empty and the screen asks. UNIT: the most used unit in that category at that venue, else keg
 * for a keg, bottle for a bottle size, else carton. Build To is 0 and pack multiple 1 (see linkedProductDraft).
 */
export function orderDefaults(input: {
  ingredient: DefaultsIngredient;
  /** this venue's categories only */
  categories: readonly LinkCategory[];
  /** this venue's products, any of them (units are counted over a whole category) */
  products: readonly { category_id: string; unit_name: string; ingredient_id: string | null }[];
  /** the ingredient category of a linked ingredient id */
  ingredientCategoryOf: (ingredientId: string) => string | null | undefined;
}): OrderDefaults {
  const { ingredient: ing, categories, products } = input;
  const own = new Set(categories.map((c) => c.id));
  const want = (ing.category ?? "").trim().toLowerCase();

  let category: LinkCategory | null = null;
  let basis: OrderDefaults["basis"] = "none";

  if (want) {
    const counts = new Map<string, number>();
    for (const p of products) {
      if (!p.ingredient_id || !own.has(p.category_id)) continue;
      if ((input.ingredientCategoryOf(p.ingredient_id) ?? "").trim().toLowerCase() !== want) continue;
      counts.set(p.category_id, (counts.get(p.category_id) ?? 0) + 1);
    }
    const top = Math.max(0, ...counts.values());
    const tied = [...counts.entries()].filter(([, n]) => top > 0 && n === top).map(([id]) => id);
    if (tied.length === 1) {
      category = categories.find((c) => c.id === tied[0]) ?? null;
    } else if (tied.length > 1) {
      category = categoryByName(ing, categories.filter((c) => tied.includes(c.id)));
    }
    if (category) basis = "same-ingredient-category";
  }
  if (!category) {
    category = categoryByName(ing, categories);
    if (category) basis = "category-name";
  }
  if (!category) return { categoryId: null, unit: fallbackUnit(ing), confident: false, basis: "none" };

  return { categoryId: category.id, unit: unitForCategory(ing, category, products), confident: true, basis };
}

/** The order unit for a category: the most used unit among its products at that venue (a tie goes to the category's own unit), else keg, bottle or carton. */
export function unitForCategory(ing: DefaultsIngredient, category: Pick<LinkCategory, "id" | "unit_name">, products: readonly { category_id: string; unit_name: string }[]): string {
  const used = new Map<string, number>();
  for (const p of products) {
    const u = p.unit_name.trim().toLowerCase();
    if (p.category_id === category.id && u) used.set(u, (used.get(u) ?? 0) + 1);
  }
  const best = Math.max(0, ...used.values());
  const leaders = [...used.entries()].filter(([, n]) => best > 0 && n === best).map(([u]) => u).sort();
  const own = category.unit_name.trim().toLowerCase();
  return leaders.length ? (leaders.includes(own) ? own : leaders[0]) : fallbackUnit(ing);
}

/** The pick a venue turns on with: the defaults, with anything the person chose by hand laid over them. */
export function resolvePick(defaults: OrderDefaults, manual?: { categoryId?: string; unit?: string } | null): { categoryId: string | null; unit: string } {
  return { categoryId: manual?.categoryId ?? defaults.categoryId, unit: (manual?.unit ?? "").trim() || defaults.unit };
}

/** What the New Ingredient sheet asks for per ticked venue. A venue is only created at when it has a category. */
export interface OrderAtPick {
  venueId: number;
  categoryId: string;
  unit: string;
}

/** Picks that can be created: a venue chosen with a category and a unit. Anything unfinished is reported so the form can say so. */
export function readyPicks(picks: readonly Partial<OrderAtPick>[]): { ready: OrderAtPick[]; unfinished: number } {
  const ready: OrderAtPick[] = [];
  let unfinished = 0;
  for (const p of picks) {
    if (p.venueId != null && p.categoryId && p.unit?.trim()) ready.push({ venueId: p.venueId, categoryId: p.categoryId, unit: p.unit.trim() });
    else unfinished++;
  }
  return { ready, unfinished };
}

/* ------------------------------------------------------------------ data (the signed-in client; nothing here is called by tests) */

/** Every venue's ordering categories. */
export async function loadOrderingCategories(sb: SupabaseClient): Promise<LinkCategory[]> {
  const { data, error } = await sb.from(T.categories).select("id,venue_id,name,unit_name,sort");
  if (error) throw new Error(error.message);
  return (data ?? []) as LinkCategory[];
}

/** The ordering products that point at one ingredient, at every venue, and the terms rows they are with. */
export async function loadIngredientOrdering(sb: SupabaseClient, ingredientId: string): Promise<{ categories: LinkCategory[]; products: LinkProduct[]; terms: LinkTerms[] }> {
  const [categories, prods] = await Promise.all([
    loadOrderingCategories(sb),
    sb.from(T.products).select(LINK_PRODUCT_COLUMNS).eq("ingredient_id", ingredientId),
  ]);
  if (prods.error) throw new Error(prods.error.message);
  const products = (prods.data ?? []) as LinkProduct[];
  const termIds = [...new Set(products.map((p) => p.supplier_id).filter((x): x is string => !!x))];
  let terms: LinkTerms[] = [];
  if (termIds.length) {
    const t = await sb.from(T.suppliers).select("id,venue_id,name,cost_supplier_id").in("id", termIds);
    if (t.error) throw new Error(t.error.message);
    terms = (t.data ?? []) as LinkTerms[];
  }
  return { categories, products, terms };
}

/**
 * Puts an ingredient on a venue's order list: creates the linked ordering product (the database gives it the supplier the ingredient
 * has). Returns the saved product and the supplier name it landed under (read back, because a trigger sets it).
 * A name already used in that category is refused in plain words by `createProduct`.
 */
export async function addOrderingProduct(
  sb: SupabaseClient,
  input: { venueId: number; ingredientId: string; ingredientName: string; categoryId: string; unit: string; par: number },
): Promise<{ product: LinkProduct; supplierName: string | null }> {
  const saved = await createProduct(sb, input.venueId, linkedProductDraft(input));
  let product = saved as unknown as LinkProduct;
  // the supplier is set by a trigger on insert; read the row again so the toast names what really happened
  const again = await sb.from(T.products).select(LINK_PRODUCT_COLUMNS).eq("id", saved.id).maybeSingle();
  if (!again.error && again.data) product = again.data as LinkProduct;
  let supplierName: string | null = null;
  if (product.supplier_id) {
    const t = await sb.from(T.suppliers).select("name").eq("id", product.supplier_id).maybeSingle();
    supplierName = (t.data as { name?: string } | null)?.name ?? null;
  }
  return { product, supplierName };
}

/** Stop Ordering and Order Again: the product's Active flag. The product, its history and its Build To all stay. */
export async function setOrderingProductActive(sb: SupabaseClient, productId: string, active: boolean): Promise<void> {
  await updateProduct(sb, productId, { active });
}

/** Every supplier's terms rows (which venue each supplier is ordered at), for the Suppliers tab. */
export async function loadSupplierTerms(sb: SupabaseClient): Promise<{ cost_supplier_id: number; venue_id: number; active: boolean }[]> {
  const { data, error } = await sb.from(T.suppliers).select("cost_supplier_id,venue_id,active");
  if (error) throw new Error(error.message);
  return ((data ?? []) as { cost_supplier_id: number | null; venue_id: number; active: boolean }[]).filter((r): r is { cost_supplier_id: number; venue_id: number; active: boolean } => r.cost_supplier_id != null);
}

/** invoice_suppliers.cost_supplier_id for every invoice supplier that is linked, for the quiet "Invoices linked" tag. */
export async function loadInvoiceSupplierLinks(sb: SupabaseClient): Promise<number[]> {
  const { data, error } = await sb.from("invoice_suppliers").select("cost_supplier_id");
  if (error) throw new Error(error.message);
  return ((data ?? []) as { cost_supplier_id: number | null }[]).map((r) => r.cost_supplier_id).filter((x): x is number => x != null);
}

/** Every product at one venue (category, unit, linked ingredient): what the smart defaults count. */
export async function loadVenueProductsForDefaults(sb: SupabaseClient, venueId: number): Promise<{ category_id: string; unit_name: string; ingredient_id: string | null }[]> {
  const { data, error } = await sb.from(T.products).select("category_id,unit_name,ingredient_id").eq("venue_id", venueId);
  if (error) throw new Error(error.message);
  return (data ?? []) as { category_id: string; unit_name: string; ingredient_id: string | null }[];
}

/** The same for every venue at once (the New Ingredient sheet), with the venue id kept. */
export async function loadAllProductsForDefaults(sb: SupabaseClient): Promise<{ venue_id: number; category_id: string; unit_name: string; ingredient_id: string | null }[]> {
  const { data, error } = await sb.from(T.products).select("venue_id,category_id,unit_name,ingredient_id");
  if (error) throw new Error(error.message);
  return (data ?? []) as { venue_id: number; category_id: string; unit_name: string; ingredient_id: string | null }[];
}

/**
 * The per-venue things a person edits on an order item: its shelf group, Counted By, Build To, pack multiple and note. Nothing
 * else is ever written from the ingredient page (the name, supplier and item code are the database's copies of the ingredient's).
 * Counted By is only ever sent together with a new Build To and pack multiple (see `countedByPlan`). The database records
 * each change in the change history.
 */
export type OrderItemPatch = Partial<{ category_id: string; par: number; pack_multiple: number; notes: string | null }> | { unit_name: string; par: number; pack_multiple: number };

export async function changeOrderingProduct(sb: SupabaseClient, productId: string, patch: OrderItemPatch): Promise<void> {
  await updateProduct(sb, productId, patch);
}

/** The units one venue already counts by (one entry per product), for the Counted By chips. */
export async function loadVenueUnits(sb: SupabaseClient, venueId: number): Promise<string[]> {
  const { data, error } = await sb.from(T.products).select("unit_name").eq("venue_id", venueId).eq("active", true);
  if (error) throw new Error(error.message);
  return ((data ?? []) as { unit_name: string | null }[]).map((r) => r.unit_name ?? "").filter(Boolean);
}
