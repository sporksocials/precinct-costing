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
  categories: LinkCategory[];
  /** products linked to this ingredient that are on this venue's order list */
  active: LinkedProductView[];
  /** a linked product that was stopped (offered "Order Again") when none is active */
  stopped: LinkedProductView | null;
}

/** One entry per venue that has an ordering list, with what is linked to the ingredient there. */
export function venueLinks(input: { venues: readonly LinkVenue[]; categories: readonly LinkCategory[]; products: readonly LinkProduct[]; terms: readonly LinkTerms[] }): VenueLink[] {
  const catName = new Map(input.categories.map((c) => [c.id, c.name]));
  const termName = new Map(input.terms.map((t) => [t.id, t.name]));
  return orderableVenues(input.venues, input.categories).map((venue) => {
    const mine = input.products
      .filter((p) => p.venue_id === venue.id)
      .map((product) => ({ product, categoryName: catName.get(product.category_id) ?? "", supplierName: product.supplier_id ? (termName.get(product.supplier_id) ?? null) : null }));
    const active = mine.filter((m) => m.product.active).sort((a, b) => a.categoryName.localeCompare(b.categoryName));
    const stopped = active.length ? null : (mine.find((m) => !m.product.active) ?? null);
    return { venue, categories: categoriesOf(input.categories, venue.id), active, stopped };
  });
}

/** "Ordered at Chiobu: Red, per carton, DCG Wines". */
export function orderedAtSentence(venueName: string, v: LinkedProductView): string {
  return `Ordered at ${venueName}: ${[v.categoryName, `per ${v.product.unit_name}`, v.supplierName ?? "no supplier yet"].filter(Boolean).join(", ")}`;
}

export const notOrderedSentence = (venueName: string): string => `Not ordered at ${venueName}`;

export const NO_SUPPLIER_LINE = "Set a supplier first so it lands on the right order.";
export const SUPPLIER_EVERYWHERE_LINE = "This is the supplier on every order list.";

/** The toast after "Order At": names the supplier the database gave the product, or says what is missing. */
export function addedToast(venueName: string, supplierName: string | null): string {
  return supplierName ? `Added to ${venueName}'s order list under ${supplierName}` : `Added to ${venueName}'s order list. Set a supplier on the ingredient to put it on an order.`;
}

export const stoppedToast = (ingredientName: string, venueName: string): string => `${ingredientName} is off ${venueName}'s order list`;
export const orderAgainToast = (ingredientName: string, venueName: string): string => `${ingredientName} is back on ${venueName}'s order list`;

export const productSetupHref = (venueSlug: string, productId: string): string => `/ordering/${venueSlug}/setup/products/${productId}`;

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
