/**
 * Invoices: loads everything the engine needs for one venue (lib/invoice-engine.ts is pure and reads only this).
 * Takes ANY Supabase client: the service-role client when the reader runs on the server, the signed-in client in the browser.
 * No React, no store. Supabase caps a request at 1000 rows, so every table is paged (`fetchAll`).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { brisbaneToday, dealStatus } from "./deals";
import type { LoadAnalyseContext } from "./invoice-interfaces";
import {
  DEFAULT_INVOICE_SETTINGS,
  INVOICE_SETTING_KEYS,
  type AnalyseContext,
  type AnalyseIngredient,
  type AnalyseProduct,
  type InvoiceChargeRuleRow,
  type InvoiceItemMapRow,
  type InvoiceSettings,
  type InvoiceSupplierRow,
} from "./invoice-types";

const PAGE = 1000;

/** Every row of a query, one page at a time. `build` adds filters; rows are ordered by `orderBy` so pages never overlap. */
export async function fetchAll<T = Record<string, any>>(
  sb: SupabaseClient,
  table: string,
  columns: string,
  build?: (q: any) => any,
  orderBy = "id",
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    let q: any = sb.from(table).select(columns);
    if (build) q = build(q);
    const { data, error } = await q.order(orderBy, { ascending: true }).range(from, from + PAGE - 1);
    if (error) throw new Error(`Could not read ${table}: ${error.message}`);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

/** Other ways an invoice writes a venue's name, lower case. The engine matches bill-to and ship-to text against these. */
const VENUE_ALIASES: Record<string, string[]> = {
  drift: ["drift bar", "drift bar and dining", "drift bar & dining", "drift bar dining"],
  chiobu: ["chiobu"],
  greedy: ["greedy gringo", "greedy gringos", "greedy gringo's", "greedy gringos caloundra"],
  gelato: ["gelato rumba"],
};

function num(v: unknown, fallback: number): number {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return typeof n === "number" && Number.isFinite(n) ? n : fallback;
}

/** The invoice settings from cost_settings rows; a missing or unreadable row falls back to the default. */
export function settingsFromRows(rows: { key: string; value: unknown }[]): { settings: InvoiceSettings; gstRate: number } {
  const by = new Map(rows.map((r) => [r.key, r.value]));
  const d = DEFAULT_INVOICE_SETTINGS;
  const learning = by.get(INVOICE_SETTING_KEYS.learningMode);
  return {
    settings: {
      autoApplyPct: num(by.get(INVOICE_SETTING_KEYS.autoApplyPct), d.autoApplyPct),
      // anything but an explicit 0 keeps learning mode on: the safe side
      learningMode: learning === undefined || learning === null ? d.learningMode : num(learning, 1) !== 0,
      averageDays: num(by.get(INVOICE_SETTING_KEYS.averageDays), d.averageDays),
      usdToAud: num(by.get(INVOICE_SETTING_KEYS.usdToAud), d.usdToAud),
    },
    gstRate: num(by.get("gst_rate"), 0.1),
  };
}

export const loadAnalyseContext: LoadAnalyseContext = async (sb, { venueId, folderVenueId, today }): Promise<AnalyseContext> => {
  const now = today || brisbaneToday();

  const [venues, settingRows, suppliers, maps, rules, ingredientRows, dealRows, productRows, orderingSuppliers, docs] = await Promise.all([
    fetchAll<{ id: number; name: string; slug: string }>(sb, "cost_venues", "id,name,slug"),
    fetchAll<{ key: string; value: unknown }>(
      sb,
      "cost_settings",
      "key,value",
      (q) => q.in("key", ["gst_rate", ...Object.values(INVOICE_SETTING_KEYS)]),
      "key",
    ),
    fetchAll<InvoiceSupplierRow>(sb, "invoice_suppliers", "id,name,abn,aliases,cost_supplier_id,allocation_basis,auto_apply,notes,active"),
    fetchAll<InvoiceItemMapRow>(sb, "invoice_item_map", "id,supplier_id,venue_id,item_code,desc_key,ingredient_id,product_id,packs_per_unit,rejected"),
    fetchAll<InvoiceChargeRuleRow>(sb, "invoice_charge_rules", "id,supplier_id,match_text,line_class,spread,note,active", (q) => q.eq("active", true)),
    fetchAll<Record<string, any>>(
      sb,
      "cost_ingredients",
      "id,name,supplier_id,supplier_code,pack_size,pack_unit,pack_price,price_inc_gst,gst_free,last_price_update,active",
    ),
    fetchAll<{ id: string; ingredient_id: string; active: boolean; starts_on: string | null; ends_on: string | null }>(
      sb,
      "cost_ingredient_deals",
      "id,ingredient_id,active,starts_on,ends_on",
      (q) => q.eq("active", true),
    ),
    fetchAll<Record<string, any>>(
      sb,
      "ordering_products",
      "id,venue_id,name,supplier_id,supplier_item_code,unit_name,price_inc_gst,ingredient_id,costing_packs_per_unit,deal_buy_qty,deal_free_qty,active",
      (q) => q.eq("venue_id", venueId),
    ),
    fetchAll<{ id: string; name: string }>(sb, "ordering_suppliers", "id,name", (q) => q.eq("venue_id", venueId)),
    fetchAll<AnalyseContext["existingDocs"][number]>(sb, "invoice_documents", "id,venue_id,supplier_id,invoice_number,status", (q) => q.eq("venue_id", venueId)),
  ]);

  const { settings, gstRate } = settingsFromRows(settingRows);

  // a deal in force (or coming) changes what a unit really costs, so the price must never apply itself; an expired one does not
  const inForce = (d: (typeof dealRows)[number]) => {
    const st = dealStatus({ active: d.active, starts_on: d.starts_on, ends_on: d.ends_on }, now);
    return st !== "expired" && st !== "off";
  };
  const withDeal = new Set(dealRows.filter(inForce).map((d) => d.ingredient_id));
  const ingredients: AnalyseIngredient[] = ingredientRows.map((r) => ({
    id: r.id,
    name: r.name,
    supplier_id: r.supplier_id ?? null,
    supplier_code: r.supplier_code ?? null,
    pack_size: num(r.pack_size, 1),
    pack_unit: r.pack_unit,
    pack_price: num(r.pack_price, 0),
    price_inc_gst: !!r.price_inc_gst,
    gst_free: !!r.gst_free,
    last_price_update: r.last_price_update ?? null,
    active: r.active !== false,
    has_deal: withDeal.has(r.id),
  }));

  const supplierName = new Map(orderingSuppliers.map((s) => [s.id, s.name]));
  const products: AnalyseProduct[] = productRows.map((r) => ({
    id: r.id,
    venue_id: r.venue_id,
    name: r.name,
    supplier_item_code: r.supplier_item_code ?? null,
    supplier_name: r.supplier_id ? supplierName.get(r.supplier_id) ?? null : null,
    unit_name: r.unit_name,
    price_inc_gst: r.price_inc_gst === null || r.price_inc_gst === undefined ? null : num(r.price_inc_gst, 0),
    ingredient_id: r.ingredient_id ?? null,
    costing_packs_per_unit: r.costing_packs_per_unit === null || r.costing_packs_per_unit === undefined ? null : num(r.costing_packs_per_unit, 1),
    deal_buy_qty: r.deal_buy_qty === null || r.deal_buy_qty === undefined ? null : num(r.deal_buy_qty, 0),
    deal_free_qty: r.deal_free_qty === null || r.deal_free_qty === undefined ? null : num(r.deal_free_qty, 0),
    active: r.active !== false,
  }));

  return {
    venueId,
    folderVenueId,
    venueNames: venues.map((v) => ({ id: v.id, name: v.name, aliases: VENUE_ALIASES[v.slug] ?? [] })),
    settings,
    gstRate,
    suppliers: suppliers.map((s) => ({ ...s, aliases: s.aliases ?? [], auto_apply: !!s.auto_apply, active: s.active !== false })),
    // a map entry is for this venue or for every venue (venue_id null)
    maps: maps.map((m) => ({ ...m, packs_per_unit: num(m.packs_per_unit, 1), rejected: !!m.rejected })).filter((m) => m.venue_id === null || m.venue_id === venueId),
    chargeRules: rules,
    ingredients,
    products,
    existingDocs: docs,
    today: now,
  };
};
