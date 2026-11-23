/**
 * Ordering module: pure helpers for the Setup screens (suppliers, categories, and the read-only Products list). No React, no
 * database. Everything here works on ONE venue's rows. A product is edited on its ingredient (one card per product, Troy,
 * 23 Nov 2026), so nothing here builds or prices a product: prices come from lib/ordering-facts.ts. "Copy Products From
 * Another Venue" was removed that day (it made order items with no ingredient behind them).
 */
import { cleanEmailList, cleanUrl, plainText, supplierMethodFromContact } from "./ordering";
import type { SupplierDraft } from "./ordering-data";
import type { OrderingCategory, OrderingMethod, OrderingProduct, OrderingSupplier } from "./ordering-types";
import { cleanSupplierName, findSupplier } from "./suppliers";

/* ------------------------------------------------------------------ labels and choices */

export const METHOD_LABEL: Record<OrderingMethod, string> = { email: "Email", website: "Website Login", app: "App" };
export const METHOD_OPTIONS: { value: OrderingMethod; label: string }[] = [
  { value: "email", label: METHOD_LABEL.email },
  { value: "website", label: METHOD_LABEL.website },
  { value: "app", label: METHOD_LABEL.app },
];
export const METHOD_HELP: Record<OrderingMethod, string> = {
  email: "An email draft opens with the order in it.",
  website: "The order is listed and copied, and a button opens the supplier's login page.",
  app: "The order is listed and copied. It is placed in the supplier's app.",
};

/** The units a product can be counted and ordered in. "Other" lets a venue type its own word (tray, case...). */
export const UNIT_CHOICES = ["carton", "keg", "bag", "bottle"] as const;
export type UnitChoice = (typeof UNIT_CHOICES)[number] | "other";
export const UNIT_CHOICE_OPTIONS: { value: UnitChoice; label: string }[] = [
  { value: "carton", label: "Carton" },
  { value: "keg", label: "Keg" },
  { value: "bag", label: "Bag" },
  { value: "bottle", label: "Bottle" },
  { value: "other", label: "Other" },
];
export function unitChoice(unit: string | null | undefined): UnitChoice {
  const u = plainText(unit).toLowerCase();
  return (UNIT_CHOICES as readonly string[]).includes(u) ? (u as UnitChoice) : "other";
}
/** "carton" -> "Carton" for a chip or a row sub line; custom words are shown as typed. */
export function unitTitle(unit: string | null | undefined): string {
  const u = plainText(unit);
  return u ? u.charAt(0).toUpperCase() + u.slice(1) : "";
}

export type SecondPlaceChoice = "none" | "Bar" | "Coldroom" | "other";
export const SECOND_PLACE_OPTIONS: { value: SecondPlaceChoice; label: string }[] = [
  { value: "none", label: "Store Only" },
  { value: "Bar", label: "Bar" },
  { value: "Coldroom", label: "Coldroom" },
  { value: "other", label: "Other" },
];
export function secondPlaceChoice(label: string | null | undefined): SecondPlaceChoice {
  const l = plainText(label);
  if (!l) return "none";
  if (l === "Bar" || l === "Coldroom") return l;
  return "other";
}
/** The label a screen shows for where a category is counted: "Store and Bar", "Store only". */
export function placesText(label: string | null | undefined): string {
  const l = plainText(label);
  return l ? `Store and ${l}` : "Store only";
}

/* ------------------------------------------------------------------ typed values */

/** A money amount typed by a person: "$62", "62.5". Null when empty or unreadable (never NaN, never negative). */
export function parseMoney(text: string): number | null {
  const t = plainText(text).replace(/[$,\s]/g, "");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}

/** A whole number of at least `min` (pack multiples). Null when it is not one. */
export function parseWhole(text: string, min = 1): number | null {
  const t = plainText(text);
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return n >= min ? n : null;
}

/** A quantity of zero or more (Build To, minimum units). Decimals are allowed but whole numbers are what people type. */
export function parseQuantity(text: string): number | null {
  const t = plainText(text).replace(/,/g, "");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}

/** Dollars to the cent for an input box: 62 -> "62.00", null -> "". */
export function moneyInput(n: number | null | undefined): string {
  return n == null || !Number.isFinite(Number(n)) ? "" : Number(n).toFixed(2);
}

/* ------------------------------------------------------------------ supplier contact */

/**
 * The method to suggest when a contact value is typed (Troy: an email address means Email, a web address means Login).
 * Returns null when the value says nothing (leave the method alone).
 */
export function suggestMethod(value: string | null | undefined): OrderingMethod | null {
  return supplierMethodFromContact(value);
}

/** Which field a typed contact value belongs in. */
export function contactTarget(value: string | null | undefined): "email_to" | "login_url" | null {
  const m = supplierMethodFromContact(value);
  return m === "email" ? "email_to" : m === "website" ? "login_url" : null;
}

