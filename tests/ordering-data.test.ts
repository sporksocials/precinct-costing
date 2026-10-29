import { readFileSync } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  ORDERING_UNAVAILABLE,
  OrderingError,
  addDraftOrderLine,
  blankCategory,
  blankProduct,
  blankSupplier,
  ensureTermsRow,
  createCategory,
  createOrder,
  createProduct,
  createSupplier,
  cancelCountSession,
  finaliseCountSession,
  loadCountLines,
  loadOrderLines,
  loadOrders,
  loadVenueOrdering,
  markOrderSent,
  removeDraftOrderLine,
  startCountSession,
  syncCountEdits,
  updateDraftOrderLine,
  updateProduct,
  updateSupplier,
} from "@/lib/ordering-data";
import { insertRow } from "@/lib/store";
import { buildSupplierOrders, draftLinesFromSuggestions } from "@/lib/ordering";
import { copyVenueSetup } from "@/lib/ordering-screens-data";
import { copyIsEmpty, planVenueCopy } from "@/lib/ordering-setup";
import { fixtureId } from "@/lib/ordering-fixture";
import type { CountEdit, OrderingProduct } from "@/lib/ordering-types";

let sb: SupabaseClient;
let testSupplierId = 0;
beforeAll(async () => {
  // the demo client is the in-memory stand-in for the database: it needs a window and the (empty) demo data endpoint
  vi.stubGlobal("window", {});
  vi.stubGlobal("fetch", async () => ({ ok: true, json: async () => ({}) }));
  const { createDemoClient } = await import("@/lib/supabase/demo-client");
  sb = createDemoClient();
});

const history = async (table: string) => ((await sb.from("cost_change_history").select("*").eq("table_name", table)).data ?? []) as { op: string; old_row: Record<string, unknown> | null; new_row: Record<string, unknown> | null; changed_fields: string[]; parent_table: string | null }[];
const T0 = "2026-10-05T01:00:00.000Z";
const edit = (venue: number, session: string, product: string, over: Partial<CountEdit> = {}): CountEdit => ({ client_uuid: crypto.randomUUID(), session_id: session, venue_id: venue, product_id: product, at: T0, by: "t@x.com", ...over });

describe("loading one venue", () => {
  it("returns only that venue's data", async () => {
    const drift = await loadVenueOrdering(sb, 1);
    const greedy = await loadVenueOrdering(sb, 3);
    for (const set of [drift, greedy]) {
      const v = set === drift ? 1 : 3;
      expect([...set.suppliers, ...set.categories, ...set.products, ...set.sessions].every((r) => r.venue_id === v)).toBe(true);
    }
    expect(drift.suppliers.map((s) => s.name)).toContain("Star");
    expect(greedy.suppliers.map((s) => s.name)).not.toContain("Star");
    expect(drift.products.find((p) => p.name.startsWith("Lift"))?.name).toContain("15 L");
    expect(greedy.products.find((p) => p.name.startsWith("Lift"))?.name).toContain("5 L");
    expect(drift.openSession).toBeNull();
    expect(drift.sessions).toHaveLength(1);
    expect((await loadVenueOrdering(sb, 2)).products).toEqual([]);
  });
  it("a name can repeat across categories at one venue (Coke as post-mix and as cans)", async () => {
    const drift = await loadVenueOrdering(sb, 1);
    const cokes = drift.products.filter((p) => p.name === "Coke");
    expect(cokes.map((p) => p.unit_name).sort()).toEqual(["bag", "carton"]);
  });
});

