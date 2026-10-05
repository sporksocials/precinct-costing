import { describe, expect, it } from "vitest";
import { countProgress, isCounted, mergeCountEdits } from "@/lib/ordering";
import { countLinesWithQueue, dropSyncedEdits, enqueueCountEdit, readCountQueue, writeCountQueue, type QueueStorage } from "@/lib/ordering-data";
import type { CountEdit, OrderingCountLine, OrderingProduct } from "@/lib/ordering-types";

const prod = (id: string, par: number, over: Partial<OrderingProduct> = {}): OrderingProduct => ({
  id, venue_id: 1, category_id: "c1", sort: 1, name: id, unit_name: "carton", supplier_id: null, supplier_item_code: null, pack_multiple: 1,
  price_inc_gst: null, ingredient_id: null, costing_packs_per_unit: null, par, notes: null, active: true, ...over,
});
const line = (product_id: string, store_qty: number | null, second_qty: number | null, over: Partial<OrderingCountLine> = {}): OrderingCountLine => ({
  id: `l-${product_id}`, venue_id: 1, session_id: "s1", product_id, store_qty, second_qty, counted_by: "a@x.com", counted_at: "2026-10-05T01:00:00.000Z",
  client_uuid: `u-${product_id}`, product_name: product_id, par_at_count: 5, unit_name: "carton", ...over,
});
const edit = (product_id: string, at: string, over: Partial<CountEdit> = {}): CountEdit => ({
  client_uuid: `e-${product_id}-${at}`, session_id: "s1", venue_id: 1, product_id, at, by: "b@x.com", ...over,
});

describe("isCounted", () => {
  it("needs a quantity in at least one place; zero counts", () => {
    expect(isCounted(null)).toBe(false);
    expect(isCounted({ store_qty: null, second_qty: null })).toBe(false);
    expect(isCounted({ store_qty: 0, second_qty: null })).toBe(true);
    expect(isCounted({ store_qty: null, second_qty: 0 })).toBe(true);
  });
});

describe("countProgress", () => {
  const products = [prod("a", 5), prod("b", 5), prod("c", 2), prod("d", 4), prod("gone", 4, { active: false }), prod("w", 4, { category_id: "wine" })];
  it("counts counted against total active products and lists the rest", () => {
    const p = countProgress(products, [{ product_id: "a", store_qty: 3, second_qty: null }, { product_id: "b", store_qty: 0, second_qty: 0 }, { product_id: "gone", store_qty: 1, second_qty: 1 }]);
    expect(p.total).toBe(5);
    expect(p.counted).toBe(2);
    expect(p.uncounted.map((x) => x.id)).toEqual(["c", "d", "w"]);
    expect(p.overPar).toEqual([]);
  });
  it("lists over-par products with how far over", () => {
    const p = countProgress(products, [{ product_id: "c", store_qty: 3, second_qty: 1 }, { product_id: "a", store_qty: 5, second_qty: 0 }]);
    expect(p.overPar).toEqual([{ product: products[2], counted: 4, over: 2 }]);
  });
  it("a line with both places null is not counted", () => {
    expect(countProgress(products, [{ product_id: "a", store_qty: null, second_qty: null }]).counted).toBe(0);
  });
  it("reports products in a two-place category where only one place was counted", () => {
    const p = countProgress(products, [{ product_id: "w", store_qty: 2, second_qty: null }, { product_id: "a", store_qty: 2, second_qty: null }], [
      { id: "wine", second_location_label: "Coldroom" },
      { id: "c1", second_location_label: null },
    ]);
    expect(p.partial).toEqual([{ product: products[5], missing: "second" }]);
  });
  it("an empty venue is 0 of 0", () => {
    expect(countProgress([], [])).toEqual({ total: 0, counted: 0, uncounted: [], overPar: [], partial: [] });
  });
});

