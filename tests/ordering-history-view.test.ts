import { describe, expect, it } from "vitest";
import {
  changeBetween,
  changeSummary,
  countAsText,
  countDetailGroups,
  countHeadline,
  countWho,
  dayLabel,
  dayLabelFull,
  dayTimeLabel,
  lastCountLine,
  orderListRows,
  previousSession,
  productStory,
  sessionRows,
  storySummary,
  tallyBySession,
  timeLabel,
  totalsByProduct,
  withChanges,
} from "@/lib/ordering-history-view";
import { orderingFixture } from "@/lib/ordering-fixture";
import type { OrderingCountLine, OrderingCountSession, OrderingOrder, OrderingOrderLine, OrderingProduct } from "@/lib/ordering-types";

const NOW = new Date("2026-10-05T02:00:00Z");
const nameOf = (e: string | null | undefined) => (e === "matt@x.com" ? "Matt" : e ? e.split("@")[0] : null);
const fx = orderingFixture(1);
const [keg, paleAle, ginger, lager, seltzer, sauv, prosecco, bourbon] = fx.products;

const session = (id: string, started: string, over: Partial<OrderingCountSession> = {}): OrderingCountSession => ({
  id, venue_id: 1, started_by: "matt@x.com", started_at: started, status: "finalised", finalised_by: "matt@x.com", finalised_at: started, note: null, source: null, ...over,
});
const line = (session_id: string, p: OrderingProduct, store: number | null, second: number | null, over: Partial<OrderingCountLine> = {}): OrderingCountLine => ({
  id: `${session_id}-${p.id}`, venue_id: 1, session_id, product_id: p.id, store_qty: store, second_qty: second, counted_by: "matt@x.com", counted_at: null, client_uuid: null,
  product_name: p.name, par_at_count: p.par, unit_name: p.unit_name, ...over,
});

describe("Brisbane dates", () => {
  it("shows the Brisbane day, whatever the machine's time zone", () => {
    // 14:30 UTC on Sunday 27 Sep is already Monday 28 Sep, 00:30 in Brisbane
    expect(dayLabel("2026-09-27T14:30:00Z", NOW)).toBe("Mon 28 Sep");
    expect(timeLabel("2026-09-27T14:30:00Z")).toBe("12:30 am");
    expect(timeLabel("2026-09-28T02:05:00Z")).toBe("12:05 pm");
    expect(timeLabel("2026-09-28T00:00:00Z")).toBe("10:00 am");
    expect(dayTimeLabel("2026-09-28T00:00:00Z", NOW)).toBe("Mon 28 Sep, 10:00 am");
  });
  it("adds the year only when it is not this year", () => {
    expect(dayLabel("2025-12-29T00:00:00Z", NOW)).toBe("Mon 29 Dec 2025");
    expect(dayLabelFull("2026-09-28T00:00:00Z")).toBe("Mon 28 Sep 2026");
  });
  it("a missing or broken date is empty text, not Invalid Date", () => {
    expect(dayLabel(null)).toBe("");
    expect(dayLabel("nope")).toBe("");
    expect(timeLabel(undefined)).toBe("");
  });
});

