import { describe, expect, it } from "vitest";
import { buildSupplierOrders } from "@/lib/ordering";
import { orderingFixture } from "@/lib/ordering-fixture";
import {
  NO_EMAIL_REASON,
  NO_LINES_REASON,
  NO_LOGIN_REASON,
  TOO_LONG_MAILTO,
  addCandidates,
  addLine,
  brisbaneDay,
  brisbaneStamp,
  brisbaneTime,
  buildSupplierSend,
  cardMode,
  clampQty,
  commonUnit,
  countLabel,
  defaultSendMethod,
  draftLineFromProduct,
  draftLinesFromGroup,
  draftsToOrderLines,
  finalisedCounts,
  freeTextLine,
  linesSignature,
  minimumUnits,
  notNeededNote,
  notPackMultiple,
  orderCardGroups,
  parseQty,
  pastOrderRows,
  pickCount,
  priceCells,
  removeLine,
  sendActions,
  sendReasons,
  sentLine,
  sentOrdersFor,
  sentSummary,
  setLineQty,
  stepQty,
  unitsText,
  type DraftLine,
} from "@/lib/ordering-orders-ui";
import type { OrderingCountSession, OrderingOrder, OrderingSupplier } from "@/lib/ordering-types";
import { copyText } from "@/components/ordering/orders/clipboard";

const fx = orderingFixture(1);
const sup = (name: string) => fx.suppliers.find((s) => s.name === name) as OrderingSupplier;
const groupFor = (name: string) => buildSupplierOrders(fx.products, fx.countLines, { suppliers: fx.suppliers, categories: fx.categories }).find((g) => g.supplierName === name)!;
const nameOf = (e: string | null | undefined) => (e ? (e.startsWith("troy") ? "Troy" : "Demo") : null);

const line = (over: Partial<DraftLine> = {}): DraftLine => ({ key: "k", productId: "p", name: "Pink Dot", unit: "carton", code: null, packMultiple: 1, price: null, par: 10, counted: 4, suggested: 6, qty: 6, ...over });

describe("Brisbane time", () => {
  it("reads the Brisbane wall clock (UTC+10, no daylight saving)", () => {
    expect(brisbaneDay("2026-10-05T14:30:00Z")).toBe("Tue 6 Oct");
    expect(brisbaneTime("2026-10-05T23:14:00Z")).toBe("9:14am");
    expect(brisbaneStamp("2026-10-05T23:14:00Z")).toBe("Tue 6 Oct 9:14am");
    expect(brisbaneTime("2026-10-06T02:05:00Z")).toBe("12:05pm");
    expect(brisbaneTime("2026-10-06T14:00:00Z")).toBe("12:00am");
    expect(brisbaneStamp("2026-01-01T13:59:00Z")).toBe("Thu 1 Jan 11:59pm");
  });
  it("is empty for a missing or bad time", () => {
    expect(brisbaneDay(null)).toBe("");
    expect(brisbaneStamp("nonsense")).toBe("");
  });
});

describe("which count", () => {
  const s = (id: string, status: "in_progress" | "finalised", at: string): OrderingCountSession => ({ id, venue_id: 1, started_by: "a@b.c", started_at: at, status, finalised_by: status === "finalised" ? "troy@x.com" : null, finalised_at: status === "finalised" ? at : null, note: null, source: null });
  const sessions = [s("old", "finalised", "2026-09-21T00:00:00Z"), s("open", "in_progress", "2026-10-05T00:00:00Z"), s("new", "finalised", "2026-09-28T00:00:00Z")];
  it("lists finished counts newest first and ignores one in progress", () => {
    expect(finalisedCounts(sessions).map((x) => x.id)).toEqual(["new", "old"]);
  });
  it("defaults to the latest finished count, or the one asked for", () => {
    expect(pickCount(sessions, null)?.id).toBe("new");
    expect(pickCount(sessions, "old")?.id).toBe("old");
    expect(pickCount(sessions, "open")?.id).toBe("new"); // an unfinished count is never offered
    expect(pickCount([s("open", "in_progress", "2026-10-05T00:00:00Z")], null)).toBeNull();
  });
  it("labels who counted and when", () => {
    expect(countLabel(sessions[2], nameOf)).toBe("Counted Mon 28 Sep by Troy");
    expect(countLabel({ ...sessions[2], finalised_by: null, started_by: null }, nameOf)).toBe("Counted Mon 28 Sep");
  });
});