export interface ContactResult {
  patch: Partial<Pick<SupplierDraft, "email_to" | "login_url" | "method">>;
  /** a sentence to show when the method was changed or the value moved to the field it belongs in */
  note: string | null;
  error: string | null;
  /** the typed text belongs in the OTHER field, so the field it was typed in should show its old value again */
  moved: boolean;
}

/**
 * What to save when a person types in the Email Address or Login Link field. Troy's rule: an email address means Email, a web
 * address means Login (website). A value typed in the wrong field moves to the right one. The method follows the value, and
 * the note says so. Empty text clears the field and leaves the method alone.
 */
export function resolveContact(field: "email_to" | "login_url", text: string, currentMethod: OrderingMethod): ContactResult {
  const t = plainText(text);
  if (!t) return { patch: { [field]: null }, note: null, error: null, moved: false };
  const target = contactTarget(t);
  if (!target) {
    return {
      patch: {},
      note: null,
      moved: false,
      error: field === "email_to" ? "That does not look like an email address. Use name@example.com, and separate several with commas." : "That does not look like a web address. Use www.example.com or a full link.",
    };
  }
  const value = target === "email_to" ? cleanEmailList(t) : cleanUrl(t);
  const method: OrderingMethod = target === "email_to" ? "email" : "website";
  const patch: ContactResult["patch"] = { [target]: value };
  if (method !== currentMethod) patch.method = method;
  const what = target === "email_to" ? "an email address" : "a web address";
  const label = METHOD_LABEL[method];
  const moved = target !== field;
  const note = moved
    ? `That is ${what}, so it was saved as the ${target === "email_to" ? "email address" : "login link"}${method !== currentMethod ? ` and orders now go out by ${label}` : ""}.`
    : method !== currentMethod
      ? `Orders now go out by ${label}, because ${what} was entered.`
      : null;
  return { patch, note, error: null, moved };
}

/** A plain warning when the supplier's method has nothing to send to yet. Null when it is fine. Never blocks saving. */
export function supplierGap(s: Pick<OrderingSupplier, "method" | "email_to" | "login_url">): string | null {
  if (s.method === "email" && !s.email_to) return "Add an email address so the order can open as a draft.";
  if (s.method === "website" && !s.login_url) return "Add the login link so the order screen can open it.";
  return null;
}

/** The one line under a supplier row: how orders go out and who the rep is. */
export function supplierSub(s: OrderingSupplier, productCount?: number): string {
  const bits: string[] = [METHOD_LABEL[s.method]];
  if (s.rep_name) bits.push(s.rep_name);
  if (productCount != null) bits.push(`${productCount} product${productCount === 1 ? "" : "s"}`);
  return bits.join(" · ");
}

/* ------------------------------------------------------------------ one supplier list */

/** A supplier in the one list (cost_suppliers). `active` is missing on rows read before the column existed: those count as active. */
export interface MasterSupplier {
  id: number;
  name: string;
  active?: boolean;
}

/** Rows read before the active column existed have no `active`: they count as active. */
export const isActiveMaster = (s: object): boolean => (s as { active?: boolean }).active !== false;

const byName = <T extends { name: string }>(rows: readonly T[]): T[] => [...rows].sort((a, b) => a.name.localeCompare(b.name));

/**
 * The suppliers the Add Supplier sheet offers: active suppliers from the one list that this venue has no terms row for yet
 * (a terms row switched off still counts as "at this venue": turn it back on from the list instead of adding it twice).
 */
export function suppliersNotAtVenue(masters: readonly MasterSupplier[], terms: readonly Pick<OrderingSupplier, "cost_supplier_id">[]): MasterSupplier[] {
  const have = new Set(terms.map((t) => t.cost_supplier_id));
  return byName(masters.filter((m) => isActiveMaster(m) && !have.has(m.id)));
}

export type AddSupplierPlan =
  | { kind: "empty"; message: string }
  /** this venue already has the supplier (maybe switched off) */
  | { kind: "at_venue"; message: string; terms: OrderingSupplier }
  /** the name belongs to a supplier that is switched off in the list */
  | { kind: "inactive"; message: string }
  /** the supplier is in the list but not at this venue yet */
  | { kind: "existing"; master: MasterSupplier }
  /** nobody has this supplier: it is added to the list first */
  | { kind: "new"; name: string };

/**
 * What typing a name in "Add A New Supplier" does. The same duplicate-safe rule as Add New Supplier on an ingredient
 * (lib/suppliers.ts): "Bid Food Pty Ltd" is Bidfood, so a supplier is never added to the list twice.
 */