describe("the Counts list", () => {
  const s1 = session("s1", "2026-09-21T00:00:00Z");
  const s2 = session("s2", "2026-09-28T00:00:00Z", { source: "sheet-import" });
  const s3 = session("s3", "2026-10-05T00:00:00Z", { status: "in_progress", finalised_by: null, finalised_at: null });
  it("who counted: the sheet import by name, otherwise the person", () => {
    expect(countWho(s2, nameOf)).toBe("Sheet import");
    expect(countWho(s1, nameOf)).toBe("Matt");
    expect(countWho(session("x", "2026-01-01T00:00:00Z", { started_by: null, finalised_by: null }), nameOf)).toBe("Not recorded");
  });
  it("tallies count only lines with a quantity in a place, per session", () => {
    const t = tallyBySession([
      { session_id: "s1", store_qty: 1, second_qty: null },
      { session_id: "s1", store_qty: 0, second_qty: 0 },
      { session_id: "s1", store_qty: null, second_qty: null },
      { session_id: "s2", store_qty: null, second_qty: 2 },
    ]);
    expect(t.get("s1")).toBe(2);
    expect(t.get("s2")).toBe(1);
    expect(t.get("s3")).toBeUndefined();
  });
  it("rows come newest first with counted of total and the status in words", () => {
    const rows = sessionRows([s1, s3, s2], new Map([["s1", 10], ["s2", 12], ["s3", 4]]), 12, nameOf, NOW);
    expect(rows.map((r) => r.id)).toEqual(["s3", "s2", "s1"]);
    expect(rows[0]).toMatchObject({ inProgress: true, statusLabel: "In Progress", progressLabel: "4 of 12 counted", who: "Matt" });
    expect(rows[1]).toMatchObject({ who: "Sheet import", statusLabel: "Finalised", dateLabel: "Mon 28 Sep" });
  });
  it("counted never exceeds total, and an unloaded tally shows no progress text", () => {
    expect(sessionRows([s1], new Map([["s1", 20]]), 12, nameOf, NOW)[0].total).toBe(20);
    expect(sessionRows([s1], null, 12, nameOf, NOW)[0]).toMatchObject({ counted: null, progressLabel: "" });
  });
  it("finds the count before a given one", () => {
    expect(previousSession([s1, s2, s3], "s3")?.id).toBe("s2");
    expect(previousSession([s1, s2, s3], "s1")).toBeNull();
    expect(previousSession([s1], "missing")).toBeNull();
  });
  it("the home status line", () => {
    expect(lastCountLine(s2, nameOf, NOW)).toBe("Last count: Mon 28 Sep, by Sheet import");
    expect(lastCountLine(null, nameOf)).toBe("No count yet");
  });
});

describe("a count's detail", () => {
  const lines = [line("s", keg, 4, 1), line("s", paleAle, 1, 0), line("s", ginger, 2, 2), line("s", lager, 0, 0, { par_at_count: 10 })];
  const groups = countDetailGroups({ products: fx.products, categories: fx.categories, lines });
  const all = groups.flatMap((g) => g.rows);
  const row = (name: string) => all.find((r) => r.name === name)!;

  it("groups by category in shelf order and includes uncounted active products", () => {
    expect(groups.map((g) => g.name)).toEqual(["Kegs", "Beer & RTD", "Wine", "Spirits", "Post-Mix", "Soft Drink"]);
    expect(groups[0].secondLabel).toBe("Coldroom");
    expect(groups[4].secondLabel).toBeNull();
    expect(all).toHaveLength(fx.products.length);
    expect(row("Seltzer Cans").state).toBe("Not Counted");
    expect(row("Seltzer Cans")).toMatchObject({ total: null, suggested: 0 });
  });
  it("shows the Build To the product had at the count, not today's", () => {
    // Lager Cans par is 8 now but the snapshot says 10: 10 - 0 = order 10
    expect(row("Lager Cans")).toMatchObject({ par: 10, suggested: 10, state: "Below Build To" });
  });
  it("states: below, at and over Build To in words", () => {
    expect(row("XXXX Gold Keg")).toMatchObject({ total: 5, par: 6, suggested: 1, state: "Below Build To" });
    expect(row("Ginger Beer Keg")).toMatchObject({ total: 4, par: 3, suggested: 0, over: 1, state: "Over Build To" });
    const at = countDetailGroups({ products: fx.products, categories: fx.categories, lines: [line("s", paleAle, 3, 1)] }).flatMap((g) => g.rows).find((r) => r.name === "Pale Ale Keg")!;
    expect(at).toMatchObject({ total: 4, state: "At Build To", suggested: 0, over: 0 });
  });
  it("the suggestion rounds up to the pack multiple, as the order screen does", () => {
    const g = countDetailGroups({ products: fx.products, categories: fx.categories, lines: [line("s", bourbon, 5, 1)] });
    // par 18, counted 6, need 12, multiple 6 -> 12
    expect(g.flatMap((x) => x.rows).find((r) => r.name === "Bourbon Bottle")?.suggested).toBe(12);
  });
  it("uses the name and unit written at the count", () => {
    const r = countDetailGroups({ products: fx.products, categories: fx.categories, lines: [line("s", keg, 1, 0, { product_name: "XXXX Gold Keg (old name)" })] }).flatMap((g) => g.rows)[0];
    expect(r.name).toBe("XXXX Gold Keg (old name)");
  });
  it("a product switched off since still shows if it was counted, and is left out if it was not", () => {
    const off = fx.products.map((p) => (p.id === keg.id || p.id === seltzer.id ? { ...p, active: false } : p));
    const rows = countDetailGroups({ products: off, categories: fx.categories, lines: [line("s", keg, 2, 0)] }).flatMap((g) => g.rows);
    expect(rows.find((r) => r.name === "XXXX Gold Keg")?.inactive).toBe(true);
    expect(rows.find((r) => r.name === "Seltzer Cans")).toBeUndefined();
  });
  it("the headline adds the whole count up", () => {
    const h = countHeadline(groups);
    expect(h.counted).toBe(4);
    expect(h.uncounted).toBe(fx.products.length - 4);
    expect(h.below).toBe(3);
    expect(h.over).toBe(1);
    expect(h.suggestedUnits).toBe(14);
  });
});