describe("the draft lines of a supplier card", () => {
  it("start from the count's suggestions, rounded up to the pack multiple", () => {
    const star = draftLinesFromGroup(groupFor("Star"));
    expect(star.map((l) => [l.name, l.qty, l.suggested])).toEqual([
      ["Lager Cans", 3, 3],
      ["Seltzer Cans", 4, 4],
      ["House Sauvignon Blanc", 1, 1],
      ["House Prosecco", 4, 4],
      ["Bourbon Bottle", 6, 6],
      ["Aperol Bottle", 6, 6],
      ["Vodka Bottle", 12, 12],
    ]);
    expect(star[0]).toMatchObject({ unit: "carton", code: "100101", price: 62, par: 8, counted: 5, packMultiple: 1 });
  });
  it("leave out what is at or over Build To and what was not counted", () => {
    const diablo = groupFor("Diablo");
    expect(draftLinesFromGroup(diablo)).toEqual([]);
    expect(diablo.zeroLines.map((l) => notNeededNote(l))).toEqual(["Over by 1"]);
    expect(groupFor("Coke").uncountedLines.map((l) => l.product.name)).toEqual(["Water Bottles", "Coke"]);
  });
  it("edit quantities, remove lines and add each product once", () => {
    let lines = draftLinesFromGroup(groupFor("Lion"));
    lines = setLineQty(lines, lines[0].key, 9);
    expect(lines[0].qty).toBe(9);
    expect(setLineQty(lines, lines[0].key, -4)[0].qty).toBe(0);
    expect(setLineQty(lines, lines[0].key, 99999)[0].qty).toBe(9999);
    expect(removeLine(lines, lines[0].key)).toHaveLength(lines.length - 1);
    const ginger = groupFor("Diablo").zeroLines[0];
    const added = addLine(lines, draftLineFromProduct(ginger.product, ginger));
    expect(added).toHaveLength(lines.length + 1);
    expect(addLine(added, draftLineFromProduct(ginger.product, ginger))).toHaveLength(added.length);
  });
  it("an added product starts at its suggestion, else one pack", () => {
    const vodka = fx.products.find((p) => p.name === "Vodka Bottle")!;
    expect(draftLineFromProduct(vodka).qty).toBe(12); // pack multiple, never 1 of a 12 pack
    expect(draftLineFromProduct(vodka).suggested).toBeNull();
    const ginger = groupFor("Diablo").zeroLines[0];
    expect(draftLineFromProduct(ginger.product, ginger).qty).toBe(1);
    expect(draftLineFromProduct(vodka, null, 24).qty).toBe(24);
  });
  it("a typed line has no product, price or code, and an empty name makes none", () => {
    const f = freeTextLine("  Bar   mats ", 2)!;
    expect(f).toMatchObject({ productId: null, name: "Bar mats", price: null, code: null, unit: null, qty: 2, suggested: null });
    expect(f.key.startsWith("free:")).toBe(true);
    expect(freeTextLine("   ")).toBeNull();
    expect(freeTextLine("a")!.key).not.toBe(freeTextLine("a")!.key);
  });
  it("save only lines with a quantity, in order, with the snapshot the data layer needs", () => {
    const lines = [line({ key: "a", qty: 3 }), line({ key: "b", qty: 0 }), line({ key: "c", name: "Bar mats", productId: null, unit: null, price: null, suggested: null, qty: 1 })];
    const out = draftsToOrderLines(lines);
    expect(out.map((l) => [l.product_name, l.ordered_qty, l.sort])).toEqual([["Pink Dot", 3, 0], ["Bar mats", 1, 1]]);
    expect(out[0]).toMatchObject({ product_id: "p", unit_name: "carton", suggested_qty: 6, pack_multiple: 1 });
    expect(out[1]).toMatchObject({ product_id: null, suggested_qty: null, price_inc_gst: null });
  });
  it("a signature changes when a quantity or line changes", () => {
    const a = [line({ key: "a", qty: 3 })];
    expect(linesSignature(a)).toBe(linesSignature([line({ key: "a", qty: 3 })]));
    expect(linesSignature(a)).not.toBe(linesSignature([line({ key: "a", qty: 4 })]));
    expect(linesSignature(a)).toBe(linesSignature([...a, line({ key: "z", qty: 0 })]));
  });
});