describe("suppliers, categories and products", () => {
  it("creates a supplier's terms with the defaults a null key lets the database apply", async () => {
    const master = ((await insertRow(sb, "cost_suppliers", { name: "Test Supplier" }).select("*")).data ?? [])[0] as { id: number };
    testSupplierId = master.id;
    const s = await createSupplier(sb, 2, blankSupplier(master.id, "Test Supplier"));
    expect(s).toMatchObject({ venue_id: 2, name: "Test Supplier", method: "email", show_prices_on_order: false, active: true, min_order_value: null });
    expect(s.updated_by).toBe("demo@precinct.local");
  });
  it("refuses a duplicate supplier or category name at the same venue, with a plain message", async () => {
    await expect(createSupplier(sb, 2, blankSupplier(testSupplierId, "Test Supplier"))).rejects.toMatchObject({ name: "OrderingError", code: "23505", message: "A supplier called Test Supplier already exists at this venue." });
    await createCategory(sb, 2, blankCategory("Wine"));
    await expect(createCategory(sb, 2, blankCategory("Wine"))).rejects.toThrow("A category called Wine already exists at this venue.");
    // the same name at another venue is fine: everything is separate per venue
    await expect(createCategory(sb, 4, blankCategory("Wine"))).resolves.toMatchObject({ venue_id: 4 });
  });
  it("product names are unique per category, not per venue", async () => {
    const cats = (await loadVenueOrdering(sb, 2)).categories;
    const wine = cats.find((c) => c.name === "Wine")!;
    const soft = await createCategory(sb, 2, blankCategory("Soft Drink"));
    await createProduct(sb, 2, blankProduct(wine.id, "Coke"));
    await expect(createProduct(sb, 2, blankProduct(wine.id, "Coke"))).rejects.toThrow("already exists in that category");
    await expect(createProduct(sb, 2, blankProduct(soft.id, "Coke"))).resolves.toMatchObject({ name: "Coke", pack_multiple: 1, par: 0, active: true });
  });
  it("updates a product and the change history keeps who, the old value and the new one", async () => {
    const p = (await loadVenueOrdering(sb, 1)).products.find((x) => x.name === "Bourbon Bottle")!;
    const after = await updateProduct(sb, p.id, { par: 24 });
    expect(after.par).toBe(24);
    const rows = (await history("ordering_products")).filter((h) => h.op === "update");
    expect(rows).toHaveLength(1);
    expect(rows[0].changed_fields).toEqual(["par"]);
    expect(rows[0].old_row?.par).toBe(18);
    expect(rows[0].new_row?.par).toBe(24);
  });
  it("a bookkeeping-only update is not a change", async () => {
    const before = (await history("ordering_suppliers")).length;
    const s = (await loadVenueOrdering(sb, 2)).suppliers[0];
    await updateSupplier(sb, s.id, { notes: s.notes });
    expect((await history("ordering_suppliers")).length).toBe(before);
  });
  it("an update that touches nothing is a failure, not a silent success", async () => {
    await expect(updateProduct(sb, "00000000-0000-4000-8000-000000000000", { par: 1 })).rejects.toMatchObject({ code: "not_saved" });
  });
});