describe("Compare To Previous Count", () => {
  it("up, down and same come with words and an arrow, not colour", () => {
    expect(changeBetween(5, 2)).toEqual({ kind: "up", delta: 3, prev: 2, word: "Up 3", arrow: "↑" });
    expect(changeBetween(1, 4)).toMatchObject({ kind: "down", delta: -3, word: "Down 3", arrow: "↓" });
    expect(changeBetween(2, 2)).toMatchObject({ kind: "same", word: "No change", arrow: "=" });
    expect(changeBetween(0, 3)).toMatchObject({ kind: "down", word: "Down 3" });
  });
  it("a product counted in only one of the two says so", () => {
    expect(changeBetween(2, null)).toMatchObject({ kind: "new", word: "Not counted last time" });
    expect(changeBetween(null, 4)).toMatchObject({ kind: "gone", word: "Not counted this time (was 4)" });
    expect(changeBetween(null, null).kind).toBe("none");
  });
  it("a zero is a real count: 0 against 0 is no change, not missing", () => {
    expect(changeBetween(0, 0)).toMatchObject({ kind: "same" });
  });
  it("totals by product ignore uncounted lines", () => {
    const t = totalsByProduct([line("p", keg, 4, 1), line("p", paleAle, null, null), line("p", ginger, 0, 0)]);
    expect(t.get(keg.id)).toBe(5);
    expect(t.get(paleAle.id)).toBeNull();
    expect(t.get(ginger.id)).toBe(0);
  });
  it("withChanges fills every row and the summary counts them", () => {
    const now = countDetailGroups({ products: fx.products, categories: fx.categories, lines: [line("s", keg, 4, 1), line("s", paleAle, 0, 0), line("s", ginger, 2, 2)] });
    const before = [line("p", keg, 2, 0), line("p", paleAle, 1, 1), line("p", ginger, 2, 2), line("p", lager, 3, 0)];
    const out = withChanges(now, before);
    const by = Object.fromEntries(out.flatMap((g) => g.rows).map((r) => [r.name, r.change?.kind]));
    expect(by["XXXX Gold Keg"]).toBe("up");
    expect(by["Pale Ale Keg"]).toBe("down");
    expect(by["Ginger Beer Keg"]).toBe("same");
    expect(by["Lager Cans"]).toBe("gone");
    expect(by["Seltzer Cans"]).toBe("none");
    expect(changeSummary(out)).toEqual({ up: 1, down: 1, same: 1 });
  });
});

