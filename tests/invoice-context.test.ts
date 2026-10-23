import { describe, expect, it } from "vitest";
import { loadAnalyseContext, settingsFromRows } from "../lib/invoice-context";
import { DEFAULT_INVOICE_SETTINGS } from "../lib/invoice-types";
import { createFakeSupabase } from "./helpers/fake-supabase";
import { ingredient, IDS, product, SETTINGS_AUTO, SUPPLIER, VENUES } from "./helpers/invoice-fixtures";

const args = { venueId: 1, folderVenueId: 1, today: "2026-10-24" };

function seeded(extra: Record<string, any[]> = {}) {
  return createFakeSupabase({
    cost_venues: VENUES,
    cost_settings: SETTINGS_AUTO,
    invoice_suppliers: [SUPPLIER],
    invoice_item_map: [
      { id: "m-all", supplier_id: IDS.supplier, venue_id: null, item_code: "15026", desc_key: null, ingredient_id: IDS.kingfish, product_id: null, packs_per_unit: 1, rejected: false },
      { id: "m-drift", supplier_id: IDS.supplier, venue_id: 1, item_code: "15056", desc_key: null, ingredient_id: IDS.barra, product_id: null, packs_per_unit: 1, rejected: false },
      { id: "m-chiobu", supplier_id: IDS.supplier, venue_id: 2, item_code: "99", desc_key: null, ingredient_id: IDS.barra, product_id: null, packs_per_unit: 1, rejected: false },
    ],
    invoice_charge_rules: [
      { id: "r1", supplier_id: null, match_text: "delivery", line_class: "delivery", spread: true, note: null, active: true },
      { id: "r2", supplier_id: null, match_text: "old rule", line_class: "fee", spread: true, note: null, active: false },
    ],
    cost_ingredients: [ingredient(), ingredient({ id: IDS.barra, name: "Barramundi", supplier_code: "15056", active: false })],
    cost_ingredient_deals: [],
    ordering_suppliers: [{ id: "osup-1", venue_id: 1, name: "Daniel Street" }, { id: "osup-9", venue_id: 2, name: "Other" }],
    ordering_products: [product({ deal_buy_qty: 8, deal_free_qty: 1 }), product({ id: "prod-chiobu", venue_id: 2, name: "Chiobu thing", supplier_id: "osup-9" })],
    invoice_documents: [
      { id: "d1", venue_id: 1, supplier_id: IDS.supplier, invoice_number: "51329", status: "applied", pages: [1] },
      { id: "d2", venue_id: 2, supplier_id: IDS.supplier, invoice_number: "777", status: "needs_review", pages: [1] },
    ],
    ...extra,
  });
}