describe("quantities", () => {
  it("parse whole numbers only", () => {
    expect(parseQty("12")).toBe(12);
    expect(parseQty(" 7 ")).toBe(7);
    expect(parseQty("")).toBeNull();
    expect(parseQty("1.5")).toBeNull();
    expect(parseQty("-3")).toBeNull();
    expect(parseQty("abc")).toBeNull();
    expect(parseQty("99999")).toBeNull();
    expect(clampQty(2.6)).toBe(3);
    expect(clampQty(Number.NaN)).toBe(0);
  });
  it("step by the pack multiple and stop at 0", () => {
    expect(stepQty({ qty: 6, packMultiple: 6 }, 1)).toBe(12);
    expect(stepQty({ qty: 6, packMultiple: 6 }, -1)).toBe(0);
    expect(stepQty({ qty: 8, packMultiple: 6 }, -1)).toBe(6);
    expect(stepQty({ qty: 8, packMultiple: 6 }, 1)).toBe(12);
    expect(stepQty({ qty: 0, packMultiple: 12 }, 1)).toBe(12);
    expect(stepQty({ qty: 3, packMultiple: 1 }, 1)).toBe(4);
    expect(stepQty({ qty: 0, packMultiple: 1 }, -1)).toBe(0);
    expect(stepQty({ qty: 2, packMultiple: null }, -1)).toBe(1);
  });
  it("flag a quantity that is not a whole pack (a soft flag, never a block)", () => {
    expect(notPackMultiple({ qty: 8, packMultiple: 6 })).toBe(true);
    expect(notPackMultiple({ qty: 12, packMultiple: 6 })).toBe(false);
    expect(notPackMultiple({ qty: 0, packMultiple: 6 })).toBe(false);
    expect(notPackMultiple({ qty: 5, packMultiple: 1 })).toBe(false);
    expect(notPackMultiple({ qty: 5, packMultiple: null })).toBe(false);
  });
});

describe("Add Product search", () => {
  const onOrder = draftLinesFromGroup(groupFor("Coke"));
  it("a count card offers only its own supplier's products that are not on the order", () => {
    const found = addCandidates(fx.products, { supplierId: sup("Coke").id, scope: "supplier", onOrder, query: "" });
    expect(found.map((c) => c.product.name)).toEqual(["Coke", "Water Bottles"]);
    expect(found.every((c) => c.product.supplier_id === sup("Coke").id)).toBe(true);
  });
  it("matches every typed word in the name or item code", () => {
    expect(addCandidates(fx.products, { supplierId: sup("Star").id, scope: "supplier", onOrder: [], query: "house pro" }).map((c) => c.product.name)).toEqual(["House Prosecco"]);
    expect(addCandidates(fx.products, { supplierId: sup("Star").id, scope: "supplier", onOrder: [], query: "300303" }).map((c) => c.product.name)).toEqual(["Vodka Bottle"]);
    expect(addCandidates(fx.products, { supplierId: sup("Star").id, scope: "supplier", onOrder: [], query: "zzz" })).toEqual([]);
  });
  it("a top-up searches the whole venue with its supplier's products first, naming the others", () => {
    const found = addCandidates(fx.products, { supplierId: sup("Lion").id, scope: "venue", onOrder: [], query: "keg" });
    expect(found.map((c) => c.product.name)).toEqual(["Pale Ale Keg", "XXXX Gold Keg", "Ginger Beer Keg"]);
    expect(found.map((c) => c.otherSupplierId)).toEqual([null, null, sup("Diablo").id]);
  });
  it("carries the count's suggestion for a counted product", () => {
    const suggestions = new Map(groupFor("Diablo").zeroLines.map((l) => [l.product.id, l]));
    const found = addCandidates(fx.products, { supplierId: sup("Diablo").id, scope: "supplier", onOrder: [], query: "", suggestions });
    expect(found[0].suggested?.suggestion.over).toBe(1);
  });
  it("never offers an inactive product", () => {
    const products = fx.products.map((p) => (p.name === "Water Bottles" ? { ...p, active: false } : p));
    expect(addCandidates(products, { supplierId: sup("Coke").id, scope: "supplier", onOrder: [], query: "water" })).toEqual([]);
  });
});

