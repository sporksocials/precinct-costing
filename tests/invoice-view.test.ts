import { describe, expect, it } from "vitest";
import {
  addDays,
  approveLabel,
  brisbaneDate,
  canApprove,
  canSkip,
  caughtUpLine,
  chargeTreatment,
  checkItems,
  dayHeading,
  dayLabel,
  decisionText,
  detailSentence,
  docDay,
  feeShareText,
  filterDocs,
  groupByDay,
  hiddenCounts,
  hiddenKind,
  hiddenLabel,
  hiddenSentence,
  homeCounts,
  inRange,
  invoiceSourceLabel,
  invoicesWord,
  isUnread,
  landedText,
  last30Range,
  lineStatus,
  numberLabel,
  outcomeFor,
  outcomeStats,
  outcomeView,
  pctChange,
  priceCompares,
  priceMove,
  pricesWord,
  qtyPriceText,
  shortDay,
  signedPct,
  sortDocs,
  splitLines,
  statusSentence,
  todoLabel,
  todoPhrase,
  todoTotal,
  totalsStrip,
  undoBody,
  undoTitle,
  weekRange,
  type DocOutcomeStats,
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
  it("last 30 days", () => {
    expect(last30Range("2026-10-24")).toEqual({ from: "2026-09-25", to: "2026-10-24" });
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
  it("ranges", () => {
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
  it("short days and day headings for the list", () => {
    expect(shortDay("2026-10-20", "2026-10-25")).toBe("20 Oct");
    expect(shortDay("2025-12-30", "2026-10-25")).toBe("30 Dec 2025");
    expect(shortDay("2026-10-20T01:00:00Z")).toBe("20 Oct");
    expect(shortDay(null)).toBe("");
    expect(dayHeading("2026-10-25", "2026-10-25")).toBe("Today");
    expect(dayHeading("2026-10-24", "2026-10-25")).toBe("Yesterday");
    expect(dayHeading("2026-10-19", "2026-10-25")).toBe("Mon 19 Oct");
    expect(dayHeading("2025-12-31", "2026-01-02")).toBe("Wed 31 Dec 2025");
    expect(dayHeading("", "2026-10-25")).toBe("Earlier");
  });
});

describe("Home counts follow Troy's rules", () => {
  const range = weekRange("2026-10-24");
  const docs = [
    { id: "a", status: "applied" as const, created_at: "2026-10-20T01:00:00Z" },
    { id: "b", status: "needs_review" as const, created_at: "2026-10-22T01:00:00Z", read_model: "claude-sonnet-5-5" },
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
  it("counts processed, updated and still being read", () => {
    const c = homeCounts({ docs, changes, range, totalDocs: 6 });
    expect(c).toEqual({ processed: 2, updated: 2, reading: 0, firstRun: false });
  });
  it("a document filed late Sunday night Brisbane belongs to Sunday's week", () => {
    const sun = [{ id: "x", status: "applied" as const, created_at: "2026-10-25T13:59:00Z" }]; // Sun 23:59 Brisbane
    const mon = [{ id: "y", status: "applied" as const, created_at: "2026-10-25T14:01:00Z" }]; // Mon 00:01 Brisbane
    expect(homeCounts({ docs: sun, changes: [], range, totalDocs: 1 }).processed).toBe(1);
    expect(homeCounts({ docs: mon, changes: [], range, totalDocs: 1 }).processed).toBe(0);
  });
  it("first run only when nothing was ever filed", () => {
    expect(homeCounts({ docs: [], changes: [], range, totalDocs: 0 }).firstRun).toBe(true);
    expect(homeCounts({ docs: [], changes: [], range, totalDocs: 5 }).firstRun).toBe(false);
  });
  it("an invoice only counts as processed once it has been read; placeholders are counted as still being read", () => {
    const placeholders = [
      { id: "p1", status: "needs_review" as const, created_at: "2026-10-22T01:00:00Z", read_model: null },
      { id: "p2", status: "needs_review" as const, created_at: "2026-10-22T01:00:00Z" },
      { id: "r1", status: "needs_review" as const, created_at: "2026-10-22T01:00:00Z", read_model: "claude-sonnet-5-5" },
      { id: "s1", status: "nothing_to_apply" as const, created_at: "2026-10-22T01:00:00Z", read_model: null }, // a statement: finished without a read
      { id: "dup", status: "duplicate" as const, created_at: "2026-10-22T01:00:00Z", read_model: null },
    ];
    const c = homeCounts({ docs: placeholders, changes: [], range, totalDocs: 5 });
    expect(c.processed).toBe(2); // the read one and the statement
    expect(c.reading).toBe(2);
    // placeholders alone are not "first run" and not zero
    expect(homeCounts({ docs: placeholders.slice(0, 2), changes: [], range, totalDocs: 0 }).firstRun).toBe(false);
  });
  it("isUnread tells a placeholder from a read invoice and a finished statement", () => {
    expect(isUnread({ status: "needs_review", read_model: null })).toBe(true);
    expect(isUnread({ status: "needs_review", read_model: "m" })).toBe(false);
    expect(isUnread({ status: "applied", read_model: null })).toBe(false);
  });
  it("words", () => {
    expect(invoicesWord(1)).toBe("Invoice Processed");
    expect(invoicesWord(12)).toBe("Invoices Processed");
    expect(pricesWord(1)).toBe("Price Updated");
    expect(pricesWord(31)).toBe("Prices Updated");
  });
});

describe("the status sentence and the To Do wording", () => {
  const c = (over: object = {}) => ({ processed: 29, updated: 0, reading: 7, firstRun: false, ...over });
  it("leaves out any clause that is zero except the first", () => {
    expect(statusSentence(c())).toBe("29 invoices read this week. 7 are still being read.");
    expect(statusSentence(c({ updated: 12, reading: 0 }))).toBe("29 invoices read this week. 12 prices updated.");
    expect(statusSentence(c({ processed: 1, reading: 1, updated: 1 }))).toBe("1 invoice read this week. 1 is still being read. 1 price updated.");
    expect(statusSentence(c({ processed: 0, reading: 0 }))).toBe("0 invoices read this week.");
    expect(statusSentence(c({ updated: 3 }))).toBe("29 invoices read this week. 7 are still being read. 3 prices updated.");
  });
  it("says what to do when nothing has ever arrived", () => {
    expect(statusSentence(c({ firstRun: true }))).toBe("No invoices yet. Scan one and it appears here.");
  });
  it("the quiet Home line and the amber phrase", () => {
    expect(caughtUpLine({ processed: 29, updated: 0 })).toBe("29 invoices read this week, 0 prices updated");
    expect(caughtUpLine({ processed: 1, updated: 1 })).toBe("1 invoice read this week, 1 price updated");
    expect(todoPhrase({ items: 41, prices: 46, checks: 0 })).toBe("41 items to match, 46 prices to approve");
    expect(todoPhrase({ items: 1, prices: 0, checks: 2 })).toBe("1 item to match, 2 to check");
    expect(todoPhrase({ items: 0, prices: 0, checks: 0 })).toBe("");
    expect(todoTotal({ items: 41, prices: 46, checks: 2 })).toBe(89);
    expect(todoLabel(89)).toBe("To Do (89)");
    expect(todoLabel(0)).toBe("To Do");
  });
});

describe("hidden documents", () => {
  const docs = [
    { status: "duplicate" as const, read_model: "m" },
    { status: "duplicate" as const, read_model: "m" },
    { status: "duplicate" as const, read_model: "m" },
    ...Array.from({ length: 7 }, () => ({ status: "needs_review" as const, read_model: null })),
    { status: "needs_review" as const, read_model: "m" },
    { status: "applied" as const, read_model: "m" },
    { status: "failed" as const, read_model: null },
    { status: "ignored" as const, read_model: null },
  ];
  it("keeps duplicates, placeholders, unreadable and ignored documents out of sight", () => {
    expect(hiddenKind({ status: "needs_review", read_model: "m" })).toBeNull();
    expect(hiddenKind({ status: "needs_review", read_model: null })).toBe("reading");
    expect(hiddenCounts(docs)).toEqual({ duplicate: 3, reading: 7, failed: 1, ignored: 1 });
  });
  it("says what is hidden in one sentence", () => {
    expect(hiddenSentence({ duplicate: 3, reading: 7, failed: 0, ignored: 0 })).toBe("3 duplicates and 7 still being read are hidden.");
    expect(hiddenSentence({ duplicate: 1, reading: 0, failed: 0, ignored: 0 })).toBe("1 duplicate is hidden.");
    expect(hiddenSentence({ duplicate: 3, reading: 7, failed: 2, ignored: 0 })).toBe("3 duplicates, 7 still being read and 2 that could not be read are hidden.");
    expect(hiddenSentence({ duplicate: 0, reading: 0, failed: 0, ignored: 0 })).toBe("");
  });
  it("gives a revealed document its own plain label", () => {
    expect(hiddenLabel("duplicate", "793369")).toBe("Duplicate of #793369");
    expect(hiddenLabel("duplicate", null)).toBe("Duplicate");
    expect(hiddenLabel("reading")).toBe("Still being read");
    expect(hiddenLabel("failed")).toBe("Could not read");
    expect(hiddenLabel("ignored")).toBe("Ignored");
  });
});

describe("the outcome phrase for an invoice", () => {
  const none: DocOutcomeStats = { match: 0, approve: 0, checks: 0, changed: 0, upToDate: 0 };
  const read = { status: "needs_review" as const, reconciled: true, read_model: "m" };
  const L = (over: object) => ({ document_id: "d1", line_class: "product" as const, match_state: "matched" as const, decision: "none" as const, state: "open" as const, ...over });
  it("counts each document's lines and odd questions", () => {
    const lines = [
      L({}), // matched, nothing decided
      L({ match_state: "unmatched" }),
      L({ match_state: "unmatched" }),
      L({ match_state: "ambiguous" }),
      L({ decision: "needs_approval" }),
      L({ decision: "apply" }),
      L({ decision: "same" }),
      L({ state: "confirmed" }),
      L({ state: "applied" }),
      L({ line_class: "delivery", match_state: "ignored" }),
      L({ document_id: "d2", state: "applied" }),
    ];
    const m = outcomeStats(lines, [
      { document_id: "d1", kind: "unmatched_line" },
      { document_id: "d1", kind: "totals_mismatch" },
      { document_id: "d1", kind: "other" },
    ]);
    expect(outcomeFor(m, "d1")).toEqual({ match: 3, approve: 2, checks: 2, changed: 1, upToDate: 2 });
    expect(outcomeFor(m, "d2")).toEqual({ ...none, changed: 1 });
    expect(outcomeFor(m, "nope")).toEqual(none);
  });
  it("puts what waits on a person first, in plain words", () => {
    expect(outcomeView(read, { ...none, match: 9, approve: 2, changed: 3 })).toEqual({ word: "Match 9 items", tone: "warn", icon: "target" });
    expect(outcomeView(read, { ...none, match: 1 }).word).toBe("Match 1 item");
    expect(outcomeView(read, { ...none, approve: 2, changed: 3 }).word).toBe("Approve 2 prices");
    expect(outcomeView(read, { ...none, checks: 2 }).word).toBe("Check 2 things");
    expect(outcomeView(read, { ...none, checks: 1 }).word).toBe("Check 1 thing");
    expect(outcomeView({ ...read, reconciled: false }, none)).toMatchObject({ word: "Check 1 thing", tone: "warn" });
  });
  it("then what it already did, and only the waiting ones are amber", () => {
    expect(outcomeView(read, { ...none, changed: 3, upToDate: 9 })).toEqual({ word: "3 prices changed", tone: "neutral", icon: "check" });
    expect(outcomeView(read, { ...none, upToDate: 12 }).word).toBe("12 prices up to date");
    expect(outcomeView({ ...read, status: "nothing_to_apply" }, none)).toEqual({ word: "Nothing to update", tone: "neutral", icon: "dash" });
    expect(outcomeView({ status: "duplicate", reconciled: false, read_model: "m" }, none).word).toBe("Duplicate");
    expect(outcomeView({ status: "failed", reconciled: false }, none)).toMatchObject({ word: "Could not read", tone: "danger" });
  });
  it("never uses a dash in a phrase", () => {
    for (const s of [none, { ...none, match: 4 }, { ...none, approve: 4 }, { ...none, checks: 4 }, { ...none, changed: 4 }, { ...none, upToDate: 4 }]) expect(outcomeView(read, s).word).not.toMatch(/[–—]/);
  });
});

describe("the list", () => {
  const stats = new Map();
  it("sorts the newest invoice first", () => {
    const sorted = sortDocs([doc({ id: "a", invoice_date: "2026-10-01" }), doc({ id: "b", invoice_date: "2026-10-17" }), doc({ id: "c", invoice_date: null })]);
    expect(sorted.map((d) => d.id)).toEqual(["b", "a", "c"]);
    expect(stats.size).toBe(0);
  });
  it("filters by venue and by supplier or number", () => {
    const docs = [doc({ id: "d1", invoice_number: "793369" }), doc({ id: "d2", venue_id: 2, invoice_number: "ENV-23585" }), doc({ id: "d3", invoice_number: "51329" })];
    const titleOf = (d: { id: string }) => (d.id === "d2" ? "Diablo Co" : "Daniel Street Fish Market");
    expect(filterDocs(docs, { venueId: null, query: "", titleOf }).map((d) => d.id)).toEqual(["d1", "d2", "d3"]);
    expect(filterDocs(docs, { venueId: 1, query: "", titleOf }).map((d) => d.id)).toEqual(["d1", "d3"]);
    expect(filterDocs(docs, { venueId: null, query: "diablo", titleOf }).map((d) => d.id)).toEqual(["d2"]);
    expect(filterDocs(docs, { venueId: null, query: "#7933", titleOf }).map((d) => d.id)).toEqual(["d1"]);
    expect(filterDocs(docs, { venueId: 1, query: "env", titleOf }).map((d) => d.id)).toEqual([]);
  });
  it("groups under day headings in order", () => {
    const docs = sortDocs([
      doc({ id: "a", invoice_date: "2026-10-25" }),
      doc({ id: "b", invoice_date: "2026-10-25", created_at: "2026-10-24T01:00:00Z" }),
      doc({ id: "c", invoice_date: "2026-10-24" }),
      doc({ id: "d", invoice_date: "2026-10-19" }),
      doc({ id: "e", invoice_date: null, created_at: "2026-10-18T05:00:00Z" }),
    ]);
    expect(docDay(doc({ invoice_date: null, created_at: "2026-10-18T05:00:00Z" }))).toBe("2026-10-18");
    const g = groupByDay(docs, "2026-10-25");
    expect(g.map((x) => x.heading)).toEqual(["Today", "Yesterday", "Mon 19 Oct", "Sun 18 Oct"]);
    expect(g[0].docs.map((d) => d.id)).toEqual(["b", "a"]);
  });
  it("labels", () => {
    expect(numberLabel("51329")).toBe("#51329");
    expect(numberLabel(null)).toBe("No number");
    expect(invoiceSourceLabel("51329", "Daniel Street Fish Market", "2026-10-14")).toBe("Invoice 51329 · Daniel Street Fish Market · 14 Oct 2026");
  });
});

describe("checks in words", () => {
  it("a clean invoice", () => {
    const c = checkItems(doc());
    expect(c.map((x) => [x.label, x.ok])).toEqual([["Adds up", true], ["Not a duplicate", true]]);
  });
  it("the barramundi line that does not add up gives its reason", () => {
    const c = checkItems(
      doc({ reconciled: false, recon_notes: [{ check: "line_math", ok: false, message: "Line 2: 2.39 kg at $41.54 is $99.28, not $98.98." }] }),
    );
    expect(c[0]).toMatchObject({ label: "Does not add up", ok: false });
    expect(c[0].detail).toContain("$99.28");
  });
  it("the venue is not a check: no line whatever the stored venue check says, and old venue notes are skipped", () => {
    for (const venue_check of ["ok", "mismatch", "unknown"] as const) {
      const c = checkItems(doc({ venue_check, recon_notes: [{ check: "venue", ok: false, message: "The invoice does not name a venue." }] }));
      expect(c.map((x) => x.label)).toEqual(["Adds up", "Not a duplicate"]);
    }
  });
  it("a duplicate", () => {
    expect(checkItems(doc({ duplicate_of: "d0", status: "duplicate" }))[1]).toMatchObject({ label: "Possible duplicate", ok: false });
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
  it("gives each line ONE plain status", () => {
    expect(lineStatus(line({}))).toEqual({ kind: "waiting", word: "Changed +2.8% (waiting)", tone: "warn", icon: "target" });
    expect(lineStatus(line({ decision: "apply" })).word).toBe("Changed +2.8% (waiting)");
    expect(lineStatus(line({ state: "applied" }))).toMatchObject({ word: "Changed +2.8%", tone: "neutral", icon: "check" });
    expect(lineStatus(line({ state: "applied", change_pct: -0.011 })).word).toBe("Changed -1.1%");
    expect(lineStatus(line({ state: "applied", change_pct: null, old_pack_price: null, new_pack_price: null })).word).toBe("Changed");
    expect(lineStatus(line({ state: "confirmed" })).word).toBe("Matches");
    expect(lineStatus(line({ decision: "same" })).word).toBe("Matches");
    expect(lineStatus(line({ state: "approved_skip" })).word).toBe("Skipped");
    expect(lineStatus(line({ state: "reverted" })).word).toBe("Put back");
    expect(lineStatus(line({ decision: "none", match_state: "unmatched" }))).toMatchObject({ word: "Needs matching", tone: "warn", kind: "needs_matching" });
    expect(lineStatus(line({ decision: "none", match_state: "ambiguous" })).word).toBe("Needs matching");
    expect(lineStatus(line({ decision: "none", match_state: "ignored" })).word).toBe("Not in the app");
    expect(lineStatus(line({ decision: "none" })).word).toBe("Nothing to update");
    expect(signedPct(0.0284)).toBe("+2.8%");
    expect(signedPct(-0.05)).toBe("-5.0%");
    expect(signedPct(0.0001)).toBe("0%");
    expect(signedPct(null)).toBe("");
  });
  it("sums an invoice up in one sentence", () => {
    const nine = Array.from({ length: 9 }, (_, i) => line({ id: `m${i}`, decision: "same" }));
    const three = Array.from({ length: 3 }, (_, i) => line({ id: `c${i}` }));
    expect(detailSentence([...nine, ...three])).toBe("12 prices were checked: 9 match, 3 changed and wait for approval.");
    expect(detailSentence([line({ decision: "same" })])).toBe("1 price was checked: 1 matches.");
    expect(detailSentence([line({ state: "applied" }), line({ decision: "same" })])).toBe("2 prices were checked: 1 matches, 1 was updated.");
    expect(detailSentence([line({ decision: "none", match_state: "unmatched" }), line({ decision: "none", match_state: "unmatched" }), line({ decision: "none", match_state: "ignored" })])).toBe("2 items still need matching. 1 item is not in the app.");
    expect(detailSentence([line({ decision: "none", match_state: "unmatched" })])).toBe("1 item still needs matching.");
    expect(detailSentence([])).toBe("No prices were read from this invoice.");
    expect(detailSentence([...nine, ...three])).not.toMatch(/[–—]|decision|guard|reconcil/i);
  });
  it("lets a person approve and skip", () => {
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
    const words = [undoTitle(1), undoBody({ kind: "price_change", old_price: 1, new_price: 2 }, "X", 2), invoicesWord(2), pricesWord(2)];
    for (const w of words) expect(w).not.toMatch(/[–—]/);
  });
});
