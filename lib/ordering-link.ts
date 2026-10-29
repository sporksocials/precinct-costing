/**
 * Ingredients and Ordering are one system (Troy, 29 Oct 2026: "this system should all be interconnected in every way").
 * An ordering product that points at an ingredient takes its supplier from that ingredient, so the ingredient page is where a
 * product is put on a venue's order list, taken off it, and where its supplier is chosen. This file holds:
 *   - the pure rules and wording (which venues, the product name, the sentences) with tests in tests/ordering-link.test.ts, and
 *   - the few data helpers the ingredient screens need, over the same Supabase client the rest of the app uses.
 * Every insert goes through lib/ordering-data.ts `createProduct`, which uses insertRow (strips null keys). Nothing here
 * edits the Ordering screens' own data layer.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { baseName } from "./rename-linked";
import { tidyName } from "./name-tidy";
import { createProduct, T, updateProduct } from "./ordering-data";
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
}
export interface LinkTerms {
  id: string;
  venue_id: number;
  name: string;
  cost_supplier_id: number | null;
}

/* ------------------------------------------------------------------ pure rules */

/** The ordering product's name for an ingredient: its name without the trailing size in brackets ("Red (750ml)" gives "Red"), tidied like every other name. */
export function orderingProductName(ingredientName: string): string {
  return tidyName(baseName(ingredientName));
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

/** The unit chips for the sheet: the category's own unit (when it has one) leads, then the ingredient's best guesses, no repeats. */
export function unitChips(ing: Parameters<typeof unitSuggestions>[0], categoryUnit?: string | null): string[] {
  const out: string[] = [];
  for (const u of [categoryUnit?.trim().toLowerCase(), ...unitSuggestions(ing)]) if (u && !out.includes(u)) out.push(u);
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

/** The ordering_products row an "Order At" creates. Nulls are left for the database defaults (insertRow strips them). */
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

/** "Bar Mixers, per carton, DCG Wines": where it sits on the order list. The supplier is always the ingredient's, never a separate choice. */
export function orderedDetail(v: LinkedProductView): string {
  return [v.categoryName, `per ${v.product.unit_name}`, v.supplierName ?? "no supplier yet"].filter(Boolean).join(", ");
}

/** "Chiobu: Bar Mixers, per carton, DCG Wines". */
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

export const productSetupHref = (venueSlug: string, productId: string): string => `/ordering/${venueSlug}/setup/products/${productId}`;

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
    sb.from(T.products).select("id,venue_id,category_id,name,unit_name,supplier_id,ingredient_id,par,active").eq("ingredient_id", ingredientId),
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
  const again = await sb.from(T.products).select("id,venue_id,category_id,name,unit_name,supplier_id,ingredient_id,par,active").eq("id", saved.id).maybeSingle();
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

/** The "Change" sheet: an ordered product's category, order unit and Build To. The database records the change in the change history. */
export async function changeOrderingProduct(sb: SupabaseClient, productId: string, patch: { category_id: string; unit_name: string; par: number }): Promise<void> {
  await updateProduct(sb, productId, patch);
}
