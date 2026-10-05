import { describe, expect, it } from "vitest";
import {
  MAX_QTY,
  activeCategory,
  cacheUsable,
  categoryAnchor,
  categoryJumps,
  coalesceEdit,
  filterGroups,
  finaliseBlock,
  normaliseQuery,
  openOrLast,
  parseQtyText,
  placeState,
  productSubline,
  progressPercent,
  progressText,
  qtyBoxText,
  queueSessions,
  retryDelayMs,
  reviewLists,
  rowAnchor,
  rowStatus,
  sanitiseQtyText,
  stepQty,
  syncStatus,
  unitPlural,
  whenText,
  type CountCache,
  type RowQty,
} from "@/lib/ordering-count-ui";
import { groupProductsByCategory } from "@/lib/ordering";
import { countLinesWithQueue, dropSyncedEdits, enqueueCountEdit, readCountQueue } from "@/lib/ordering-data";
import { createQueueStorage } from "@/lib/ordering-count-device";
import { orderingWorkerSource } from "@/lib/ordering-sw-source";
import type { CountEdit, OrderingCategory, OrderingCountSession, OrderingProduct } from "@/lib/ordering-types";

const cat = (id: string, sort: number, name: string, second: string | null = null): OrderingCategory => ({ id, venue_id: 1, name, sort, second_location_label: second, unit_name: "carton" });
const prod = (id: string, category_id: string, sort: number, par: number, over: Partial<OrderingProduct> = {}): OrderingProduct => ({
  id, venue_id: 1, category_id, sort, name: id, unit_name: "carton", supplier_id: null, supplier_item_code: null, pack_multiple: 1,
  price_inc_gst: null, ingredient_id: null, costing_packs_per_unit: null, par, notes: null, active: true, ...over,
});
const categories = [cat("c1", 1, "Kegs", "Coldroom"), cat("c2", 2, "Post-Mix")];
const products = [prod("Pale Ale", "c1", 1, 4, { unit_name: "keg" }), prod("Lager", "c1", 2, 6), prod("Coke Bag", "c2", 1, 3, { unit_name: "bag" }), prod("Lift Bag", "c2", 2, 2, { unit_name: "bag" })];
const qty = (entries: [string, number | null, number | null][]): Map<string, RowQty> => new Map(entries.map(([id, store, second]) => [id, { store, second }]));
const edit = (over: Partial<CountEdit> = {}): CountEdit => ({ client_uuid: "u1", session_id: "s1", venue_id: 1, product_id: "Lager", at: "2026-10-05T01:00:00.000Z", by: "a@x.com", ...over });

describe("the three states of a place", () => {
  it("not counted, zero and counted are different", () => {
    expect(placeState(null)).toBe("untouched");
    expect(placeState(undefined)).toBe("untouched");
    expect(placeState(0)).toBe("zero");
    expect(placeState(3)).toBe("counted");
  });
  it("a zero is only ever a deliberate act: minus never makes one from not counted, plus starts at 1", () => {
    expect(stepQty(null, -1)).toBeNull();
    expect(stepQty(null, 1)).toBe(1);
    expect(stepQty(1, -1)).toBe(0); // tap minus from 1
    expect(stepQty(0, -1)).toBe(0);
    expect(stepQty(0, 1)).toBe(1);
    expect(stepQty(MAX_QTY, 1)).toBe(MAX_QTY);
  });
  it("typed text: digits only, 0 is a zero, empty clears, junk is refused", () => {
    expect(parseQtyText("12")).toBe(12);
    expect(parseQtyText("0")).toBe(0);
    expect(parseQtyText("")).toBeNull();
    expect(parseQtyText("  ")).toBeNull();
    expect(parseQtyText("2.5")).toBeUndefined();
    expect(parseQtyText("-3")).toBeUndefined();
    expect(parseQtyText("99999")).toBeUndefined();
    expect(sanitiseQtyText("1a2.5")).toBe("125");
    expect(sanitiseQtyText("007")).toBe("7");
    expect(sanitiseQtyText("0")).toBe("0");
    expect(sanitiseQtyText("123456")).toBe("1234");
  });
  it("the number box is empty for not counted and shows 0 for a zero", () => {
    expect(qtyBoxText(null)).toBe("");
    expect(qtyBoxText(0)).toBe("0");
    expect(qtyBoxText(7)).toBe("7");
  });
});

