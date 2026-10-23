import { describe, expect, it } from "vitest";
import {
  addDays,
  approveLabel,
  brisbaneDate,
  canApprove,
  canSkip,
  chargeTreatment,
  checkItems,
  dayLabel,
  decisionText,
  docStats,
  feeShareText,
  filterDocs,
  homeCounts,
  inRange,
  invoiceSourceLabel,
  invoicesWord,
  landedText,
  last30Range,
  lineStateView,
  matchesStatus,
  monthRange,
  needYouText,
  numberLabel,
  pctChange,
  periodRange,
  pricesWord,
  priceCompares,
  priceMove,
  qtyPriceText,
  readPeriod,
  readStatusFilter,
  sortDocs,
  splitLines,
  statsFor,
  statusView,
  totalsStrip,
  undoBody,
  undoTitle,
  weekRange,
  type DocStats,
} from "@/lib/invoice-view";
import type { InvoiceDocumentRow, InvoiceLineRow } from "@/lib/invoice-types";

/** Hand-written fixtures from the Daniel Street Fish Market invoice 51329 (14 Oct 2026). */
const line = (over: Partial<InvoiceLineRow>): InvoiceLineRow => ({
  id: "l1",
  document_id: "d1",
  venue_id: 1,
  invoice_date: "2026-10-14",
  line_no: 1,
  page: 1,
  line_class: "product",
  item_code: "15026",
  description: "Kingfish fillets skin on wing off per kg",
  qty: 1.85,
  unit: "KG",
  unit_price_ex: 68.9,
  line_total_ex: 127.47,
  gst: "free",
  gst_amount: 0,
  math_ok: true,
  match_state: "matched",
  match_method: "code",
  map_id: null,
  ingredient_id: "ing1",
  product_id: null,
  packs_per_unit: 1,
  base_qty: 1.85,
  base_unit: "kg",
  fee_share_ex: 3.59,
  landed_total_ex: 131.06,
  landed_unit_ex: 70.8432,
  landed_base_ex: 70.8432,
  old_pack_price: 67,
  new_pack_price: 68.9,
  old_product_price: null,
  new_product_price: null,
  change_pct: 0.0284,
  decision: "needs_approval",
  decision_reason: "Learning mode: every price waits for a tap.",
  state: "open",
  ...over,
});

const doc = (over: Partial<InvoiceDocumentRow> = {}): InvoiceDocumentRow => ({
  id: "d1",
  venue_id: 1,
  file_id: "f1",
  supplier_id: "s1",
  supplier_name_read: "Daniel Street Fish Market",
  supplier_abn_read: "61151388094",
  doc_type: "invoice",
  invoice_number: "51329",
  invoice_date: "2026-10-14",
  due_date: null,
  pages: [1],
  page_pdf_path: "f1/d1.pdf",
  bill_to: "DRIFT BAR AND DINING",
  ship_to: null,
  venue_check: "ok",
  price_basis: "ex",
  subtotal_ex: 215.91,
  gst_total: 0.59,
  total_inc: 216.5,
  reconciled: true,
  recon_notes: [],
  fee_pool_ex: 5.91,
  status: "needs_review",
  mode: "learning",
  duplicate_of: null,
  read_model: null,
  created_at: "2026-10-14T23:30:00Z", // 15 Oct 09:30 Brisbane
  ...over,
});