describe("count sessions", () => {
  it("Start Count begins one, and a second start resumes it (one in progress per venue)", async () => {
    const a = await startCountSession(sb, 3, "a@x.com");
    expect(a.resumed).toBe(false);
    expect(a.session.status).toBe("in_progress");
    const b = await startCountSession(sb, 3, "b@x.com");
    expect(b.resumed).toBe(true);
    expect(b.session.id).toBe(a.session.id);
    // another venue is independent
    const other = await startCountSession(sb, 1, "a@x.com");
    expect(other.resumed).toBe(false);
    expect(other.session.id).not.toBe(a.session.id);
  });

  it("Cancel Count sets a count in progress aside: it frees the slot, is hidden, and a finished count cannot be cancelled", async () => {
    const a = await startCountSession(sb, 2, "a@x.com");
    expect(await cancelCountSession(sb, a.session.id)).toMatchObject({ status: "cancelled" });
    const after = await loadVenueOrdering(sb, 2);
    expect(after.openSession).toBeNull();
    expect(after.sessions.some((x) => x.id === a.session.id)).toBe(false);
    // a fresh count can start, and it is a different one
    const b = await startCountSession(sb, 2, "a@x.com");
    expect(b.resumed).toBe(false);
    expect(b.session.id).not.toBe(a.session.id);
    // cancelling twice is harmless, a finished count is refused
    expect(await cancelCountSession(sb, a.session.id)).toMatchObject({ status: "cancelled" });
    await finaliseCountSession(sb, b.session.id, "a@x.com");
    await expect(cancelCountSession(sb, b.session.id)).rejects.toThrow(/already finished/);
  });

  it("syncs queued edits: a zero stays zero, a clear stays null, a retry changes nothing, nothing is logged while in progress", async () => {
    const { session } = await startCountSession(sb, 1, "a@x.com"); // resumes the one from above
    const products = (await loadVenueOrdering(sb, 1)).products;
    const [p1, p2] = [products[0], products[1]];
    const queue: CountEdit[] = [
      edit(1, session.id, p1.id, { store_qty: 0, second_qty: 3, product_name: p1.name, par_at_count: p1.par, unit_name: p1.unit_name }),
      edit(1, session.id, p2.id, { store_qty: 2 }),
    ];
    const r1 = await syncCountEdits(sb, session.id, queue);
    expect(r1.written).toBe(2);
    const l1 = r1.lines.find((l) => l.product_id === p1.id)!;
    expect(l1).toMatchObject({ store_qty: 0, second_qty: 3, counted_by: "t@x.com", product_name: p1.name });
    expect(r1.lines.find((l) => l.product_id === p2.id)?.second_qty).toBeNull();

    const r2 = await syncCountEdits(sb, session.id, queue); // the same queue again (a lost response)
    expect(r2.written).toBe(0);
    expect(r2.skipped).toHaveLength(2);
    expect((await loadCountLines(sb, session.id)).length).toBe(2);

    const r3 = await syncCountEdits(sb, session.id, [edit(1, session.id, p1.id, { second_qty: null, at: "2026-10-05T02:00:00.000Z" })]);
    expect(r3.lines.find((l) => l.product_id === p1.id)).toMatchObject({ store_qty: 0, second_qty: null });

    expect(await history("ordering_count_lines")).toHaveLength(0);
  });

  it("an old edit arriving late does not overwrite a newer count", async () => {
    const { session } = await startCountSession(sb, 1, "a@x.com");
    const p = (await loadVenueOrdering(sb, 1)).products[1];
    const r = await syncCountEdits(sb, session.id, [edit(1, session.id, p.id, { store_qty: 1, at: "2026-10-05T00:00:00.000Z" })]);
    expect(r.skipped).toHaveLength(1);
    expect(r.lines.find((l) => l.product_id === p.id)?.store_qty).toBe(2);
  });

  it("ignores edits that belong to another session", async () => {
    const { session } = await startCountSession(sb, 1, "a@x.com");
    const p = (await loadVenueOrdering(sb, 1)).products[2];
    const r = await syncCountEdits(sb, session.id, [edit(1, "some-other-session", p.id, { store_qty: 5 })]);
    expect(r.written).toBe(0);
    expect(r.lines.some((l) => l.product_id === p.id)).toBe(false);
  });

  it("Finalise is idempotent; edits afterwards are logged with the old values", async () => {
    const { session } = await startCountSession(sb, 1, "a@x.com");
    const done = await finaliseCountSession(sb, session.id, "f@x.com", "2026-10-05T03:00:00.000Z");
    expect(done).toMatchObject({ status: "finalised", finalised_by: "f@x.com", finalised_at: "2026-10-05T03:00:00.000Z" });
    expect(await finaliseCountSession(sb, session.id, "other@x.com")).toMatchObject({ finalised_by: "f@x.com" });
    expect((await loadVenueOrdering(sb, 1)).openSession).toBeNull();

    const p1 = (await loadVenueOrdering(sb, 1)).products[0];
    await syncCountEdits(sb, session.id, [edit(1, session.id, p1.id, { store_qty: 7, at: "2026-10-05T04:00:00.000Z" })]);
    const rows = await history("ordering_count_lines");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ op: "update", parent_table: "ordering_count_sessions" });
    expect(rows[0].changed_fields).toContain("store_qty");
    expect(rows[0].old_row?.store_qty).toBe(0);
    expect(rows[0].new_row?.store_qty).toBe(7);
    // a product counted for the first time after finalising is logged too
    const p9 = (await loadVenueOrdering(sb, 1)).products[8];
    await syncCountEdits(sb, session.id, [edit(1, session.id, p9.id, { store_qty: 1, at: "2026-10-05T04:05:00.000Z" })]);
    expect((await history("ordering_count_lines")).map((h) => h.op)).toEqual(["update", "insert"]);
  });
});

