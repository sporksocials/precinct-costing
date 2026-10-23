/**
 * Invoice matching: which supplier sent it, which venue it is for, whether it is a repeat, and which costing ingredient and ordering
 * product each line is. A line is matched only by an exact supplier item code or by a match a person already confirmed (the learning
 * table). Fuzzy name overlap produces SUGGESTIONS for a question and never sets a match. Pure, no store, no network.
 */
import type {
  AnalyseContext,
  AnalyseIngredient,
  AnalyseProduct,
  DocStatus,
  ExtractedInvoice,
  InvoiceItemMapRow,
  InvoiceSupplierRow,
  MatchMethod,
  VenueCheck,
} from "./invoice-types";
import { abnDigits, descKey, normCode, normInvoiceNumber, supplierNameKeys, tokenOverlap } from "./invoice-names";

// ---------------------------------------------------------------- supplier
export interface SupplierMatch {
  /**
   * matched       the ABN, or the name and aliases, found one supplier
   * abn_mismatch  the name matches a supplier but the ABN printed is a different one: ask, do not assume
   * ambiguous     the name matches more than one supplier
   * new           nothing matches
   * unreadable    no supplier name or ABN could be read
   */
  status: "matched" | "abn_mismatch" | "ambiguous" | "new" | "unreadable";
  supplier: InvoiceSupplierRow | null;
  candidates: InvoiceSupplierRow[];
}

const nameKeysOf = (s: InvoiceSupplierRow): Set<string> => new Set([s.name, ...(s.aliases ?? [])].flatMap(supplierNameKeys));

/** Match the supplier: ABN digits first, then the normalised name against the supplier's name and aliases. */
export function matchSupplier(ex: Pick<ExtractedInvoice, "supplier_name" | "supplier_abn">, suppliers: InvoiceSupplierRow[]): SupplierMatch {
  const abn = abnDigits(ex.supplier_abn);
  // a supplier switched off is not a candidate: its name and ABN no longer match anything
  const activeFirst = suppliers.filter((s) => s.active !== false);
  if (abn) {
    const hit = activeFirst.find((s) => abnDigits(s.abn) === abn);
    if (hit) return { status: "matched", supplier: hit, candidates: [hit] };
  }
  const keys = supplierNameKeys(ex.supplier_name);
  if (keys.length === 0 && !abn) return { status: "unreadable", supplier: null, candidates: [] };
  const byName = activeFirst.filter((s) => {
    const mine = nameKeysOf(s);
    return keys.some((k) => mine.has(k));
  });
  if (byName.length === 0) return { status: "new", supplier: null, candidates: [] };
  if (byName.length > 1) return { status: "ambiguous", supplier: null, candidates: byName };
  const s = byName[0];
  const theirs = abnDigits(s.abn);
  if (abn && theirs && abn !== theirs) return { status: "abn_mismatch", supplier: s, candidates: [s] };
  return { status: "matched", supplier: s, candidates: [s] };
}

// ---------------------------------------------------------------- venue
const venueText = (s: string | null | undefined): string =>
  ` ${String(s ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()} `;

export interface VenueResult {
  check: VenueCheck;
  /** every venue whose name or alias appears in the bill-to or ship-to text */
  named: { id: number; name: string }[];
}

/**
 * Does the bill-to / ship-to text name the venue whose folder the file arrived in?
 * ok = it names the folder venue and no other; mismatch = it names only other venues; unknown = it names none, or several.
 */
export function checkVenue(ex: Pick<ExtractedInvoice, "bill_to" | "ship_to">, venueNames: AnalyseContext["venueNames"], folderVenueId: number): VenueResult {
  const hay = venueText(`${ex.bill_to ?? ""} ${ex.ship_to ?? ""}`);
  const named = venueNames
    .filter((v) =>
      [v.name, ...(v.aliases ?? [])].some((n) => {
        const t = venueText(n);
        return t.trim() !== "" && hay.includes(t);
      }),
    )
    .map((v) => ({ id: v.id, name: v.name }));
  if (named.length === 0) return { check: "unknown", named };
  const hasFolder = named.some((v) => v.id === folderVenueId);
  if (hasFolder && named.length === 1) return { check: "ok", named };
  if (!hasFolder) return { check: "mismatch", named };
  return { check: "unknown", named };
}

// ---------------------------------------------------------------- duplicates
/**
 * The id of an invoice already filed, or null. A repeat is the same venue and supplier with the same invoice number (compared by
 * `normInvoiceNumber`, so "INV-51329" and "#0051329" are one number), OR the same venue and supplier with the same invoice date and
 * a printed total within a cent, even when the number was read differently. Documents marked duplicate or failed are ignored.
 */