describe("mergeCountEdits", () => {
  it("applies an edit to a product with no server line (a new line)", () => {
    const m = mergeCountEdits([], [edit("a", "2026-10-05T02:00:00.000Z", { store_qty: 4, second_qty: 1, product_name: "A", par_at_count: 6, unit_name: "keg" })]);
    expect(m.writes).toEqual([{ venue_id: 1, session_id: "s1", product_id: "a", store_qty: 4, second_qty: 1, counted_by: "b@x.com", counted_at: "2026-10-05T02:00:00.000Z", client_uuid: "e-a-2026-10-05T02:00:00.000Z", product_name: "A", par_at_count: 6, unit_name: "keg" }]);
    expect(m.skipped).toEqual([]);
  });
  it("keeps a place the edit did not touch (undefined), clears with null, and keeps zero distinct from null", () => {
    const server = [line("a", 3, 2)];
    const touchStore = mergeCountEdits(server, [edit("a", "2026-10-05T02:00:00.000Z", { store_qty: 0 })]).writes[0];
    expect(touchStore.store_qty).toBe(0);
    expect(touchStore.second_qty).toBe(2);
    const clear = mergeCountEdits(server, [edit("a", "2026-10-05T02:00:00.000Z", { second_qty: null })]).writes[0];
    expect(clear.store_qty).toBe(3);
    expect(clear.second_qty).toBeNull();
  });
  it("last write wins by the device clock, whatever the queue order", () => {
    const m = mergeCountEdits([], [edit("a", "2026-10-05T03:00:00.000Z", { store_qty: 9 }), edit("a", "2026-10-05T02:00:00.000Z", { store_qty: 4 })]);
    expect(m.writes).toHaveLength(1);
    expect(m.writes[0].store_qty).toBe(9);
    expect(m.writes[0].counted_at).toBe("2026-10-05T03:00:00.000Z");
  });
  it("folds several edits to one product, each touching a different place", () => {
    const m = mergeCountEdits([], [edit("a", "2026-10-05T02:00:00.000Z", { store_qty: 4 }), edit("a", "2026-10-05T02:00:05.000Z", { second_qty: 2 })]);
    expect(m.writes[0]).toMatchObject({ store_qty: 4, second_qty: 2, client_uuid: "e-a-2026-10-05T02:00:05.000Z" });
  });
  it("an edit older than the server line is dropped (someone counted it more recently)", () => {
    const m = mergeCountEdits([line("a", 3, 2, { counted_at: "2026-10-05T05:00:00.000Z" })], [edit("a", "2026-10-05T04:00:00.000Z", { store_qty: 9 })]);
    expect(m.writes).toEqual([]);
    expect(m.skipped).toEqual(["e-a-2026-10-05T04:00:00.000Z"]);
    expect(m.lines[0].store_qty).toBe(3);
  });
  it("a newer edit beats the server line", () => {
    const m = mergeCountEdits([line("a", 3, 2, { counted_at: "2026-10-05T01:00:00.000Z" })], [edit("a", "2026-10-05T04:00:00.000Z", { store_qty: 9 })]);
    expect(m.writes[0]).toMatchObject({ store_qty: 9, second_qty: 2 });
  });
  it("is idempotent: the same client_uuid is not applied twice, and re-merging the result changes nothing", () => {
    const e = edit("a", "2026-10-05T04:00:00.000Z", { store_qty: 9 });
    const first = mergeCountEdits([], [e, e]);
    expect(first.writes).toHaveLength(1);
    expect(first.skipped).toEqual([e.client_uuid]);
    // the server now holds what was written; the retry of the same edit does nothing
    const saved: OrderingCountLine = { id: "x", ...(first.writes[0] as Omit<OrderingCountLine, "id">) };
    const again = mergeCountEdits([saved], [e]);
    expect(again.writes).toEqual([]);
    expect(again.skipped).toEqual([e.client_uuid]);
    // and an earlier edit from the same queue is also dropped once a later one is saved
    const early = edit("a", "2026-10-05T03:00:00.000Z", { store_qty: 1 });
    expect(mergeCountEdits([saved], [early]).writes).toEqual([]);
  });
  it("two products are independent", () => {
    const m = mergeCountEdits([line("b", 1, 1)], [edit("a", "2026-10-05T02:00:00.000Z", { store_qty: 4 })]);
    expect(m.writes.map((w) => w.product_id)).toEqual(["a"]);
    expect(m.lines.map((l) => l.product_id).sort()).toEqual(["a", "b"]);
  });
  it("edits in two sessions never mix", () => {
    const m = mergeCountEdits([], [edit("a", "2026-10-05T02:00:00.000Z", { store_qty: 4 }), edit("a", "2026-10-05T03:00:00.000Z", { store_qty: 7, session_id: "s2" })]);
    expect(m.writes.map((w) => [w.session_id, w.store_qty]).sort()).toEqual([["s1", 4], ["s2", 7]]);
  });
  it("does not change its inputs", () => {
    const server = [line("a", 3, 2)];
    const snapshot = JSON.stringify(server);
    mergeCountEdits(server, [edit("a", "2026-10-05T04:00:00.000Z", { store_qty: 9 })]);
    expect(JSON.stringify(server)).toBe(snapshot);
  });
  it("shows the queue on top of the server lines for the screen", () => {
    const view = countLinesWithQueue([line("a", 3, 2)], [edit("a", "2026-10-05T04:00:00.000Z", { store_qty: 9 })]);
    expect(view.find((l) => l.product_id === "a")?.store_qty).toBe(9);
  });
});