describe("orders", () => {
  const driftOrder = async () => {
    const data = await loadVenueOrdering(sb, 1);
    const sessionId = fixtureId("ses", 1, 1); // the finalised example count (earlier tests start newer sessions)
    const lines = await loadCountLines(sb, sessionId);
    const groups = buildSupplierOrders(data.products, lines, { suppliers: data.suppliers, categories: data.categories });
    return { data, sessionId, star: groups.find((g) => g.supplierName === "Star")! };
  };

  it("saves a draft order with snapshot lines, skipping zero lines", async () => {
    const { data, sessionId, star } = await driftOrder();
    const drafts = draftLinesFromSuggestions(star.lines);
    expect(drafts.length).toBeGreaterThan(0);
    const { order, lines } = await createOrder(sb, 1, { supplierId: star.supplierId!, sessionId, kind: "count", showPrices: true, lines: [...drafts, { ...drafts[0], ordered_qty: 0 }] });
    expect(order).toMatchObject({ venue_id: 1, status: "draft", kind: "count", show_prices: true, supplier_id: star.supplierId });
    expect(lines).toHaveLength(drafts.length);
    expect(lines.every((l) => l.order_id === order.id && l.venue_id === 1)).toBe(true);
    expect(lines.map((l) => l.sort)).toEqual(drafts.map((_, i) => i));
    expect((await loadOrderLines(sb, order.id)).map((l) => l.product_name)).toEqual(drafts.map((d) => d.product_name));
    expect((await loadOrders(sb, 1, { sessionId })).map((o) => o.id)).toContain(order.id);
    expect(await loadOrders(sb, 3)).toEqual([]);
    expect(data.suppliers.length).toBeGreaterThan(0);
  });

  it("edits a draft, then Mark As Sent keeps the exact text and the order never changes again", async () => {
    const { star } = await driftOrder();
    const { order, lines } = await createOrder(sb, 1, { supplierId: star.supplierId!, sessionId: null, kind: "top_up", showPrices: false, lines: draftLinesFromSuggestions(star.lines) });
    expect(order.session_id).toBeNull();
    const changed = await updateDraftOrderLine(sb, order.id, lines[0].id, { ordered_qty: 12 });
    expect(changed.ordered_qty).toBe(12);
    const product = (await loadVenueOrdering(sb, 1)).products.find((p) => p.id === lines[0].product_id) as OrderingProduct;
    const extra = await addDraftOrderLine(sb, 1, order.id, { product_id: product.id, product_name: "Added", supplier_item_code: null, unit_name: "bottle", suggested_qty: null, ordered_qty: 2, pack_multiple: 1, price_inc_gst: null, sort: 99 });
    await removeDraftOrderLine(sb, order.id, extra.id);

    const sent = await markOrderSent(sb, order.id, { by: "t@x.com", method: "outlook", subject: "Drift Order", bodyText: "Hi Mark,\n\nthe exact text", warningText: "Order is 4 cartons short of the 10 carton minimum", showPrices: false, at: "2026-10-05T05:00:00.000Z" });
    expect(sent).toMatchObject({ status: "sent", sent_by: "t@x.com", sent_at: "2026-10-05T05:00:00.000Z", method: "outlook", subject: "Drift Order", body_text: "Hi Mark,\n\nthe exact text" });
    const again = await markOrderSent(sb, order.id, { by: "someone@x.com", method: "copy", subject: "Changed", bodyText: "changed", warningText: null, showPrices: false });
    expect(again).toMatchObject({ sent_by: "t@x.com", subject: "Drift Order", body_text: "Hi Mark,\n\nthe exact text" });

    await expect(updateDraftOrderLine(sb, order.id, lines[0].id, { ordered_qty: 1 })).rejects.toMatchObject({ code: "sent" });
    await expect(addDraftOrderLine(sb, 1, order.id, { product_id: null, product_name: "X", supplier_item_code: null, unit_name: null, suggested_qty: null, ordered_qty: 1, pack_multiple: null, price_inc_gst: null, sort: 0 })).rejects.toThrow("has been sent");
    await expect(removeDraftOrderLine(sb, order.id, lines[0].id)).rejects.toThrow("has been sent");
    expect((await loadOrderLines(sb, order.id))[0].ordered_qty).toBe(12);
    // the order itself is in the change history
    expect((await history("ordering_orders")).map((h) => h.op)).toContain("update");
  });
});

