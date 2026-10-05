/**
 * Ordering module: pure helpers for the Setup screens (suppliers, categories, products) and "Copy Products From Another
 * Venue". No React, no database. Everything here works on ONE venue's rows; the copy plan reads one venue and prepares rows
 * for another, and never carries counts, prices, Build To levels or account numbers across (each venue is independent).
 */
import { cleanEmailList, cleanUrl, exGst, plainText, qtyText, supplierMethodFromContact } from "./ordering";
import type { CategoryDraft, ProductDraft, SupplierDraft } from "./ordering-data";
import type { OrderingCategory, OrderingMethod, OrderingProduct, OrderingSupplier } from "./ordering-types";

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

/* ------------------------------------------------------------------ product pricing */

export interface ProductPricing {
  /** the order unit's price ex GST (inc / 1.1) */
  ex: number | null;
  /** price of one costing pack when a pack count is set (carton price / 24), inc and ex GST */
  perPackInc: number | null;
  perPackEx: number | null;
}

/** The ex GST price beside the inc GST one, and the price of one costing pack when the product is linked with a pack count. */
export function productPricing(priceInc: number | null | undefined, packsPerUnit: number | null | undefined): ProductPricing {
  const inc = priceInc == null || !Number.isFinite(Number(priceInc)) ? null : Number(priceInc);
  const packs = packsPerUnit != null && Number(packsPerUnit) > 0 ? Number(packsPerUnit) : null;
  const perInc = inc != null && packs ? Math.round((inc / packs) * 100) / 100 : null;
  return { ex: inc != null ? exGst(inc) : null, perPackInc: perInc, perPackEx: perInc != null ? exGst(perInc) : null };
}