describe("Brisbane dates and periods", () => {
  it("reads an ISO timestamp as a Brisbane calendar day", () => {
    expect(brisbaneDate("2026-10-14T23:30:00Z")).toBe("2026-10-15"); // 9:30am on the 15th in Brisbane
    expect(brisbaneDate("2026-10-14T13:59:00Z")).toBe("2026-10-14");
    expect(brisbaneDate("nonsense")).toBe("");
    expect(brisbaneDate(null)).toBe("");
  });
  it("weeks run Monday to Sunday", () => {
    // 24 Oct 2026 is a Saturday
    expect(weekRange("2026-10-24")).toEqual({ from: "2026-10-19", to: "2026-10-25" });
    expect(weekRange("2026-10-24", 1)).toEqual({ from: "2026-10-12", to: "2026-10-18" });
    // a Monday starts its own week, a Sunday ends it
    expect(weekRange("2026-10-19").from).toBe("2026-10-19");
    expect(weekRange("2026-10-25").from).toBe("2026-10-19");
    expect(weekRange("2026-10-26").from).toBe("2026-10-26");
  });
  it("month and last 30 days", () => {
    expect(monthRange("2026-10-24")).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(monthRange("2026-12-05")).toEqual({ from: "2026-12-01", to: "2026-12-31" });
    expect(monthRange("2028-02-10")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
    expect(last30Range("2026-10-24")).toEqual({ from: "2026-09-25", to: "2026-10-24" });
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
  it("period ids", () => {
    expect(periodRange("all", "2026-10-24")).toEqual({ from: null, to: null });
    expect(periodRange("week", "2026-10-24")).toEqual(weekRange("2026-10-24"));
    expect(readPeriod("last_week")).toBe("last_week");
    expect(readPeriod("junk")).toBe("week");
    expect(readPeriod(null)).toBe("week");
    expect(inRange("2026-10-19", weekRange("2026-10-24"))).toBe(true);
    expect(inRange("2026-10-26", weekRange("2026-10-24"))).toBe(false);
    expect(inRange("", { from: null, to: null })).toBe(false);
    expect(inRange("2020-01-01", { from: null, to: null })).toBe(true);
  });
  it("labels a day", () => {
    expect(dayLabel("2026-10-14")).toBe("14 Oct 2026");
    expect(dayLabel("2026-10-14T23:30:00Z")).toBe("15 Oct 2026");
    expect(dayLabel(null)).toBe("");
  });
});

describe("Home counts follow Troy's rules", () => {
  const range = weekRange("2026-10-24");
  const docs = [
    { id: "a", status: "applied" as const, created_at: "2026-10-20T01:00:00Z" },
    { id: "b", status: "needs_review" as const, created_at: "2026-10-22T01:00:00Z" },
    { id: "c", status: "duplicate" as const, created_at: "2026-10-22T02:00:00Z" },
    { id: "d", status: "failed" as const, created_at: "2026-10-22T03:00:00Z" },
    { id: "e", status: "ignored" as const, created_at: "2026-10-22T04:00:00Z" },
    { id: "f", status: "nothing_to_apply" as const, created_at: "2026-10-10T01:00:00Z" }, // last week
  ];
  const changes = [
    { kind: "price_change" as const, status: "applied" as const, applied_at: "2026-10-21T01:00:00Z" },
    { kind: "price_change" as const, status: "applied" as const, applied_at: "2026-10-22T01:00:00Z" },
    { kind: "price_confirmed" as const, status: "applied" as const, applied_at: "2026-10-22T01:00:00Z" }, // not an update
    { kind: "price_change" as const, status: "reverted" as const, applied_at: "2026-10-22T01:00:00Z" }, // put back
    { kind: "price_change" as const, status: "applied" as const, applied_at: "2026-10-11T01:00:00Z" }, // last week
  ];
  it("counts processed, updated and need you", () => {
    const c = homeCounts({ docs, changes, range, waiting: [{ status: "needs_review" }, { status: "needs_review" }, { status: "partly_applied" }, { status: "ignored" }, { status: "duplicate" }], totalDocs: 6 });
    expect(c).toEqual({ processed: 2, updated: 2, needYou: 3, firstRun: false });
  });
  it("a document filed late Sunday night Brisbane belongs to Sunday's week", () => {
    const sun = [{ id: "x", status: "applied" as const, created_at: "2026-10-25T13:59:00Z" }]; // Sun 23:59 Brisbane
    const mon = [{ id: "y", status: "applied" as const, created_at: "2026-10-25T14:01:00Z" }]; // Mon 00:01 Brisbane
    expect(homeCounts({ docs: sun, changes: [], range, waiting: [], totalDocs: 1 }).processed).toBe(1);
    expect(homeCounts({ docs: mon, changes: [], range, waiting: [], totalDocs: 1 }).processed).toBe(0);
  });
  it("first run only when nothing was ever filed and nothing waits", () => {
    expect(homeCounts({ docs: [], changes: [], range, waiting: [], totalDocs: 0 }).firstRun).toBe(true);
    expect(homeCounts({ docs: [], changes: [], range, waiting: [], totalDocs: 5 }).firstRun).toBe(false);
    expect(homeCounts({ docs: [], changes: [], range, waiting: [{ status: "needs_review" }], totalDocs: 0 }).firstRun).toBe(false);
  });
  it("words", () => {
    expect(invoicesWord(1)).toBe("Invoice Processed");
    expect(invoicesWord(12)).toBe("Invoices Processed");
    expect(pricesWord(1)).toBe("Price Updated");
    expect(pricesWord(31)).toBe("Prices Updated");
    expect(needYouText(3)).toBe("3 Need You");
    expect(needYouText(1)).toBe("1 Needs You");
  });
});

describe("statuses and filters", () => {
  const changes = [
    { document_id: "d1", kind: "price_change" as const, status: "applied" as const },
    { document_id: "d1", kind: "price_change" as const, status: "applied" as const },
    { document_id: "d1", kind: "price_change" as const, status: "reverted" as const },
    { document_id: "d1", kind: "price_confirmed" as const, status: "applied" as const },
    { document_id: "d2", kind: "price_confirmed" as const, status: "applied" as const },
  ];
  const stats = docStats(changes, [{ document_id: "d1" }, { document_id: "d3" }], [{ document_id: "d1" }, { document_id: "d3" }, { document_id: "d3" }]);
  it("counts per document, ignoring put-back changes", () => {
    expect(statsFor(stats, "d1")).toEqual({ changed: 2, confirmed: 1, questions: 1, approvals: 1, needYou: 2 });
    expect(statsFor(stats, "d3").needYou).toBe(3);
    expect(statsFor(stats, "nope")).toEqual({ changed: 0, confirmed: 0, questions: 0, approvals: 0, needYou: 0 });
  });
  it("words each status with an icon and the right tone", () => {
    expect(statusView("applied", { changed: 5, confirmed: 0, questions: 0, approvals: 0, needYou: 0 })).toEqual({ word: "Applied: 5 prices", tone: "neutral", icon: "check" });
    expect(statusView("applied", { changed: 1, confirmed: 0, questions: 0, approvals: 0, needYou: 0 }).word).toBe("Applied: 1 price");
    expect(statusView("applied", statsFor(stats, "d2")).word).toBe("Prices Confirmed");
    expect(statusView("needs_review", { changed: 0, confirmed: 0, questions: 1, approvals: 1, needYou: 2 })).toEqual({ word: "Needs You: 2", tone: "warn", icon: "alert" });
    expect(statusView("needs_review", statsFor(stats, "none")).word).toBe("Needs Review");
    expect(statusView("partly_applied", { changed: 3, confirmed: 0, questions: 0, approvals: 2, needYou: 2 }).word).toBe("Applied: 3 prices, 2 need you");
    expect(statusView("nothing_to_apply", statsFor(stats, "x")).word).toBe("Nothing To Apply");
    expect(statusView("duplicate", statsFor(stats, "x")).word).toBe("Duplicate");
    expect(statusView("failed", statsFor(stats, "x"))).toMatchObject({ word: "Could Not Read", tone: "danger" });
    expect(statusView("ignored", statsFor(stats, "x")).word).toBe("Ignored");
  });
  it("never uses a dash in a status word", () => {
    for (const s of ["needs_review", "applied", "partly_applied", "nothing_to_apply", "duplicate", "ignored", "failed"] as const) {
      expect(statusView(s, { changed: 2, confirmed: 1, questions: 1, approvals: 1, needYou: 2 }).word).not.toMatch(/[–—]/);
    }
  });
  const none: DocStats = { changed: 0, confirmed: 0, questions: 0, approvals: 0, needYou: 0 };
  it("filters by status", () => {
    expect(matchesStatus("all", "failed", none)).toBe(true);
    expect(matchesStatus("needs", "needs_review", none)).toBe(true);
    expect(matchesStatus("needs", "partly_applied", { ...none, needYou: 1 })).toBe(true);
    expect(matchesStatus("needs", "applied", none)).toBe(false);
    expect(matchesStatus("needs", "duplicate", { ...none, needYou: 4 })).toBe(false);
    expect(matchesStatus("applied", "partly_applied", none)).toBe(true);
    expect(matchesStatus("applied", "nothing_to_apply", none)).toBe(false);
    expect(matchesStatus("nothing", "nothing_to_apply", none)).toBe(true);
    expect(readStatusFilter("needs")).toBe("needs");
    expect(readStatusFilter("x")).toBe("all");
  });
  it("filters documents by venue, period and status", () => {
    const docs = [doc({ id: "d1", created_at: "2026-10-21T01:00:00Z" }), doc({ id: "d2", venue_id: 2, status: "applied", created_at: "2026-10-20T01:00:00Z" }), doc({ id: "d3", status: "applied", created_at: "2026-09-01T01:00:00Z" })];
    const wk = weekRange("2026-10-24");
    expect(filterDocs(docs, { venueId: null, range: wk, status: "all" }, stats).map((d) => d.id)).toEqual(["d1", "d2"]);
    expect(filterDocs(docs, { venueId: 1, range: wk, status: "all" }, stats).map((d) => d.id)).toEqual(["d1"]);
    expect(filterDocs(docs, { venueId: null, range: { from: null, to: null }, status: "applied" }, stats).map((d) => d.id)).toEqual(["d2", "d3"]);
  });
  it("sorts the newest invoice first", () => {
    const sorted = sortDocs([doc({ id: "a", invoice_date: "2026-10-01" }), doc({ id: "b", invoice_date: "2026-10-17" }), doc({ id: "c", invoice_date: null })]);
    expect(sorted.map((d) => d.id)).toEqual(["b", "a", "c"]);
  });
  it("labels", () => {
    expect(numberLabel("51329")).toBe("#51329");
    expect(numberLabel(null)).toBe("No number");
    expect(invoiceSourceLabel("51329", "Daniel Street Fish Market", "2026-10-14")).toBe("Invoice 51329 · Daniel Street Fish Market · 14 Oct 2026");
  });
});

describe("checks in words", () => {
  it("a clean invoice", () => {
    const c = checkItems(doc(), "Drift");
    expect(c.map((x) => [x.label, x.ok])).toEqual([["Adds up", true], ["Venue matches", true], ["Not a duplicate", true]]);
  });
  it("the barramundi line that does not add up gives its reason", () => {
    const c = checkItems(
      doc({ reconciled: false, recon_notes: [{ check: "line_math", ok: false, message: "Line 2: 2.39 kg at $41.54 is $99.28, not $98.98." }] }),
      "Drift",
    );
    expect(c[0]).toMatchObject({ label: "Does not add up", ok: false });
    expect(c[0].detail).toContain("$99.28");
  });
  it("a venue mismatch and an unknown venue are different words", () => {
    expect(checkItems(doc({ venue_check: "mismatch" }))[1]).toMatchObject({ label: "Venue does not match", ok: false });
    expect(checkItems(doc({ venue_check: "unknown" }))[1]).toMatchObject({ label: "Venue not confirmed", ok: null });
  });
  it("a duplicate", () => {
    expect(checkItems(doc({ duplicate_of: "d0", status: "duplicate" }))[2]).toMatchObject({ label: "Possible duplicate", ok: false });
  });
  it("tolerates missing notes", () => {
    expect(() => checkItems({ ...doc(), recon_notes: null as never })).not.toThrow();
  });
});

describe("lines", () => {
  const kingfish = line({});
  it("shows quantity times price and the landed cost with its explanation", () => {
    expect(qtyPriceText(kingfish)).toBe("1.85 kg × $68.90");
    expect(landedText(kingfish)).toBe("Landed $70.84/kg");
    expect(feeShareText(kingfish, ["delivery"])).toBe("Includes $3.59 of delivery");
    expect(feeShareText(kingfish, ["delivery", "fee"])).toBe("Includes $3.59 of delivery and fees");
    expect(feeShareText(line({ fee_share_ex: 0 }), ["delivery"])).toBeNull();
    expect(feeShareText(line({ fee_share_ex: -1.2 }), ["discount"])).toBe("Includes $1.20 off for discount");
    expect(landedText(line({ landed_unit_ex: null }))).toBeNull();
    expect(qtyPriceText(line({ qty: null }))).toBe("");
  });
  it("price moves", () => {
    expect(priceMove(0.0284)).toEqual({ dir: "up", text: "Up 2.8%" });
    expect(priceMove(-0.011)).toEqual({ dir: "down", text: "Down 1.1%" });
    expect(priceMove(0.0001)).toEqual({ dir: "same", text: "No change" });
    expect(priceMove(null).dir).toBe("none");
    expect(pctChange(67, 68.9)).toBeCloseTo(0.02836, 4);
    expect(pctChange(0, 5)).toBeNull();
    expect(pctChange(null, 5)).toBeNull();
  });
  it("compares the ingredient and the ordering product separately", () => {
    const both = priceCompares(line({ product_id: "p1", old_product_price: 70, new_product_price: 75.79 }));
    expect(both.map((c) => c.what)).toEqual(["ingredient", "product"]);
    expect(both[0].move.text).toBe("Up 2.8%");
    expect(both[1].move.text).toBe("Up 8.3%");
    expect(priceCompares(line({ ingredient_id: null, old_pack_price: null, new_pack_price: null }))).toEqual([]);
  });
  it("splits products from charges and credits", () => {
    const ls = [
      line({ id: "a", line_no: 4, line_class: "delivery", description: "Delivery order over $200" }),
      line({ id: "b", line_no: 2 }),
      line({ id: "c", line_no: 3, line_class: "credit", description: "Credit barramundi", line_total_ex: -16.45 }),
      line({ id: "d", line_no: 1 }),
    ];
    const s = splitLines(ls);
    expect(s.products.map((l) => l.id)).toEqual(["d", "b"]);
    expect(s.charges.map((l) => l.id)).toEqual(["c", "a"]);
  });
  it("says whether a charge is spread, using the rules table before the defaults", () => {
    const delivery = line({ line_class: "delivery", description: "99000 Delivery order over $200" });
    expect(chargeTreatment(delivery, 5.91, [], "s1")).toEqual({ label: "Spread over the products", spread: true });
    expect(chargeTreatment(delivery, 0, [], "s1")).toEqual({ label: "Left out of cost", spread: false }); // nothing in the pool
    expect(chargeTreatment(line({ line_class: "deposit", description: "Keg deposit" }), 5.91, [], "s1").spread).toBe(false);
    expect(chargeTreatment(line({ line_class: "credit", description: "Credit" }), 5.91, [], "s1")).toEqual({ label: "Taken off the product price", spread: null });
    // Troy's later rule: this supplier's delivery is left out
    const rules = [
      { supplier_id: null, match_text: "delivery", line_class: "delivery" as const, spread: true, active: true },
      { supplier_id: "s1", match_text: "delivery", line_class: "delivery" as const, spread: false, active: true },
    ];
    expect(chargeTreatment(delivery, 5.91, rules, "s1").spread).toBe(false);
    expect(chargeTreatment(delivery, 5.91, rules, "s2").spread).toBe(true);
    expect(chargeTreatment(delivery, 5.91, [{ ...rules[1], active: false }], "s1").spread).toBe(true);
  });
  it("states the line and what a person may do", () => {
    expect(lineStateView(line({}))).toEqual({ word: "Needs approval", tone: "warn" });
    expect(lineStateView(line({ state: "applied" })).word).toBe("Applied");
    expect(lineStateView(line({ state: "confirmed" })).word).toBe("Price confirmed");
    expect(lineStateView(line({ state: "approved_skip" })).word).toBe("Skipped");
    expect(lineStateView(line({ state: "reverted" })).word).toBe("Put back");
    expect(lineStateView(line({ decision: "same" })).word).toBe("Same price");
    expect(lineStateView(line({ decision: "none", match_state: "unmatched" }))).toEqual({ word: "Not matched yet", tone: "warn" });
    expect(canApprove(line({}))).toBe(true);
    expect(canApprove(line({ state: "applied" }))).toBe(false);
    expect(canApprove(line({ ingredient_id: null, product_id: null }))).toBe(false);
    expect(canApprove(line({ line_class: "delivery" }))).toBe(false);
    expect(canApprove(line({ decision: "none" }))).toBe(false);
    expect(canSkip(line({}))).toBe(true);
    expect(canSkip(line({ decision: "same" }))).toBe(false);
    expect(approveLabel(line({ decision: "same" }))).toBe("Confirm Price");
    expect(approveLabel(line({}))).toBe("Approve");
  });
  it("gives the engine's reason, or a fallback", () => {
    expect(decisionText(line({}))).toBe("Learning mode: every price waits for a tap.");
    expect(decisionText(line({ decision_reason: null, decision: "needs_approval" }))).toBe("A person needs to approve this price.");
    expect(decisionText(line({ decision_reason: "", decision: "none", match_state: "unmatched" }))).toBe("Not matched to an ingredient or product.");
  });
  it("totals strip", () => {
    expect(totalsStrip(doc())).toEqual({ subtotalEx: "$215.91", gst: "$0.59", totalInc: "$216.50", feePool: "$5.91" });
    expect(totalsStrip(doc({ fee_pool_ex: 0 })).feePool).toBeNull();
  });
});

describe("undo wording", () => {
  it("shows the price that goes back and what is there now", () => {
    expect(undoTitle(68.9)).toBe("Put $68.90 Back?");
    expect(undoTitle(null)).toBe("Put The Old Price Back?");
    const body = undoBody({ kind: "price_change", old_price: 67, new_price: 68.9 }, "Kingfish Fillets", 68.9);
    expect(body).toContain("Kingfish Fillets is $68.90 now");
    expect(body).toContain("$67.00");
    expect(undoBody({ kind: "price_confirmed", old_price: 68.9, new_price: 68.9 }, "Kingfish Fillets", null)).toContain("only confirmed");
  });
  it("no dash in any wording a person reads", () => {
    const words = [undoTitle(1), undoBody({ kind: "price_change", old_price: 1, new_price: 2 }, "X", 2), needYouText(2), invoicesWord(2), pricesWord(2)];
    for (const w of words) expect(w).not.toMatch(/[–—]/);
  });
});