describe("card groups", () => {
  const groups = buildSupplierOrders(fx.products, fx.countLines, { suppliers: fx.suppliers, categories: fx.categories });
  it("puts suppliers with something to order first, nothing-to-order ones after, and Unassigned last", () => {
    const { assigned, unassigned } = orderCardGroups(groups);
    expect(assigned.map((g) => g.supplierName)).toEqual(["Star", "Lion", "Coke", "Diablo"]);
    expect(unassigned).toBeNull();
  });
  it("keeps a supplier whose order was already sent among the busy ones", () => {
    const { assigned } = orderCardGroups(groups, new Set([sup("Diablo").id]));
    expect(assigned.map((g) => g.supplierName)).toEqual(["Star", "Lion", "Diablo", "Coke"]); // supplier order, nothing-to-order ones last
  });
  it("merges products with no supplier into one Unassigned card with its own warning list", () => {
    const products = fx.products.map((p) => (p.name === "Aperol Bottle" || p.name === "Water Bottles" ? { ...p, supplier_id: null } : p));
    const { unassigned, assigned } = orderCardGroups(buildSupplierOrders(products, fx.countLines, { suppliers: fx.suppliers, categories: fx.categories }));
    expect(unassigned?.supplierName).toBe("Unassigned");
    expect(unassigned?.lines.map((l) => l.product.name)).toEqual(["Aperol Bottle"]);
    expect(unassigned?.uncountedLines.map((l) => l.product.name)).toEqual(["Water Bottles"]);
    expect(assigned.every((g) => g.supplier != null)).toBe(true);
  });
});

describe("the text, prices and minimum of a supplier order", () => {
  it("builds the exact text, with prices only when the switch is on", () => {
    const star = sup("Star");
    const lines = draftLinesFromGroup(groupFor("Star")).slice(0, 2);
    const on = buildSupplierSend({ venueName: "Drift", supplier: star, lines, showPrices: true, senderName: "Troy" });
    expect(on.subject).toBe("Drift Order");
    expect(on.body).toContain("Hi Mark,");
    expect(on.body).toContain("Order for Drift, account A1001:");
    expect(on.body).toContain("Lager Cans - 3 ctns (item 100101) @ $56.36 ex GST / $62.00 inc GST = $169.09 ex GST / $186.00 inc GST");
    expect(on.body).toContain("Total inc GST: $418.00");
    expect(on.body.endsWith("Thanks,\nTroy")).toBe(true);
    const off = buildSupplierSend({ venueName: "Drift", supplier: star, lines, showPrices: false, senderName: "Troy" });
    expect(off.body).not.toContain("$");
    expect(off.totals.inc).toBe(418); // totals still known on screen, just not printed
  });
  it("greets by the rep's first name and signs with the sender", () => {
    const lion = buildSupplierSend({ venueName: "Drift", supplier: sup("Lion"), lines: draftLinesFromGroup(groupFor("Lion")), showPrices: false, senderName: "Abbey" });
    expect(lion.body.startsWith("Hi Jason,")).toBe(true);
    expect(lion.body).toContain("Pale Ale Keg - 3 kegs");
    expect(lion.body.endsWith("Abbey")).toBe(true);
  });
  it("makes a mailto and an Outlook link with CRLF line breaks and the supplier's address", () => {
    const send = buildSupplierSend({ venueName: "Drift", supplier: sup("Star"), lines: draftLinesFromGroup(groupFor("Star")).slice(0, 1), showPrices: false, senderName: "Troy" });
    expect(send.mailto.url.startsWith("mailto:orders@star.example.com?subject=Drift%20Order&body=Hi%20Mark%2C%0D%0A")).toBe(true);
    expect(send.outlook.url.startsWith("https://outlook.office.com/mail/deeplink/compose?to=orders%40star.example.com&subject=Drift%20Order&body=")).toBe(true);
    expect(send.mailto.tooLong).toBe(false);
  });
  it("flags a long order for Copy", () => {
    const many = Array.from({ length: 40 }, (_, i) => line({ key: `k${i}`, name: `A long product name number ${i}`, qty: 12 }));
    const send = buildSupplierSend({ venueName: "Drift", supplier: sup("Star"), lines: many, showPrices: true, senderName: "Troy" });
    expect(send.mailto.tooLong).toBe(true);
    expect(send.outlook.tooLong).toBe(true);
  });
  it("warns about a minimum in dollars (ex GST), with the supplier note kept for the screen", () => {
    const coke = sup("Coke");
    const small = buildSupplierSend({ venueName: "Drift", supplier: coke, lines: [line({ qty: 2, price: 66 })], showPrices: false, senderName: null });
    expect(small.warning).toBe("Order is $30.00 short of the $150.00 minimum"); // 2 x $66 inc is $120 ex GST
    const big = buildSupplierSend({ venueName: "Drift", supplier: coke, lines: [line({ qty: 4, price: 66 })], showPrices: false, senderName: null });
    expect(big.warning).toBeNull();
  });
  it("warns about a minimum in units, and a typed line does not count as a keg", () => {
    const diablo = sup("Diablo");
    const kegs = line({ unit: "keg", qty: 1, price: 190 });
    const typed = freeTextLine("Bar mats", 1)!;
    const one = buildSupplierSend({ venueName: "Drift", supplier: diablo, lines: [kegs], showPrices: false, senderName: null });
    expect(one.warning).toBe("Order is 3 kegs short of the 4 keg minimum");
    const withTyped = buildSupplierSend({ venueName: "Drift", supplier: diablo, lines: [kegs, typed], showPrices: false, senderName: null });
    expect(withTyped.warning).toBe("Order is 3 kegs short of the 4 keg minimum");
    expect(buildSupplierSend({ venueName: "Drift", supplier: diablo, lines: [{ ...kegs, qty: 4 }], showPrices: false, senderName: null }).warning).toBeNull();
  });
  it("has no warning for an empty order", () => {
    expect(buildSupplierSend({ venueName: "Drift", supplier: sup("Diablo"), lines: [], showPrices: false, senderName: null }).warning).toBeNull();
  });
  it("names a shared unit, and counts typed lines apart", () => {
    const kegs = [{ unit_name: "keg", ordered_qty: 3 }, { unit_name: null, ordered_qty: 2 }];
    expect(commonUnit(kegs)).toBe("keg");
    expect(minimumUnits(kegs)).toBe(3);
    expect(unitsText(kegs)).toBe("3 kegs and 1 typed line");
    expect(unitsText([{ unit_name: "keg", ordered_qty: 3 }, { unit_name: "carton", ordered_qty: 2 }])).toBe("5 units");
    expect(unitsText([{ unit_name: "carton", ordered_qty: 1 }])).toBe("1 ctn");
    expect(unitsText([{ unit_name: null, ordered_qty: 1 }])).toBe("1 unit");
    expect(minimumUnits([{ unit_name: "keg", ordered_qty: 3 }, { unit_name: "carton", ordered_qty: 2 }])).toBe(5);
  });
});