/** "24 cans at $2.58 each" style sentence for the Packs Per Unit field, or null until both numbers exist. */
export function packsSentence(unit: string, priceInc: number | null | undefined, packs: number | null | undefined, packName = "pack"): string | null {
  const p = productPricing(priceInc, packs);
  if (p.perPackInc == null || !packs) return null;
  const u = plainText(unit) || "unit";
  return `One ${u} holds ${qtyText(packs)} ${packName}${packs === 1 ? "" : "s"}, so each ${packName} costs $${p.perPackInc.toFixed(2)} inc GST ($${(p.perPackEx ?? 0).toFixed(2)} ex GST).`;
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

/** The sub line of a product row: unit, supplier, price. "Carton · Star · $62.00". */
export function productSub(p: OrderingProduct, supplierNameById: ReadonlyMap<string, string>): string {
  const bits = [unitTitle(p.unit_name)];
  const s = p.supplier_id ? supplierNameById.get(p.supplier_id) : null;
  bits.push(s ?? "No supplier");
  if (p.price_inc_gst != null) bits.push(`$${Number(p.price_inc_gst).toFixed(2)}`);
  return bits.filter(Boolean).join(" · ");
}

/** True when another row in `rows` already uses `name` (case-insensitive). `exceptId` skips the row being edited. */
export function nameTaken(name: string, rows: readonly { id: string; name: string }[], exceptId?: string): boolean {
  const n = norm(name);
  return !!n && rows.some((r) => r.id !== exceptId && norm(r.name) === n);
}

/* ------------------------------------------------------------------ Copy Products From Another Venue */

export interface CopySource {
  suppliers: readonly OrderingSupplier[];
  categories: readonly OrderingCategory[];
  products: readonly OrderingProduct[];
}

export interface CopyPlan {
  suppliers: SupplierDraft[];
  categories: CategoryDraft[];
  /** category and supplier are named, not identified: the ids are only known once those rows exist in the target venue */
  products: { categoryName: string; supplierName: string | null; draft: Omit<ProductDraft, "category_id" | "supplier_id"> }[];
  /** rows the target venue already has (matched by name), left alone */
  skipped: { suppliers: number; categories: number; products: number };
}

/**
 * What copying one venue's list into another would add. Matches by name (case-insensitive), so running it twice, or into a
 * venue that already has some of the list, adds only what is missing and never duplicates.
 * Copied: categories (name, order, second place, default unit), suppliers (name, how orders go out, email, login link, rep,
 * minimums, price switch, notes) and ACTIVE products (name, unit, supplier, item code, pack multiple, notes).
 * Left behind on purpose: counts and orders, prices, Build To (starts at 0), costing links and account numbers, so each venue
 * sets its own and nothing is ever shared.
 */
export function planVenueCopy(source: CopySource, target: CopySource): CopyPlan {
  const haveCat = new Set(target.categories.map((c) => norm(c.name)));
  const haveSup = new Set(target.suppliers.map((s) => norm(s.name)));
  const targetCatName = new Map(target.categories.map((c) => [c.id, norm(c.name)]));
  const haveProd = new Set(target.products.map((p) => `${targetCatName.get(p.category_id) ?? ""}|${norm(p.name)}`));
  const nextCatSort = Math.max(0, ...target.categories.map((c) => c.sort)) + 1;
  const nextSupSort = Math.max(0, ...target.suppliers.map((s) => s.sort)) + 1;
  const skipped = { suppliers: 0, categories: 0, products: 0 };

  const srcCats = bySortThenName(source.categories);
  const categories: CategoryDraft[] = [];
  srcCats.forEach((c) => {
    if (haveCat.has(norm(c.name))) {
      skipped.categories += 1;
      return;
    }
    categories.push({ name: c.name, sort: nextCatSort + categories.length, second_location_label: c.second_location_label, unit_name: c.unit_name });
  });

  const srcSups = bySortThenName(source.suppliers);
  const suppliers: SupplierDraft[] = [];
  srcSups.forEach((s) => {
    if (haveSup.has(norm(s.name))) {
      skipped.suppliers += 1;
      return;
    }
    suppliers.push({
      name: s.name,
      method: s.method,
      email_to: s.email_to,
      login_url: s.login_url,
      rep_name: s.rep_name,
      rep_phone: s.rep_phone,
      account_no: null,
      min_order_value: s.min_order_value,
      min_order_units: s.min_order_units,
      show_prices_on_order: s.show_prices_on_order,
      notes: s.notes,
      active: s.active,
      sort: nextSupSort + suppliers.length,
    });
  });

  const catName = new Map(source.categories.map((c) => [c.id, c.name]));
  const supName = new Map(source.suppliers.map((s) => [s.id, s.name]));
  const targetMaxSort = new Map<string, number>();
  for (const p of target.products) targetMaxSort.set(norm(targetCatName.get(p.category_id)), Math.max(targetMaxSort.get(norm(targetCatName.get(p.category_id))) ?? 0, p.sort));
  const perCat = new Map<string, number>();
  const products: CopyPlan["products"] = [];
  const ordered = [...source.products]
    .filter((p) => p.active)
    .sort((a, b) => {
      const ca = srcCats.findIndex((c) => c.id === a.category_id);
      const cb = srcCats.findIndex((c) => c.id === b.category_id);
      return ca - cb || a.sort - b.sort || a.name.localeCompare(b.name);
    });
  for (const p of ordered) {
    const cn = catName.get(p.category_id);
    if (!cn) continue;
    const key = norm(cn);
    if (haveProd.has(`${key}|${norm(p.name)}`)) {
      skipped.products += 1;
      continue;
    }
    const n = (perCat.get(key) ?? 0) + 1;
    perCat.set(key, n);
    products.push({
      categoryName: cn,
      supplierName: p.supplier_id ? supName.get(p.supplier_id) ?? null : null,
      draft: {
        sort: (targetMaxSort.get(key) ?? 0) + n,
        name: p.name,
        unit_name: p.unit_name,
        supplier_item_code: p.supplier_item_code,
        pack_multiple: p.pack_multiple,
        price_inc_gst: null,
        ingredient_id: null,
        costing_packs_per_unit: null,
        par: 0,
        notes: p.notes,
        active: true,
      },
    });
  }
  return { suppliers, categories, products, skipped };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The impact lines shown before a copy is confirmed. */
export function copyImpactLines(plan: CopyPlan, sourceName: string, targetName: string): string[] {
  const out: string[] = [];
  const added = [plural(plan.categories.length, "category", "categories"), plural(plan.suppliers.length, "supplier"), plural(plan.products.length, "product")];
  out.push(`This adds ${added.join(", ")} from ${sourceName} to ${targetName}.`);
  out.push("Counts, orders, prices and account numbers are not copied. Build To starts at 0, so each venue sets its own.");
  const skipped = plan.skipped.categories + plan.skipped.suppliers + plan.skipped.products;
  if (skipped) out.push(`${plural(skipped, "item")} ${targetName} already has (matched by name) are left as they are.`);
  out.push(`After the copy ${targetName} is independent: changes at one venue never touch the other.`);
  return out;
}

/** True when there is nothing to add. */
export function copyIsEmpty(plan: CopyPlan): boolean {
  return !plan.categories.length && !plan.suppliers.length && !plan.products.length;
}