export function findDuplicate(
  invoiceNumber: string | null,
  venueId: number,
  supplierId: string | null,
  existing: AnalyseContext["existingDocs"],
  invoiceDate: string | null = null,
  totalInc: number | null = null,
): string | null {
  if (!supplierId) return null;
  const num = normInvoiceNumber(invoiceNumber);
  const skip: DocStatus[] = ["duplicate", "failed"];
  const live = existing.filter((d) => d.venue_id === venueId && d.supplier_id === supplierId && !skip.includes(d.status));
  if (num) {
    const hit = live.find((d) => normInvoiceNumber(d.invoice_number) === num);
    if (hit) return hit.id;
  }
  if (invoiceDate && totalInc != null && Number.isFinite(totalInc)) {
    const hit = live.find(
      (d) => d.invoice_date != null && d.invoice_date === invoiceDate && d.total_inc != null && Number.isFinite(d.total_inc) && Math.abs(d.total_inc - totalInc) <= 0.01 + 1e-9,
    );
    if (hit) return hit.id;
  }
  return null;
}

// ---------------------------------------------------------------- lines
export interface MatchTarget {
  ingredient: AnalyseIngredient | null;
  product: AnalyseProduct | null;
}

export interface LineMatch {
  /** ignored = a person said "this is not a stock item" for this supplier and code (or description): nothing is matched or asked */
  state: "matched" | "unmatched" | "ambiguous" | "ignored";
  method: MatchMethod | null;
  mapId: string | null;
  /** packs_per_unit from the saved match, when there is one */
  mapPacks: number | null;
  ingredient: AnalyseIngredient | null;
  product: AnalyseProduct | null;
  /** ambiguous: the competing targets. unmatched: up to five suggestions (fuzzy, never a match). Otherwise empty. */
  options: MatchTarget[];
}

export interface LineToMatch {
  item_code: string | null;
  description: string;
}

export interface Matcher {
  match(line: LineToMatch): LineMatch;
}

const targetKey = (t: MatchTarget) => `${t.ingredient?.id ?? ""}|${t.product?.id ?? ""}`;

/**
 * Build the matcher for one document: the supplier's saved matches for this venue, the venue's ordering products, the ingredients.
 * `readSupplierName` is the name printed on the invoice; it counts as the supplier's name for the ordering product check.
 */