describe("labels", () => {
  it("pluralises the product's unit", () => {
    expect(unitPlural("carton")).toBe("Cartons");
    expect(unitPlural("keg")).toBe("Kegs");
    expect(unitPlural("bag")).toBe("Bags");
    expect(unitPlural("bottle")).toBe("Bottles");
    expect(unitPlural("box")).toBe("Boxes");
    expect(unitPlural("cartons")).toBe("Cartons");
    expect(unitPlural("")).toBe("Units");
    expect(unitPlural(null)).toBe("Units");
  });
  it("shows the unit and Build To as the small line", () => {
    expect(productSubline({ unit_name: "keg", par: 4 })).toBe("Kegs, Build To 4");
  });
  it("has no em or en dashes in any screen text it builds", () => {
    const text = [syncStatus({ online: false, pending: 3, syncing: false, failed: false }).text, syncStatus({ online: true, pending: 2, syncing: false, failed: true }).text, finaliseBlock({ online: false, pending: 1, syncing: false }), finaliseBlock({ online: true, pending: 2, syncing: false }), progressText(1, 2)].join(" ");
    expect(text).not.toMatch(/[—–]/);
  });
});

describe("row status", () => {
  it("is uncounted until a place is touched, and a zero counts", () => {
    expect(rowStatus(undefined, null)).toEqual({ state: "uncounted", total: null, blank: null });
    expect(rowStatus({ store: null, second: null }, "Coldroom").state).toBe("uncounted");
    expect(rowStatus({ store: 0, second: null }, null)).toEqual({ state: "counted", total: 0, blank: null });
  });
  it("totals both places and names the blank one in a two-place category", () => {
    expect(rowStatus({ store: 2, second: 3 }, "Coldroom")).toEqual({ state: "counted", total: 5, blank: null });
    expect(rowStatus({ store: 2, second: null }, "Coldroom")).toEqual({ state: "counted", total: 2, blank: "Coldroom" });
    expect(rowStatus({ store: null, second: 2 }, "Bar")).toEqual({ state: "counted", total: 2, blank: "Store" });
    expect(rowStatus({ store: 2, second: null }, null).blank).toBeNull();
  });
});

describe("progress and the status line", () => {
  it("reads 42 of 181 counted", () => {
    expect(progressText(42, 181)).toBe("42 of 181 counted");
    expect(progressPercent(42, 181)).toBe(23);
    expect(progressPercent(0, 0)).toBe(0);
    expect(progressPercent(5, 4)).toBe(100);
  });
  it("says Saved, Saving..., or Offline with the number waiting", () => {
    expect(syncStatus({ online: true, pending: 0, syncing: false, failed: false })).toEqual({ kind: "saved", text: "Saved" });
    expect(syncStatus({ online: true, pending: 3, syncing: false, failed: false })).toEqual({ kind: "saving", text: "Saving..." });
    expect(syncStatus({ online: true, pending: 0, syncing: true, failed: false })).toEqual({ kind: "saving", text: "Saving..." });
    expect(syncStatus({ online: false, pending: 3, syncing: false, failed: false })).toEqual({ kind: "offline", text: "Offline: 3 changes waiting to sync" });
    expect(syncStatus({ online: false, pending: 1, syncing: false, failed: true }).text).toBe("Offline: 1 change waiting to sync");
    expect(syncStatus({ online: false, pending: 0, syncing: false, failed: false }).kind).toBe("offline");
  });
  it("online but failing reads as retrying, not as saved", () => {
    expect(syncStatus({ online: true, pending: 2, syncing: false, failed: true })).toEqual({ kind: "retrying", text: "Not synced yet: 2 changes. Retrying" });
    expect(syncStatus({ online: true, pending: 2, syncing: true, failed: true }).kind).toBe("saving");
  });
  it("backs off 4, 8, 16 seconds then every 30", () => {
    expect([0, 1, 2, 3, 9].map(retryDelayMs)).toEqual([4000, 8000, 16000, 30000, 30000]);
  });
  it("finalise refuses while changes wait to sync or the device is offline, and says so", () => {
    expect(finaliseBlock({ online: true, pending: 0, syncing: false })).toBeNull();
    expect(finaliseBlock({ online: true, pending: 3, syncing: false })).toMatch(/3 changes still saving/);
    expect(finaliseBlock({ online: true, pending: 0, syncing: true })).toMatch(/1 change still saving/);
    expect(finaliseBlock({ online: false, pending: 0, syncing: false })).toMatch(/offline/i);
  });
});