describe("one supplier list (the demo client stands in for the database)", () => {
  const STAR = 9001;
  const LION = 9002;
  const COKE = 9004;
  const terms = async (venue: number) => (await loadVenueOrdering(sb, venue)).suppliers;

  it("ordering_terms_row makes a venue's terms row from the same supplier at another venue, once", async () => {
    const row = await ensureTermsRow(sb, 8, STAR);
    expect(row).toMatchObject({ venue_id: 8, cost_supplier_id: STAR, name: "Star", method: "email", email_to: "orders@star.example.com", rep_name: "Mark Holden", active: true, show_prices_on_order: false, account_no: null });
    expect((await ensureTermsRow(sb, 8, STAR)).id).toBe(row.id);
    expect((await terms(8)).filter((t) => t.cost_supplier_id === STAR)).toHaveLength(1);
    // another venue's row is untouched
    expect((await terms(1)).find((t) => t.cost_supplier_id === STAR)).toMatchObject({ account_no: "A1001" });
  });
  it("a supplier that is not in the list is refused, not invented", async () => {
    await expect(ensureTermsRow(sb, 8, 424242)).rejects.toMatchObject({ name: "OrderingError", code: "23503" });
  });
  it("renaming the supplier in the list renames it at every venue, and the name cannot be edited on the terms row", async () => {
    await ensureTermsRow(sb, 8, COKE);
    await sb.from("cost_suppliers").update({ name: "Coca-Cola" }).eq("id", COKE);
    try {
      for (const v of [1, 3, 8]) expect((await terms(v)).find((t) => t.cost_supplier_id === COKE)?.name).toBe("Coca-Cola");
      const t = (await terms(8)).find((x) => x.cost_supplier_id === COKE)!;
      const edited = await sb.from("ordering_suppliers").update({ name: "Something Else", notes: "n" }).eq("id", t.id).select("*");
      expect((edited.data as { name: string }[])[0].name).toBe("Coca-Cola");
    } finally {
      await sb.from("cost_suppliers").update({ name: "Coke" }).eq("id", COKE);
    }
    expect((await terms(1)).find((t) => t.cost_supplier_id === COKE)?.name).toBe("Coke");
  });
  it("a product linked to an ingredient takes its supplier from the ingredient, at every venue, and follows it", async () => {
    await insertRow(sb, "cost_ingredients", { id: "ing-keg", name: "Test Keg", supplier_id: LION });
    const cat8 = await createCategory(sb, 8, blankCategory("Kegs"));
    const cat1 = (await loadVenueOrdering(sb, 1)).categories.find((c) => c.name === "Kegs")!;
    const mine = await createProduct(sb, 8, { ...blankProduct(cat8.id, "Test Keg", "keg"), ingredient_id: "ing-keg" });
    const drift = await createProduct(sb, 1, { ...blankProduct(cat1.id, "Test Keg Drift", "keg"), ingredient_id: "ing-keg" });
    const lionAt = async (v: number) => (await terms(v)).find((t) => t.cost_supplier_id === LION)!.id;
    expect(mine.supplier_id).toBe(await lionAt(8));
    expect(drift.supplier_id).toBe(await lionAt(1));

    // the supplier cannot be chosen on a linked product: the ingredient's wins
    const forced = await updateProduct(sb, mine.id, { supplier_id: null });
    expect(forced.supplier_id).toBe(await lionAt(8));

    // change the ingredient's supplier and every venue's product moves with it
    await sb.from("cost_ingredients").update({ supplier_id: STAR }).eq("id", "ing-keg");
    const after = (await loadVenueOrdering(sb, 8)).products.find((p) => p.id === mine.id)!;
    const afterDrift = (await loadVenueOrdering(sb, 1)).products.find((p) => p.id === drift.id)!;
    expect(after.supplier_id).toBe((await terms(8)).find((t) => t.cost_supplier_id === STAR)!.id);
    expect(afterDrift.supplier_id).toBe((await terms(1)).find((t) => t.cost_supplier_id === STAR)!.id);

    // an ingredient with no supplier leaves the product with none
    await sb.from("cost_ingredients").update({ supplier_id: null }).eq("id", "ing-keg");
    expect((await loadVenueOrdering(sb, 8)).products.find((p) => p.id === mine.id)!.supplier_id).toBeNull();
  });
  it("an order-only product has its supplier chosen directly", async () => {
    const cat = (await loadVenueOrdering(sb, 8)).categories.find((c) => c.name === "Kegs")!;
    const straws = await createProduct(sb, 8, blankProduct(cat.id, "Straws", "carton"));
    expect(straws.supplier_id).toBeNull();
    const row = await ensureTermsRow(sb, 8, COKE);
    expect((await updateProduct(sb, straws.id, { supplier_id: row.id })).supplier_id).toBe(row.id);
    expect((await updateProduct(sb, straws.id, { supplier_id: null })).supplier_id).toBeNull();
  });
  it("Copy Products matches suppliers by the supplier, copies the source venue's terms, and never mixes venues", async () => {
    const src = await loadVenueOrdering(sb, 1);
    const empty = await loadVenueOrdering(sb, 9);
    const plan = planVenueCopy(src, empty);
    const result = await copyVenueSetup(sb, 9, plan, { categories: empty.categories, suppliers: empty.suppliers });
    expect(result.suppliers).toBe(plan.suppliers.length);
    const copied = await loadVenueOrdering(sb, 9);
    expect(copied.suppliers.every((t) => t.venue_id === 9)).toBe(true);
    const star = copied.suppliers.find((t) => t.cost_supplier_id === STAR)!;
    expect(star).toMatchObject({ email_to: "orders@star.example.com", show_prices_on_order: true, account_no: null, name: "Star" });
    // every copied product points at the target venue's own terms row for the same supplier
    const vodka = copied.products.find((p) => p.name === "Vodka Bottle")!;
    expect(vodka.supplier_id).toBe(star.id);
    for (const p of copied.products) if (p.supplier_id) expect(copied.suppliers.some((t) => t.id === p.supplier_id)).toBe(true);
    // a second copy has nothing left to add
    expect(copyIsEmpty(planVenueCopy(src, copied))).toBe(true);
  });
});