describe("which send buttons exist and work", () => {
  const send = (supplier: OrderingSupplier, lines: DraftLine[] = [line({ qty: 2, price: 10 })]) => buildSupplierSend({ venueName: "Drift", supplier, lines, showPrices: false, senderName: "Troy" });
  it("an email supplier: Open Email (filled), Open In Outlook (new tab), Copy Order", () => {
    const star = sup("Star");
    const a = sendActions(star, send(star));
    expect(a.map((x) => [x.id, x.label, x.primary, x.enabled])).toEqual([
      ["email", "Open Email", true, true],
      ["outlook", "Open In Outlook", false, true],
      ["copy", "Copy Order", false, true],
    ]);
    expect(a[0].href?.startsWith("mailto:orders@star.example.com")).toBe(true);
    expect(a[0].newTab).toBe(false);
    expect(a[1].href?.startsWith("https://outlook.office.com/")).toBe(true);
    expect(a[1].newTab).toBe(true);
    expect(a[2].href).toBeNull();
    expect(sendReasons(a)).toEqual([]);
  });
  it("a website supplier: Open Login (filled, new tab) next to Copy Order, no email buttons", () => {
    const lion = sup("Lion");
    const a = sendActions(lion, send(lion));
    expect(a.map((x) => [x.id, x.primary, x.enabled])).toEqual([["login", true, true], ["copy", false, true]]);
    expect(a[0].href).toBe("https://orders.lion.example.com/login");
    expect(a[0].newTab).toBe(true);
  });
  it("a website supplier with no login link keeps the button, disabled, and says why", () => {
    const lion = { ...sup("Lion"), login_url: null };
    const a = sendActions(lion, send(lion));
    expect(a[0]).toMatchObject({ id: "login", enabled: false, reason: NO_LOGIN_REASON, href: null });
    expect(sendReasons(a)).toEqual([NO_LOGIN_REASON]);
  });
  it("an app supplier: Copy Order is the filled button, Open Login only when a link is saved", () => {
    const app: OrderingSupplier = { ...sup("Lion"), method: "app", login_url: null };
    expect(sendActions(app, send(app)).map((x) => [x.id, x.primary])).toEqual([["copy", true]]);
    expect(sendActions({ ...app, login_url: "https://app.example.com" }, send(app)).map((x) => x.id)).toEqual(["copy", "login"]);
  });
  it("an email supplier with no address: both email buttons disabled with the reason, Copy still works", () => {
    const star = { ...sup("Star"), email_to: null };
    const a = sendActions(star, send(star));
    expect(a[0]).toMatchObject({ enabled: false, reason: NO_EMAIL_REASON });
    expect(a[1]).toMatchObject({ enabled: false, reason: NO_EMAIL_REASON });
    expect(a[2].enabled).toBe(true);
    expect(sendReasons(a)).toEqual([NO_EMAIL_REASON]);
  });
  it("a long order turns Open Email off and points to Copy", () => {
    const star = sup("Star");
    const many = Array.from({ length: 40 }, (_, i) => line({ key: `k${i}`, name: `A long product name number ${i}`, qty: 12 }));
    const a = sendActions(star, buildSupplierSend({ venueName: "Drift", supplier: star, lines: many, showPrices: true, senderName: "Troy" }));
    expect(a[0]).toMatchObject({ id: "email", enabled: false, reason: TOO_LONG_MAILTO, href: null });
    expect(a[2]).toMatchObject({ id: "copy", enabled: true });
  });
  it("with nothing on the order every sending button is disabled", () => {
    const star = sup("Star");
    const a = sendActions(star, send(star, []));
    expect(a.every((x) => !x.enabled && x.reason === NO_LINES_REASON)).toBe(true);
    expect(sendReasons(a)).toEqual([NO_LINES_REASON]);
  });
});