describe("the device queue", () => {
  const memory = (): QueueStorage & { data: Record<string, string> } => {
    const data: Record<string, string> = {};
    return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => void (data[k] = v) };
  };
  it("saves every tap to the device first and keeps venues apart", () => {
    const s = memory();
    const a = enqueueCountEdit(s, 1, { session_id: "s1", venue_id: 1, product_id: "a", store_qty: 2, at: "2026-10-05T04:00:00.000Z", by: "a@x.com" });
    expect(a.saved).toBe(true);
    expect(a.queue[0].client_uuid).toMatch(/^[0-9a-f-]{36}$/);
    enqueueCountEdit(s, 3, { session_id: "s9", venue_id: 3, product_id: "z", store_qty: 1, at: "2026-10-05T04:00:00.000Z", by: "a@x.com" });
    expect(readCountQueue(s, 1)).toHaveLength(1);
    expect(readCountQueue(s, 3)).toHaveLength(1);
  });
  it("drops only the edits that were synced", () => {
    const s = memory();
    const e1 = enqueueCountEdit(s, 1, { session_id: "s1", venue_id: 1, product_id: "a", store_qty: 2, at: "2026-10-05T04:00:00.000Z", by: null }).queue[0];
    const e2 = enqueueCountEdit(s, 1, { session_id: "s1", venue_id: 1, product_id: "b", store_qty: 1, at: "2026-10-05T04:00:01.000Z", by: null }).queue[1];
    expect(dropSyncedEdits(s, 1, [e1]).map((e) => e.client_uuid)).toEqual([e2.client_uuid]);
  });
  it("never throws: missing, broken or full storage", () => {
    expect(readCountQueue(null, 1)).toEqual([]);
    const broken: QueueStorage = { getItem: () => "{not json", setItem: () => undefined };
    expect(readCountQueue(broken, 1)).toEqual([]);
    const full: QueueStorage = { getItem: () => null, setItem: () => { throw new Error("quota"); } };
    expect(writeCountQueue(full, 1, [])).toBe(false);
    expect(enqueueCountEdit(full, 1, { session_id: "s", venue_id: 1, product_id: "a", at: "2026-10-05T04:00:00.000Z", by: null }).saved).toBe(false);
    expect(writeCountQueue(null, 1, [])).toBe(false);
  });
});