describe("inserts", () => {
  const fake = () => {
    const sent: unknown[] = [];
    const client = { from: () => ({ insert: (p: unknown) => (sent.push(p), { select: async () => ({ data: [Array.isArray(p) ? p[0] : p], error: null }) }) }) } as unknown as SupabaseClient;
    return { client, sent };
  };
  it("strips null keys so a column default applies", async () => {
    const f = fake();
    await createSupplier(f.client, 1, blankSupplier(5, "X"), "id-1");
    const payload = f.sent[0] as Record<string, unknown>;
    expect(Object.values(payload).some((v) => v === null || v === undefined)).toBe(false);
    expect(payload).toMatchObject({ id: "id-1", venue_id: 1, name: "X", cost_supplier_id: 5, method: "email" });
    expect("min_order_value" in payload).toBe(false);
  });
  it("this file has no raw insert: every insert goes through insertRow/insertRows from lib/store.tsx", () => {
    const src = readFileSync("lib/ordering-data.ts", "utf8").replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(src.match(/\.insert\(/g) ?? []).toHaveLength(0);
    expect(src).toContain('import { insertRow, insertRows, newId } from "./store"');
  });
});

describe("errors", () => {
  const failing = (error: { code?: string; message: string }) => {
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "neq", "order", "limit", "range", "update", "insert", "upsert"]) q[m] = () => q;
    q.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: null, error }).then(ok);
    return { from: () => q } as unknown as SupabaseClient;
  };
  it("a table that does not exist yet reads as Ordering not being set up", async () => {
    const err = await loadVenueOrdering(failing({ code: "42P01", message: 'relation "public.ordering_products" does not exist' }), 1).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OrderingError);
    expect((err as OrderingError).message).toBe(ORDERING_UNAVAILABLE);
    expect((err as OrderingError).code).toBe("missing_table");
  });
  it("other database errors keep their message", async () => {
    await expect(loadCountLines(failing({ code: "XX000", message: "boom" }), "s")).rejects.toThrow("boom");
  });
  it("fixture ids are valid uuids", () => {
    expect(fixtureId("prd", 1, 3)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