describe("Copy As Text", () => {
  const groups = countDetailGroups({ products: fx.products, categories: fx.categories, lines: [line("s", keg, 4, 1), line("s", ginger, 2, 2), line("s", bourbon, 5, 1)] }).filter((g) => ["Kegs", "Spirits"].includes(g.name));
  it("is plain text with the venue, date, who, and one line per product", () => {
    const text = countAsText({ venueName: "Drift", dateLabel: "Mon 28 Sep 2026", who: "Matt", status: "Finalised", groups, compare: false });
    const lines = text.split("\n");
    expect(lines[0]).toBe("Drift stock count, Mon 28 Sep 2026");
    expect(lines[1]).toBe("Counted by Matt (Finalised)");
    expect(text).toContain("KEGS");
    expect(text).toContain("XXXX Gold Keg: Store 4, Coldroom 1, total 5 keg | Build To 6 | order 1");
    expect(text).toContain("Ginger Beer Keg: Store 2, Coldroom 2, total 4 keg | Build To 3 | over by 1");
    expect(text).toContain("Bourbon Bottle: Store 5, Bar 1, total 6 bottle | Build To 18 | order 12");
    expect(text).toContain("Pale Ale Keg: not counted");
    expect(text).not.toMatch(/[—–]/);
  });
  it("with Compare on, each line ends with the change", () => {
    const withCh = withChanges(groups, [line("p", keg, 2, 0)]);
    const text = countAsText({ venueName: "Drift", dateLabel: "x", who: "Matt", status: "Finalised", groups: withCh, compare: true, previousLabel: "Mon 21 Sep 2026" });
    expect(text).toContain("Compared to the count on Mon 21 Sep 2026");
    expect(text).toContain("order 1 | Up 3");
  });
  it("says so when there is nothing to compare to", () => {
    expect(countAsText({ venueName: "Drift", dateLabel: "x", who: "Matt", status: "Finalised", groups: [], compare: true, previousLabel: null })).toContain("No earlier count to compare to");
  });
});