describe("how an order is recorded as sent", () => {
  it("is the last button used, else the supplier's own way", () => {
    expect(defaultSendMethod("email", "email")).toBe("email");
    expect(defaultSendMethod("outlook", "email")).toBe("outlook");
    expect(defaultSendMethod("copy", "website")).toBe("copy");
    expect(defaultSendMethod("login", "website")).toBe("website");
    expect(defaultSendMethod(null, "email")).toBe("email");
    expect(defaultSendMethod(null, "website")).toBe("website");
    expect(defaultSendMethod(null, "app")).toBe("other");
  });
});

describe("the state of a card", () => {
  const order = (over: Partial<OrderingOrder> = {}): OrderingOrder => ({
    id: "o1", venue_id: 1, supplier_id: "s1", session_id: "c1", status: "sent", kind: "count", sent_by: "troy@x.com", sent_at: "2026-10-05T23:14:00Z", method: "email",
    subject: "Drift Order", body_text: "x", warning_text: null, show_prices: false, created_at: "2026-10-05T23:10:00Z", ...over,
  });
  it("is read-only once an order for this count and supplier was sent", () => {
    const sent = sentOrdersFor([order()], "c1", "s1");
    expect(cardMode(sent, false)).toBe("sent");
    expect(cardMode([], false)).toBe("edit");
  });
  it("Send Again turns it back into an editor", () => {
    expect(cardMode(sentOrdersFor([order()], "c1", "s1"), true)).toBe("edit");
  });
  it("matches the same count and supplier only, newest first, and never a draft or a top-up", () => {
    const orders = [
      order({ id: "a", sent_at: "2026-10-05T01:00:00Z" }),
      order({ id: "b", sent_at: "2026-10-05T05:00:00Z" }),
      order({ id: "c", supplier_id: "s2" }),
      order({ id: "d", session_id: "c2" }),
      order({ id: "e", status: "draft", sent_at: null }),
      order({ id: "f", kind: "top_up", session_id: null }),
    ];
    expect(sentOrdersFor(orders, "c1", "s1").map((o) => o.id)).toEqual(["b", "a"]);
    expect(sentOrdersFor(orders, null, "s1")).toEqual([]);
  });
  it("summarises products, units and the total of a sent order", () => {
    const s = sentSummary([{ ordered_qty: 3, price_inc_gst: 62 }, { ordered_qty: 0, price_inc_gst: 10 }, { ordered_qty: 2, price_inc_gst: null }]);
    expect(s.products).toBe(2);
    expect(s.units).toBe(5);
    expect(s.totals).toMatchObject({ inc: 186, pricedLines: 1, unpricedLines: 1 });
  });
  it("words who sent it and when", () => {
    expect(sentLine(order(), nameOf)).toBe("Sent Tue 6 Oct 9:14am by Troy");
    expect(sentLine(order({ sent_by: null }), nameOf)).toBe("Sent Tue 6 Oct 9:14am");
  });
});