describe("loadAnalyseContext", () => {
  it("loads everything for one venue", async () => {
    const f = seeded();
    const ctx = await loadAnalyseContext(f.sb, { ...args, folderVenueId: 2 });
    expect(ctx).toMatchObject({ venueId: 1, folderVenueId: 2, today: "2026-10-24", gstRate: 0.1 });
    expect(ctx.settings).toEqual({ autoApplyPct: 0.05, learningMode: false, averageDays: 90, usdToAud: 1.55 });
    expect(ctx.venueNames.find((v) => v.id === 1)).toEqual({ id: 1, name: "Drift", aliases: expect.arrayContaining(["drift bar"]) });
    expect(ctx.venueNames.find((v) => v.id === 3)!.aliases).toContain("greedy gringo");
    expect(ctx.venueNames.find((v) => v.id === 4)!.aliases).toContain("gelato rumba");
    expect(ctx.suppliers).toHaveLength(1);
    expect(ctx.suppliers[0]).toMatchObject({ id: IDS.supplier, auto_apply: true });
    expect(ctx.existingDocs).toEqual([{ id: "d1", venue_id: 1, supplier_id: IDS.supplier, invoice_number: "51329", status: "applied" }]);
  });

  it("keeps maps for this venue and for every venue, and only active charge rules", async () => {
    const ctx = await loadAnalyseContext(seeded().sb, args);
    expect(ctx.maps.map((m) => m.id).sort()).toEqual(["m-all", "m-drift"]);
    expect(ctx.chargeRules.map((r) => r.id)).toEqual(["r1"]);
  });

  it("loads active and inactive ingredients mapped to the engine's shape", async () => {
    const ctx = await loadAnalyseContext(seeded().sb, args);
    expect(ctx.ingredients).toHaveLength(2);
    expect(ctx.ingredients.find((i) => i.id === IDS.kingfish)).toEqual({
      id: IDS.kingfish, name: "Kingfish Fillets", supplier_id: 7, supplier_code: "15026", pack_size: 1, pack_unit: "kg", pack_price: 65, price_inc_gst: false, gst_free: true,
      last_price_update: "2026-10-01", active: true, has_deal: false,
    });
    expect(ctx.ingredients.find((i) => i.id === IDS.barra)!.active).toBe(false);
  });

  it("loads this venue's ordering products with the supplier name", async () => {
    const ctx = await loadAnalyseContext(seeded().sb, args);
    expect(ctx.products).toHaveLength(1);
    expect(ctx.products[0]).toEqual({
      id: IDS.kingfishProduct, venue_id: 1, name: "Kingfish Fillets", supplier_item_code: "15026", supplier_name: "Daniel Street", unit_name: "kg", price_inc_gst: 65,
      ingredient_id: IDS.kingfish, costing_packs_per_unit: 1, deal_buy_qty: 8, deal_free_qty: 1, active: true,
    });
  });

  describe("has_deal", () => {
    const deal = (over: Record<string, any>) => ({ id: "deal", ingredient_id: IDS.kingfish, kind: "buy_x_get_y", active: true, starts_on: null, ends_on: null, ...over });
    it("is true for a deal in force, ending soon or coming up", async () => {
      for (const d of [deal({}), deal({ ends_on: "2026-11-30" }), deal({ ends_on: "2026-10-30" }), deal({ starts_on: "2026-11-01" })]) {
        const ctx = await loadAnalyseContext(seeded({ cost_ingredient_deals: [d] }).sb, args);
        expect(ctx.ingredients.find((i) => i.id === IDS.kingfish)!.has_deal, JSON.stringify(d)).toBe(true);
        expect(ctx.ingredients.find((i) => i.id === IDS.barra)!.has_deal).toBe(false);
      }
    });
    it("is false for a deal that is switched off or has ended", async () => {
      for (const d of [deal({ active: false }), deal({ ends_on: "2026-10-01" })]) {
        const ctx = await loadAnalyseContext(seeded({ cost_ingredient_deals: [d] }).sb, args);
        expect(ctx.ingredients.find((i) => i.id === IDS.kingfish)!.has_deal).toBe(false);
      }
    });
  });

  it("falls back to the defaults when the settings rows are missing", async () => {
    const ctx = await loadAnalyseContext(seeded({ cost_settings: [] }).sb, args);
    expect(ctx.settings).toEqual(DEFAULT_INVOICE_SETTINGS);
    expect(ctx.settings.learningMode).toBe(true);
    expect(ctx.gstRate).toBe(0.1);
  });

  it("reads every page: Supabase returns 1000 rows at a time", async () => {
    const many = Array.from({ length: 2350 }, (_, i) => ingredient({ id: `ing-${String(i).padStart(5, "0")}`, name: `Thing ${i}` }));
    const f = seeded({ cost_ingredients: many });
    expect(f.maxRows).toBe(1000);
    const ctx = await loadAnalyseContext(f.sb, args);
    expect(ctx.ingredients).toHaveLength(2350);
    expect(new Set(ctx.ingredients.map((i) => i.id)).size).toBe(2350);
    const reads = f.log.filter((l) => l.table === "cost_ingredients");
    expect(reads.length).toBeGreaterThanOrEqual(3);
  });
});

describe("settingsFromRows", () => {
  it("treats only an explicit 0 as learning mode off", () => {
    expect(settingsFromRows([{ key: "invoice_learning_mode", value: 0 }]).settings.learningMode).toBe(false);
    expect(settingsFromRows([{ key: "invoice_learning_mode", value: 1 }]).settings.learningMode).toBe(true);
    expect(settingsFromRows([{ key: "invoice_learning_mode", value: "garbage" }]).settings.learningMode).toBe(true);
    expect(settingsFromRows([]).settings.learningMode).toBe(true);
  });
  it("reads the numbers and the GST rate", () => {
    const r = settingsFromRows([{ key: "invoice_auto_apply_pct", value: 0.03 }, { key: "invoice_average_days", value: "60" }, { key: "gst_rate", value: 0.15 }]);
    expect(r.settings.autoApplyPct).toBe(0.03);
    expect(r.settings.averageDays).toBe(60);
    expect(r.gstRate).toBe(0.15);
  });
});