describe("a product's story across weeks", () => {
  // Pale Ale Keg: par 4
  const sessions = [
    session("s1", "2026-09-14T00:00:00Z"),
    session("s2", "2026-09-21T00:00:00Z"),
    session("s3", "2026-09-28T00:00:00Z"),
    session("s4", "2026-10-05T00:00:00Z"),
    session("s5", "2026-10-12T00:00:00Z", { status: "in_progress", finalised_by: null, finalised_at: null }),
  ];
  const lines = [
    line("s1", paleAle, 1, 0), // under by 3, ordered 3
    line("s2", paleAle, 5, 1), // over by 2
    line("s3", paleAle, 0, 1), // under by 3, order made but product missing from it
    line("s4", paleAle, 2, 0, { par_at_count: 6 }), // under by 4, no order at all
  ];
  const orders: Pick<OrderingOrder, "id" | "session_id" | "status">[] = [
    { id: "o1", session_id: "s1", status: "sent" },
    { id: "o3", session_id: "s3", status: "sent" },
    { id: "ot", session_id: null, status: "sent" },
  ];
  const orderLines: Pick<OrderingOrderLine, "order_id" | "product_id" | "ordered_qty">[] = [
    { order_id: "o1", product_id: paleAle.id, ordered_qty: 3 },
    { order_id: "o3", product_id: lager.id, ordered_qty: 2 },
    { order_id: "ot", product_id: paleAle.id, ordered_qty: 1 },
  ];
  const story = productStory({ product: paleAle, sessions, lines, orders, orderLines, now: NOW });
  const by = (id: string) => story.find((r) => r.sessionId === id)!;

  it("one row per count that has the product, newest first, and an unfinished count with no line is left out", () => {
    expect(story.map((r) => r.sessionId)).toEqual(["s4", "s3", "s2", "s1"]);
  });
  it("what was counted, Build To then, and where it stood", () => {
    expect(by("s1")).toMatchObject({ store: 1, second: 0, total: 1, par: 4, position: "Under by 3", belowPar: true });
    expect(by("s2")).toMatchObject({ total: 6, position: "Over by 2", over: 2 });
    expect(by("s4")).toMatchObject({ par: 6, position: "Under by 4" });
  });
  it("did we forget to order it: ordered, not on the order, or no order at all", () => {
    expect(by("s1")).toMatchObject({ ordered: 3, orderNote: "Ordered 3", missed: false });
    expect(by("s3")).toMatchObject({ ordered: null, orderNote: "Not on the order", missed: true });
    expect(by("s4")).toMatchObject({ ordered: null, orderNote: "No order was made from this count", missed: true });
    expect(by("s2")).toMatchObject({ orderNote: "Nothing needed", missed: false });
  });
  it("a top-up order is not tied to a count, so it never counts as this count's order", () => {
    expect(story.some((r) => r.ordered === 1)).toBe(false);
  });
  it("an order still in draft says so", () => {
    const s = productStory({ product: paleAle, sessions, lines, orders: [{ id: "o1", session_id: "s1", status: "draft" }], orderLines, now: NOW });
    expect(s.find((r) => r.sessionId === "s1")?.orderNote).toBe("Ordered 3 (draft order)");
  });
  it("a count that did not include this product, or counted it as nothing, says not counted", () => {
    const s = productStory({ product: paleAle, sessions: [session("sx", "2026-09-07T00:00:00Z")], lines: [], orders: [], orderLines: [], now: NOW });
    expect(s[0]).toMatchObject({ total: null, position: "Not counted", orderNote: "Not counted", missed: false });
  });
  it("an in-progress count that has the product does not claim a missed order", () => {
    const s = productStory({ product: paleAle, sessions: [sessions[4]], lines: [line("s5", paleAle, 0, 0)], orders: [], orderLines: [], now: NOW });
    expect(s[0]).toMatchObject({ orderNote: "Count not finished yet", missed: false, inProgress: true });
  });
  it("a count imported from the old sheet has no orders in the app, so it is not called a missed order", () => {
    const imported = [session("i1", "2026-09-14T00:00:00Z", { source: "sheet-import" })];
    const s = productStory({ product: paleAle, sessions: imported, lines: [line("i1", paleAle, 1, 0)], orders: [], orderLines: [], now: NOW });
    expect(s[0]).toMatchObject({ orderNote: "Ordered on the old sheet, not recorded here", missed: false });
    // but once an order exists for it that leaves the product out, it is flagged as usual
    const s2 = productStory({ product: paleAle, sessions: imported, lines: [line("i1", paleAle, 1, 0)], orders: [{ id: "x", session_id: "i1", status: "sent" }], orderLines: [], now: NOW });
    expect(s2[0]).toMatchObject({ orderNote: "Not on the order", missed: true });
  });
  it("the summary answers both questions in sentences", () => {
    const sum = storySummary(story);
    expect(sum).toMatchObject({ counts: 4, below: 3, over: 1, missed: 2 });
    expect(sum.sentences[0]).toBe("Counted 4 times. Below Build To in 3, over Build To in 1.");
    expect(sum.sentences[1]).toBe("A needed order may have been missed in 2 counts.");
    expect(storySummary([]).sentences).toEqual(["This product has not been counted yet."]);
    expect(storySummary(story.filter((r) => !r.missed)).sentences[1]).toBe("Every count that needed an order has an order for it.");
  });
});

describe("the Orders list", () => {
  const o = (id: string, over: Partial<OrderingOrder>): OrderingOrder => ({
    id, venue_id: 1, supplier_id: fx.suppliers[0].id, session_id: null, status: "sent", kind: "count", sent_by: "matt@x.com", sent_at: "2026-09-28T01:00:00Z", method: "email", subject: null, body_text: null, warning_text: null, show_prices: false, created_at: "2026-09-28T00:30:00Z", ...over,
  });
  it("newest first with supplier, who sent it, status and kind in words", () => {
    const rows = orderListRows([o("a", {}), o("b", { status: "draft", sent_at: null, sent_by: null, kind: "top_up", created_at: "2026-10-05T00:00:00Z" }), o("c", { supplier_id: "gone", sent_at: "2026-09-29T01:00:00Z" })], fx.suppliers, nameOf, NOW);
    expect(rows.map((r) => r.id)).toEqual(["b", "c", "a"]);
    expect(rows[0]).toMatchObject({ status: "Draft", whoLabel: "Draft, not sent", kindLabel: "Top-Up", supplierName: "Star" });
    expect(rows[1].supplierName).toBe("Supplier removed");
    expect(rows[2]).toMatchObject({ status: "Sent", whoLabel: "Sent by Matt", kindLabel: "From A Count", dateLabel: "Mon 28 Sep" });
  });
});