describe("Past Orders", () => {
  const suppliers = [{ id: "s1", name: "Star" }, { id: "s2", name: "Lion" }];
  const base = { venue_id: 1, session_id: "c1", kind: "count" as const, subject: null, body_text: null, warning_text: null, show_prices: false };
  const orders: OrderingOrder[] = [
    { ...base, id: "a", supplier_id: "s1", status: "sent", sent_by: "troy@x.com", sent_at: "2026-10-05T01:00:00Z", method: "outlook", created_at: "2026-10-05T00:50:00Z" },
    { ...base, id: "b", supplier_id: "s2", status: "sent", sent_by: null, sent_at: "2026-10-05T05:00:00Z", method: "copy", created_at: "2026-10-05T04:50:00Z", kind: "top_up", session_id: null },
    { ...base, id: "c", supplier_id: "s1", status: "draft", sent_by: null, sent_at: null, method: null, created_at: "2026-10-05T07:00:00Z" },
  ];
  it("lists latest first with status, supplier, who and when, and says plainly when an order was never marked as sent", () => {
    const rows = pastOrderRows(orders, suppliers, nameOf);
    expect(rows.map((r) => r.id)).toEqual(["c", "b", "a"]);
    expect(rows[0]).toMatchObject({ supplierName: "Star", status: "draft", kindLabel: "Count" });
    expect(rows[0].when).toBe("Saved Mon 5 Oct 5:00pm, not marked as sent");
    expect(rows[1]).toMatchObject({ supplierName: "Lion", status: "sent", kindLabel: "Top-Up", when: "Sent Mon 5 Oct 3:00pm, Copied And Pasted" });
    expect(rows[2].when).toBe("Sent Mon 5 Oct 11:00am by Troy, Outlook");
  });
});

describe("price cells", () => {
  it("shows ex and inc GST for one unit and for the line", () => {
    expect(priceCells(36, 29.5)).toEqual({ unitEx: "$26.82", unitInc: "$29.50", totalEx: "$965.45", totalInc: "$1,062.00" });
  });
  it("is empty without a price", () => {
    expect(priceCells(3, null)).toEqual({ unitEx: null, unitInc: null, totalEx: null, totalInc: null });
  });
});

describe("copyText", () => {
  it("calls the clipboard straight away, before anything is awaited (Safari needs the click still being handled)", async () => {
    const seen: string[] = [];
    const p = copyText("hello", { writeText: (t) => (seen.push(t), Promise.resolve()) });
    expect(seen).toEqual(["hello"]); // synchronous
    expect(await p).toBe(true);
  });
  it("falls back to the old copy when the Clipboard API refuses", async () => {
    const legacy: string[] = [];
    const ok = await copyText("hello", { writeText: () => Promise.reject(new Error("denied")), legacyCopy: (t) => (legacy.push(t), true) });
    expect(ok).toBe(true);
    expect(legacy).toEqual(["hello"]);
  });
  it("falls back when writeText throws or there is no Clipboard API", async () => {
    expect(await copyText("x", { writeText: () => { throw new Error("no"); }, legacyCopy: () => true })).toBe(true);
    expect(await copyText("x", { writeText: null, legacyCopy: () => true })).toBe(true);
  });
  it("says false when nothing could copy, so the screen shows the text to copy by hand", async () => {
    expect(await copyText("x", { writeText: () => Promise.reject(new Error("denied")), legacyCopy: () => false })).toBe(false);
    expect(await copyText("x", { writeText: null, legacyCopy: null })).toBe(false);
    expect(await copyText("x", { writeText: null, legacyCopy: () => { throw new Error("no"); } })).toBe(false);
  });
});

describe("sign-off", () => {
  it("every order email is signed off by Matt, never by the signed-in person (orders must not read as coming from SPORK)", async () => {
    const { readFileSync } = await import("node:fs");
    const { ORDER_SIGN_OFF } = await import("@/lib/ordering");
    expect(ORDER_SIGN_OFF).toBe("Matt");
    const src = readFileSync("components/ordering/orders/orders-screen.tsx", "utf8");
    expect(src).toContain("const senderName = ORDER_SIGN_OFF;");
    expect(src).not.toMatch(/senderName\s*=\s*nameOf/);
  });
});