describe("filters, jumps and the review lists", () => {
  const groups = groupProductsByCategory(products, categories);
  const none = new Set<string>();
  it("groups by category in the saved order, products in order", () => {
    expect(groups.map((g) => [g.category.id, g.products.map((p) => p.id)])).toEqual([["c1", ["Pale Ale", "Lager"]], ["c2", ["Coke Bag", "Lift Bag"]]]);
  });
  it("search matches the product name, case blind, and drops empty categories", () => {
    const f = filterGroups(groups, qty([]), { query: "  BAG ", uncountedOnly: false, pinned: none });
    expect(f.map((g) => g.category.id)).toEqual(["c2"]);
    expect(f[0].products).toHaveLength(2);
    expect(normaliseQuery("  Pale   Ale ")).toBe("pale ale");
  });
  it("Show Uncounted keeps rows with nothing counted, a zero counts as counted, and pinned rows stay", () => {
    const q = qty([["Pale Ale", 0, null], ["Lager", null, null], ["Coke Bag", 2, null]]);
    const ids = (pinned: Set<string>) => filterGroups(groups, q, { query: "", uncountedOnly: true, pinned }).flatMap((g) => g.products.map((p) => p.id));
    expect(ids(none)).toEqual(["Lager", "Lift Bag"]);
    expect(ids(new Set(["Coke Bag"]))).toEqual(["Lager", "Coke Bag", "Lift Bag"]);
  });
  it("jump chips carry how many of each category are counted, over all its products", () => {
    const j = categoryJumps(groups, qty([["Pale Ale", 0, null], ["Coke Bag", 1, null]]));
    expect(j).toEqual([{ id: "c1", name: "Kegs", counted: 1, total: 2 }, { id: "c2", name: "Post-Mix", counted: 1, total: 2 }]);
  });
  it("names the elements the screen scrolls to", () => {
    expect(categoryAnchor("c1")).toBe("count-cat-c1");
    expect(rowAnchor("p9")).toBe("count-row-p9");
  });
  it("the scroll spy picks the last category whose top has reached the header, else the first", () => {
    const tops = [{ id: "a", top: -400 }, { id: "b", top: 40 }, { id: "c", top: 900 }];
    expect(activeCategory(tops, 160)).toBe("b");
    expect(activeCategory(tops, 20)).toBe("a");
    expect(activeCategory([{ id: "a", top: 300 }], 100)).toBe("a");
    expect(activeCategory([], 100)).toBeNull();
  });
  it("the review lists what is uncounted in shelf order, what is over par, and one-place-blank products", () => {
    const l = reviewLists(products, categories, qty([["Pale Ale", 5, 1], ["Lager", 2, null], ["Coke Bag", 0, null]]));
    expect(l.total).toBe(4);
    expect(l.counted).toBe(3);
    expect(l.uncounted.map((r) => r.product.id)).toEqual(["Lift Bag"]);
    expect(l.uncounted[0].categoryName).toBe("Post-Mix");
    expect(l.overPar).toHaveLength(1);
    expect(l.overPar[0]).toMatchObject({ counted: 6, over: 2 });
    expect(l.partial).toHaveLength(1);
    expect(l.partial[0]).toMatchObject({ missing: "Coldroom" });
    expect(l.partial[0].product.id).toBe("Lager");
  });
});

describe("the device queue", () => {
  it("folds a burst of taps on one product into one waiting edit, with a NEW uuid each time", () => {
    let n = 0;
    const fresh = () => `n${++n}`;
    let q: CountEdit[] = [];
    for (let i = 1; i <= 5; i++) q = coalesceEdit(q, edit({ client_uuid: `t${i}`, store_qty: i, at: `2026-10-05T01:00:0${i}.000Z` }), new Set(), fresh);
    expect(q).toHaveLength(1);
    expect(q[0]).toMatchObject({ store_qty: 5, at: "2026-10-05T01:00:05.000Z" });
    expect(q[0].client_uuid).toBe("n4"); // the first tap is queued as is, each later fold gets a new uuid
  });
  it("keeps the other place when only one place is tapped", () => {
    const q = coalesceEdit([edit({ client_uuid: "a", store_qty: 3 })], edit({ client_uuid: "b", second_qty: 2 }), new Set(), () => "x");
    expect(q).toHaveLength(1);
    expect(q[0]).toMatchObject({ store_qty: 3, second_qty: 2 });
  });
  it("never folds into an edit that is already on its way to the database", () => {
    const q = coalesceEdit([edit({ client_uuid: "a", store_qty: 3 })], edit({ client_uuid: "b", store_qty: 4 }), new Set(["a"]), () => "x");
    expect(q.map((e) => e.client_uuid)).toEqual(["a", "b"]);
  });
  it("keeps different products and sessions apart", () => {
    const q = coalesceEdit([edit({ client_uuid: "a" })], edit({ client_uuid: "b", product_id: "Pale Ale", store_qty: 1 }), new Set(), () => "x");
    expect(q).toHaveLength(2);
    expect(queueSessions([edit(), edit({ session_id: "s2", client_uuid: "z" }), edit({ client_uuid: "y" })]).sort()).toEqual(["s1", "s2"]);
  });
  it("zero and cleared stay distinct all the way through the queue and the merge", () => {
    const st = createQueueStorage(null);
    enqueueCountEdit(st, 1, { session_id: "s1", venue_id: 1, product_id: "Lager", store_qty: 0, at: "2026-10-05T01:00:00.000Z", by: "a@x.com" });
    enqueueCountEdit(st, 1, { session_id: "s1", venue_id: 1, product_id: "Pale Ale", store_qty: null, at: "2026-10-05T01:00:01.000Z", by: "a@x.com" });
    const lines = countLinesWithQueue([], readCountQueue(st, 1));
    const byId = new Map(lines.map((l) => [l.product_id, l]));
    expect(byId.get("Lager")?.store_qty).toBe(0);
    expect(byId.get("Pale Ale")?.store_qty).toBeNull();
  });
  it("a blocked or full device keeps the queue in memory and says so", () => {
    const broken = { getItem: () => null, setItem: () => { throw new Error("full"); }, removeItem: () => {} };
    const st = createQueueStorage(broken);
    expect(st.degraded()).toBe(false);
    const { queue, saved } = enqueueCountEdit(st, 1, { session_id: "s1", venue_id: 1, product_id: "Lager", store_qty: 2, at: "2026-10-05T01:00:00.000Z", by: null });
    expect(saved).toBe(true); // the in-memory copy took it
    expect(st.degraded()).toBe(true);
    expect(readCountQueue(st, 1)).toEqual(queue);
    dropSyncedEdits(st, 1, queue);
    expect(readCountQueue(st, 1)).toEqual([]);
  });
  it("with working storage the queue is in localStorage and survives a reload (a new storage object reads it back)", () => {
    const map = new Map<string, string>();
    const ls = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), removeItem: (k: string) => void map.delete(k) };
    enqueueCountEdit(createQueueStorage(ls), 1, { session_id: "s1", venue_id: 1, product_id: "Lager", store_qty: 4, at: "2026-10-05T01:00:00.000Z", by: null });
    const again = createQueueStorage(ls);
    expect(readCountQueue(again, 1)).toHaveLength(1);
    expect(again.degraded()).toBe(false);
  });
});