export function buildMatcher(ctx: AnalyseContext, supplier: InvoiceSupplierRow | null, readSupplierName: string | null): Matcher {
  const ingById = new Map(ctx.ingredients.map((i) => [i.id, i]));
  const venueProducts = ctx.products.filter((p) => p.venue_id === ctx.venueId);
  const prodById = new Map(venueProducts.map((p) => [p.id, p]));
  const maps: InvoiceItemMapRow[] = supplier
    ? ctx.maps.filter((m) => m.supplier_id === supplier.id && (m.venue_id == null || m.venue_id === ctx.venueId))
    : [];
  const supplierKeys = new Set<string>([
    ...supplierNameKeys(readSupplierName),
    ...(supplier ? [supplier.name, ...(supplier.aliases ?? [])].flatMap(supplierNameKeys) : []),
  ]);
  const productsOfSupplier = venueProducts.filter((p) => supplierNameKeys(p.supplier_name).some((k) => supplierKeys.has(k)));

  /** a map row as a target; null when it points at something that no longer exists */
  const mapTarget = (m: InvoiceItemMapRow): MatchTarget | null => {
    if (!m.ingredient_id && !m.product_id) return null;
    const ingredient = m.ingredient_id ? ingById.get(m.ingredient_id) ?? null : null;
    const product = m.product_id ? prodById.get(m.product_id) ?? null : null;
    if ((m.ingredient_id && !ingredient) || (m.product_id && !product)) return null;
    return { ingredient, product };
  };

  /** the distinct targets of some map rows, venue-specific rows first and alone when any exist */
  const mapHits = (rows: InvoiceItemMapRow[], rejected: (t: MatchTarget) => boolean): { target: MatchTarget; map: InvoiceItemMapRow }[] => {
    const specific = rows.filter((m) => m.venue_id === ctx.venueId);
    const pool = specific.length > 0 ? specific : rows;
    const seen = new Map<string, { target: MatchTarget; map: InvoiceItemMapRow }>();
    for (const m of pool) {
      const t = mapTarget(m);
      if (!t || rejected(t)) continue;
      if (!seen.has(targetKey(t))) seen.set(targetKey(t), { target: t, map: m });
    }
    return Array.from(seen.values());
  };

  const productTarget = (p: AnalyseProduct): MatchTarget => ({ product: p, ingredient: p.ingredient_id ? ingById.get(p.ingredient_id) ?? null : null });

  /** suggestions for a question: active products and ingredients whose names share words with the line, best five */
  const suggest = (line: LineToMatch, rejected: (t: MatchTarget) => boolean): MatchTarget[] => {
    const targets: MatchTarget[] = [];
    const usedIng = new Set<string>();
    for (const p of venueProducts) {
      if (!p.active) continue;
      const t = productTarget(p);
      if (t.ingredient) usedIng.add(t.ingredient.id);
      targets.push(t);
    }
    for (const i of ctx.ingredients) if (i.active && !usedIng.has(i.id)) targets.push({ ingredient: i, product: null });
    const scored = targets
      .filter((t) => !rejected(t))
      .map((t) => {
        const a = tokenOverlap(line.description, t.product?.name);
        const b = tokenOverlap(line.description, t.ingredient?.name);
        const own = supplier?.cost_supplier_id != null && t.ingredient?.supplier_id === supplier.cost_supplier_id ? 0.05 : 0;
        return { t, score: Math.max(a, b), rank: Math.max(a, b) + own, name: t.product?.name ?? t.ingredient?.name ?? "" };
      })
      .filter((s) => s.score >= 0.3);
    scored.sort((x, y) => y.rank - x.rank || x.name.localeCompare(y.name));
    return scored.slice(0, 5).map((s) => s.t);
  };

  const matched = (t: MatchTarget, method: MatchMethod, map: InvoiceItemMapRow | null): LineMatch => ({
    state: "matched",
    method,
    mapId: map?.id ?? null,
    mapPacks: map ? map.packs_per_unit : null,
    ingredient: t.ingredient,
    product: t.product,
    options: [],
  });
  const ambiguous = (targets: MatchTarget[]): LineMatch => ({ state: "ambiguous", method: null, mapId: null, mapPacks: null, ingredient: null, product: null, options: targets });

  return {
    match(line: LineToMatch): LineMatch {
      const code = normCode(line.item_code);
      const dKey = descKey(line.description);

      // a saved "this is NOT that product" removes the candidate for this code or description for good
      const rejRows = maps.filter((m) => m.rejected && ((code && normCode(m.item_code) === code) || (m.desc_key && m.desc_key === dKey)));
      const rejIng = new Set(rejRows.map((m) => m.ingredient_id).filter((x): x is string => !!x));
      const rejProd = new Set(rejRows.map((m) => m.product_id).filter((x): x is string => !!x));
      const rejected = (t: MatchTarget) => (!!t.ingredient && rejIng.has(t.ingredient.id)) || (!!t.product && rejProd.has(t.product.id));

      const settle = (hits: { target: MatchTarget; map: InvoiceItemMapRow | null }[], method: MatchMethod): LineMatch | null => {
        if (hits.length === 1) return matched(hits[0].target, method, hits[0].map);
        if (hits.length > 1) return ambiguous(hits.map((h) => h.target));
        return null;
      };

      // (i) saved match by item code, (ii) saved match by description
      if (code) {
        const r = settle(mapHits(maps.filter((m) => !m.rejected && m.item_code && normCode(m.item_code) === code), rejected), "code");
        if (r) return r;
      }
      const byDesc = settle(mapHits(maps.filter((m) => !m.rejected && m.desc_key && m.desc_key === dKey), rejected), "alias");
      if (byDesc) return byDesc;

      // "this is not a stock item" is stored as a rejected row with no ingredient and no product. It stops the automatic matches below
      // (an ordering product or costing ingredient with this code) and the questions; a match a person confirmed later still wins above.
      if (rejRows.some((m) => !m.ingredient_id && !m.product_id)) {
        return { state: "ignored", method: null, mapId: null, mapPacks: null, ingredient: null, product: null, options: [] };
      }

      if (code) {
        // (iii) the venue's ordering product with this supplier item code, then its linked ingredient
        const byCode = productsOfSupplier.filter((p) => normCode(p.supplier_item_code) === code);
        const live = byCode.some((p) => p.active) ? byCode.filter((p) => p.active) : byCode;
        const prodHits = live.map(productTarget).filter((t) => !rejected(t)).map((t) => ({ target: t, map: null }));
        const r3 = settle(prodHits, "code");
        if (r3) return r3;

        // (iv) a costing ingredient with this supplier code, from this supplier
        if (supplier?.cost_supplier_id != null) {
          const ings = ctx.ingredients.filter((i) => i.supplier_id === supplier.cost_supplier_id && normCode(i.supplier_code) === code);
          const liveIng = ings.some((i) => i.active) ? ings.filter((i) => i.active) : ings;
          const ingHits = liveIng.map((i) => ({ ingredient: i, product: null }) as MatchTarget).filter((t) => !rejected(t)).map((t) => ({ target: t, map: null }));
          const r4 = settle(ingHits, "code");
          if (r4) return r4;
        }
      }

      return { state: "unmatched", method: null, mapId: null, mapPacks: null, ingredient: null, product: null, options: suggest(line, rejected) };
    },
  };
}