export function planAddSupplier(typed: string, masters: readonly MasterSupplier[], terms: readonly OrderingSupplier[]): AddSupplierPlan {
  const name = cleanSupplierName(typed);
  if (!name) return { kind: "empty", message: "Type the supplier's name." };
  const match = findSupplier(masters, name);
  if (!match) return { kind: "new", name };
  const here = terms.find((t) => t.cost_supplier_id === match.id);
  if (here) return { kind: "at_venue", terms: here, message: `${match.name} is already one of this venue's suppliers.` };
  if (!isActiveMaster(match)) return { kind: "inactive", message: `${match.name} is switched off on the Suppliers tab of Ingredients. Turn it on there to use it.` };
  return { kind: "existing", master: match };
}

/* ------------------------------------------------------------------ reordering */

/** A new array with the item at `from` moved to `to` (indexes clamp; the input is not changed). */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const out = [...list];
  if (!out.length || from < 0 || from >= out.length) return out;
  const target = Math.max(0, Math.min(out.length - 1, to));
  if (target === from) return out;
  const [item] = out.splice(from, 1);
  out.splice(target, 0, item);
  return out;
}

/**
 * The sort values to write after a reorder: the ordered rows get 1..n, and only rows whose sort actually changes are
 * returned (so a move of one row near the end writes a few rows, not the whole list).
 */
export function sortChanges(ordered: readonly { id: string; sort: number }[]): { id: string; sort: number }[] {
  const out: { id: string; sort: number }[] = [];
  ordered.forEach((r, i) => {
    if (r.sort !== i + 1) out.push({ id: r.id, sort: i + 1 });
  });
  return out;
}

/** Applies sort changes to a list of rows in memory (what the screen shows straight after a reorder). */
export function applySort<T extends { id: string; sort: number }>(rows: readonly T[], changes: readonly { id: string; sort: number }[]): T[] {
  const by = new Map(changes.map((c) => [c.id, c.sort]));
  return rows.map((r) => (by.has(r.id) ? { ...r, sort: by.get(r.id) as number } : r));
}

/** Rows in shelf order: sort, then name. */
export function bySortThenName<T extends { sort: number; name: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
}

/* ------------------------------------------------------------------ the Products list */

export interface ProductGroup {
  category: OrderingCategory;
  products: OrderingProduct[];
}

const norm = (s: string | null | undefined): string => plainText(s).toLowerCase();

/**
 * The Products list: grouped by category in count order. `categoryId` "" means every category. Search matches the name, the
 * supplier, the supplier item code and the category. Inactive products appear only with showInactive. Empty groups are left out.
 */
export function productGroups(input: {
  products: readonly OrderingProduct[];
  categories: readonly OrderingCategory[];
  suppliers: readonly OrderingSupplier[];
  categoryId: string;
  query: string;
  showInactive: boolean;
}): ProductGroup[] {
  const { products, categories, suppliers, categoryId, query, showInactive } = input;
  const supplierName = new Map(suppliers.map((s) => [s.id, norm(s.name)]));
  const words = norm(query).split(" ").filter(Boolean);
  return bySortThenName(categories)
    .filter((c) => !categoryId || c.id === categoryId)
    .map((category) => {
      const rows = products.filter((p) => p.category_id === category.id && (showInactive || p.active));
      const matched = words.length
        ? rows.filter((p) => {
            const hay = `${norm(p.name)} ${norm(p.supplier_item_code)} ${supplierName.get(p.supplier_id ?? "") ?? ""} ${norm(category.name)}`;
            return words.every((w) => hay.includes(w));
          })
        : rows;
      return { category, products: bySortThenName(matched) };
    })
    .filter((g) => g.products.length > 0);
}

/** How many products the venue has switched off (for "Show Inactive (n)"). */
export function inactiveProductCount(products: readonly OrderingProduct[]): number {
  return products.filter((p) => !p.active).length;
}

/**
 * The sub line of a product row: Counted By, supplier, price. "Carton · Star · $62.00". The price is the one worked out
 * from the ingredient (lib/ordering-facts.ts `orderPriceShort`), passed in already formatted; "" leaves it out.
 */
export function productSub(p: Pick<OrderingProduct, "unit_name" | "supplier_id">, supplierNameById: ReadonlyMap<string, string>, price = ""): string {
  const bits = [unitTitle(p.unit_name)];
  const s = p.supplier_id ? supplierNameById.get(p.supplier_id) : null;
  bits.push(s ?? "No supplier");
  if (price) bits.push(price);
  return bits.filter(Boolean).join(" · ");
}

/** True when another row in `rows` already uses `name` (case-insensitive). `exceptId` skips the row being edited. */
export function nameTaken(name: string, rows: readonly { id: string; name: string }[], exceptId?: string): boolean {
  const n = norm(name);
  return !!n && rows.some((r) => r.id !== exceptId && norm(r.name) === n);
}