describe("the offline copy", () => {
  const cache: CountCache = { v: 1, email: "Troy@Example.com", venueId: 1, savedAt: "2026-10-05T01:00:00.000Z", categories, products, sessions: [], sessionId: null, lines: [] };
  it("is only shown to the person it was saved for, for the same venue", () => {
    expect(cacheUsable(cache, "troy@example.com", 1)).toBe(true);
    expect(cacheUsable(cache, "someone@else.com", 1)).toBe(false);
    expect(cacheUsable(cache, "troy@example.com", 3)).toBe(false);
    expect(cacheUsable(cache, null, 1)).toBe(false);
    expect(cacheUsable(null, "troy@example.com", 1)).toBe(false);
    expect(cacheUsable({ ...cache, v: 2 as unknown as 1 }, "troy@example.com", 1)).toBe(false);
  });
});

describe("sessions and dates", () => {
  const s = (id: string, status: "in_progress" | "finalised", started: string, finalised: string | null = null): OrderingCountSession => ({ id, venue_id: 1, started_by: null, started_at: started, status, finalised_by: null, finalised_at: finalised, note: null, source: null });
  it("finds the open count and the latest finalised one", () => {
    const { open, last } = openOrLast([s("a", "finalised", "2026-09-21T00:00:00Z", "2026-09-21T01:00:00Z"), s("b", "finalised", "2026-09-28T00:00:00Z", "2026-09-28T01:00:00Z"), s("c", "in_progress", "2026-10-05T00:00:00Z")]);
    expect(open?.id).toBe("c");
    expect(last?.id).toBe("b");
    expect(openOrLast([])).toEqual({ open: null, last: null });
  });
  it("writes the time in Brisbane", () => {
    expect(whenText("2026-10-05T23:12:00.000Z")).toMatch(/Tue/); // 9:12 am Tuesday in Brisbane
    expect(whenText(null)).toBe("");
  });
});

describe("the service worker source", () => {
  const src = orderingWorkerSource();
  it("is valid script", () => {
    expect(() => new Function(src)).not.toThrow();
  });
  it("saves only the count page and built files, never an API reply or data", () => {
    expect(src).toContain("COUNT_PAGE");
    expect(src).not.toContain("/api");
    expect(src).not.toContain("supabase");
    expect(src).toContain('const SCOPE = "/ordering"');
  });
  it("never saves a sign-in redirect, and forgets the saved shell when the person is signed out", () => {
    expect(src).toContain("redirected");
    expect(src).toContain("opaqueredirect");
    expect(src).toContain("cache.delete(key)");
  });
  it("leaves every non-GET and every other origin alone", () => {
    expect(src).toContain('request.method !== "GET"');
    expect(src).toContain("url.origin !== self.location.origin");
  });
});
