import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  WEEKLY_MAX_MOVES,
  WEEKLY_REVIEW_MARKER,
  WEEKLY_TEXT_LIMIT,
  buildWeeklyReview,
  isWeeklyReviewBody,
  shortVenueName,
  sortMoves,
  splitWeeklyByVenue,
  weekdayDayLabel,
  type AttentionItem,
  type DiscountNote,
  type WeeklyReviewData,
  type WeeklyVenueData,
} from "@/lib/invoice-digest";

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;

const ORIGIN = "https://precinct-costing.vercel.app";
/** Friday 30 Oct 2026, 8:10am in Brisbane */
const NOW = new Date("2026-10-29T22:10:00Z");
const DASHES = /[—–―]/;

const move = (item: string, oldPrice: number, newPrice: number, unit = "KG", supplier = "Daniel Street Fish Market"): AttentionItem => ({
  supplier,
  item,
  oldPrice,
  newPrice,
  unit,
  pct: (newPrice - oldPrice) / oldPrice,
});

function venue(over: Partial<WeeklyVenueData>): WeeklyVenueData {
  return { venueName: "Drift", venueSlug: "drift", invoicesRead: 0, pricesUpdated: 0, pricesConfirmed: 0, moves: [], discounts: [], toMatch: 0, toApprove: 0, toCheck: 0, stillReading: 0, ...over };
}

const review = (venues: WeeklyVenueData[], now = NOW): WeeklyReviewData => ({ now, origin: ORIGIN, venues });

const BARRA_DISCOUNT: DiscountNote = { supplier: "Daniel Street Fish Market", item: "Humpty Doo Barramundi fillets", status: "standing", pctMean: 0.1662, pctMin: 0.1655, pctMax: 0.167, perUnit: 6.88, unit: "kg" };

function busyWeek(): WeeklyReviewData {
  return review([
    venue({
      invoicesRead: 18,
      pricesUpdated: 22,
      pricesConfirmed: 7,
      moves: [
        move("Kingfish fillets", 68.9, 74.2),
        move("Lychee Liqueur 700ml", 38.24, 38.62, "EA", "CD Australia Pty Ltd trading as Diablo Co"),
        move("Humpty Doo Barramundi fillets", 41.54, 44.1),
        move("Diablo Ginger Beer 50L Keg", 359, 332.5, "EA", "CD Australia Pty Ltd trading as Diablo Co"),
        move("Cos lettuce", 2.1, 2.45, "EA", "Bidfood"),
        move("Sourdough loaf", 4.5, 4.55, "EA", "Bidfood"),
      ],
      discounts: [BARRA_DISCOUNT],
      toMatch: 41,
      toApprove: 5,
      toCheck: 2,
      stillReading: 7,
    }),
    venue({ venueName: "Chiobu", venueSlug: "chiobu", invoicesRead: 6, pricesUpdated: 9, pricesConfirmed: 2, moves: [move("Dassai 45 Sake 720ml", 41.5, 40.17, "EA", "Paramount Liquor")], toMatch: 3 }),
    venue({ venueName: "Greedy Gringo's", venueSlug: "greedy", invoicesRead: 5, pricesUpdated: 15, pricesConfirmed: 3 }),
  ]);
}

describe("buildWeeklyReview", () => {
  it("a busy week across three venues, word for word (moves merged and capped at 5, biggest first, each said once)", () => {
    expect(buildWeeklyReview(busyWeek())).toBe(
      [
        ":receipt: *Invoice review: week to Fri 30 Oct*",
        "29 invoices read (Drift 18, Chiobu 6, Greedy 5). 46 prices updated, 12 confirmed as unchanged.",
        "",
        "*Biggest price moves* (top 5 by percent, up or down):",
        "• Cos lettuce (Bidfood): $2.10 to $2.45 each, up 16.7%",
        "• Kingfish fillets (Daniel Street Fish Market): $68.90 to $74.20 per kg, up 7.7%",
        "• Diablo Ginger Beer 50L Keg (Diablo Co): $359.00 to $332.50 each, down 7.4%",
        "• Humpty Doo Barramundi fillets (Daniel Street Fish Market): $41.54 to $44.10 per kg, up 6.2%",
        "• Dassai 45 Sake 720ml (Paramount Liquor): $41.50 to $40.17 each, down 3.2%",
        "",
        "*Supplier discounts we spotted*:",
        "• Daniel Street Fish Market takes 16.6% ($6.88 per kg) off Humpty Doo Barramundi fillets.",
        "",
        "*Still to do*:",
        "• Drift: 41 items to match, 5 prices to approve, 2 to check",
        "• Chiobu: 3 items to match",
        "*Reading*: 7 invoices are still being read.",
        "",
        "<https://precinct-costing.vercel.app/invoices?tab=todo|Open Invoices>",
      ].join("\n"),
    );
  });

  it("the same price move on many invoices, or at several venues, is ONE line with how many invoices (Troy, 30 Oct 2026: the same chips line five times)", () => {
    const chips = () => move("Chips 10mm supa crunch ultrafast", 58.19, 51.7, "CTN", "Bidfood Sunshine Coast");
    const text = buildWeeklyReview(
      review([
        venue({ invoicesRead: 38, pricesUpdated: 5, moves: [chips(), chips(), chips(), chips(), chips()] }),
        venue({ venueName: "Chiobu", venueSlug: "chiobu", invoicesRead: 22, moves: [chips(), chips()] }),
      ]),
    );
    const lines = text.split("\n").filter((l) => l.startsWith("• Chips"));
    expect(lines).toEqual(["• Chips 10mm supa crunch ultrafast (Bidfood Sunshine Coast): $58.19 to $51.70 per carton, down 11.2% (on 7 invoices)"]);
    expect(text).toContain("*Biggest price move* (by percent, up or down):");
    // a different price for the same item is a different move
    const two = buildWeeklyReview(review([venue({ invoicesRead: 2, moves: [chips(), move("Chips 10mm supa crunch ultrafast", 51.7, 53, "CTN", "Bidfood Sunshine Coast")] })]));
    expect(two.split("\n").filter((l) => l.startsWith("• Chips"))).toHaveLength(2);
  });

  it("a quiet week is still one predictable line", () => {
    expect(buildWeeklyReview(review([venue({}), venue({ venueName: "Chiobu", venueSlug: "chiobu" })]))).toBe(":receipt: *Invoice review: week to Fri 30 Oct*\nNothing new this week. All caught up.");
    expect(buildWeeklyReview(review([]))).toBe(":receipt: *Invoice review: week to Fri 30 Oct*\nNothing new this week. All caught up.");
  });

  it("a week with nothing read but things waiting still says what is waiting, with the link", () => {
    expect(buildWeeklyReview(review([venue({ toMatch: 1, toApprove: 1, stillReading: 1 })]))).toBe(
      [
        ":receipt: *Invoice review: week to Fri 30 Oct*",
        "No new invoices were read this week.",
        "",
        "*Still to do*:",
        "• Drift: 1 item to match, 1 price to approve",
        "*Reading*: 1 invoice is still being read.",
        "",
        "<https://precinct-costing.vercel.app/invoices?tab=todo|Open Invoices>",
      ].join("\n"),
    );
  });

  it("one venue, all caught up: singular words, no prices changed, no link", () => {
    expect(buildWeeklyReview(review([venue({ invoicesRead: 1 })]))).toBe(
      [":receipt: *Invoice review: week to Fri 30 Oct*", "1 invoice read at Drift. No prices changed.", "", "Nothing is waiting on you."].join("\n"),
    );
    expect(buildWeeklyReview(review([venue({ invoicesRead: 9, pricesUpdated: 1 })]))).toContain("9 invoices read at Drift. 1 price updated.\n");
    expect(buildWeeklyReview(review([venue({ invoicesRead: 2, pricesConfirmed: 1 })]))).toContain("2 invoices read at Drift. 1 price confirmed as unchanged.\n");
  });

  it("only venues with something to say get a section", () => {
    const text = buildWeeklyReview(review([venue({ invoicesRead: 2, pricesUpdated: 2 }), venue({ venueName: "Chiobu", venueSlug: "chiobu" }), venue({ venueName: "Greedy Gringo's", venueSlug: "greedy", toCheck: 3 })]));
    expect(text).toContain("2 invoices read at Drift. 2 prices updated.");
    expect(text).not.toContain("Chiobu");
    expect(text).toContain("*Still to do*:\n• Greedy: 3 to check");
  });

  it("caps the price moves at 5 and keeps the biggest, up or down, with ties in a fixed order", () => {
    const moves = [
      move("Bravo", 10, 11), // +10%
      move("Alpha", 10, 11), // +10% (ties with Bravo: Alpha first)
      move("Charlie", 10, 9), // -10% (a tie in size, down)
      move("Delta", 10, 12), // +20%
      move("Echo", 10, 8), // -20%
      move("Foxtrot", 10, 10.5), // +5%
      move("Golf", 10, 10.2), // +2%
    ];
    expect(WEEKLY_MAX_MOVES).toBe(5);
    expect(sortMoves(moves).map((m) => m.item)).toEqual(["Delta", "Echo", "Alpha", "Bravo", "Charlie", "Foxtrot", "Golf"]);
    const text = buildWeeklyReview(review([venue({ invoicesRead: 1, pricesUpdated: 7, moves })]));
    const lines = text.split("\n").filter((l) => l.startsWith("•"));
    expect(lines.map((l) => l.split(" (")[0])).toEqual(["• Delta", "• Echo", "• Alpha", "• Bravo", "• Charlie"]);
    expect(text).not.toContain("Foxtrot");
    expect(text).toContain("(top 5 by percent, up or down)");
    expect(buildWeeklyReview(review([venue({ invoicesRead: 1, moves: [...moves].reverse() })]))).toBe(buildWeeklyReview(review([venue({ invoicesRead: 1, moves })])));
  });

  it("escapes and strips anything hostile from supplier, item and venue strings", () => {
    const hostile = review([
      venue({
        venueName: "Dri<!channel>ft & <@U12345>",
        invoicesRead: 1,
        pricesUpdated: 1,
        moves: [
          move("<!here> Kingfish > <#C123|general> fillets <https://evil.example|click here> &amp; <b>co</b>", 10, 12, "<KG>", "<!channel> Evil <@U999> Fish — Market <mailto:a@b.c|x>"),
        ],
        discounts: [{ ...BARRA_DISCOUNT, supplier: "<!everyone> Dodgy Supplier", item: "Barra <https://evil.example|safe> fillets" }],
        toMatch: 1,
      }),
    ]);
    const text = buildWeeklyReview(hostile);
    for (const bad of ["<!", "<@", "<#", "evil.example", "<https://evil", "<mailto", "@everyone", "<b>", "<KG>"]) expect(text).not.toContain(bad);
    expect(text).not.toMatch(DASHES);
    // the only angle brackets left are the app link's own
    expect(text.match(/</g)).toHaveLength(1);
    expect(text.match(/>/g)).toHaveLength(1);
    expect(text).toContain("Kingfish &gt;");
    expect(text).toContain("<https://precinct-costing.vercel.app/invoices?tab=todo|Open Invoices>");
  });

  it("never leaves a dash, more than one emoji, or technical words in the text", () => {
    const texts = [buildWeeklyReview(busyWeek()), buildWeeklyReview(review([])), buildWeeklyReview(review([venue({ toMatch: 2, stillReading: 1 })]))];
    for (const t of texts) {
      expect(t).not.toMatch(DASHES);
      expect(t.match(/:[a-z_]+:/g)).toEqual([":receipt:"]);
      expect(t.startsWith(":receipt: *")).toBe(true);
      expect(t).not.toMatch(/reconcil|learning mode|guard|claude|anthropic|\bAI\b|credential|password|token|\.pdf/i);
    }
  });

  it("stays under about 2500 characters however much happened, and keeps the counts", () => {
    const longMoves = (tag: string) =>
      Array.from({ length: 12 }, (_, i) => move(`${tag} extremely long product description number ${i} with plenty of words`, 10, 10 + i + 1, "KG", `${tag} Wholesale Distribution Company of Australia`));
    const discounts = Array.from({ length: 6 }, (_, i): DiscountNote => ({ ...BARRA_DISCOUNT, item: `Discounted item with a very long name number ${i} for testing`, supplier: "Daniel Street Fish Market and Sons" }));
    const huge = review(
      ["Drift", "Chiobu", "Greedy Gringo's"].map((name) => venue({ venueName: name, venueSlug: name.toLowerCase(), invoicesRead: 30, pricesUpdated: 40, pricesConfirmed: 10, moves: longMoves(name), discounts, toMatch: 99, toApprove: 12, toCheck: 4, stillReading: 3 })),
    );
    const text = buildWeeklyReview(huge);
    expect(text.length).toBeLessThanOrEqual(WEEKLY_TEXT_LIMIT);
    expect(text).toContain("• Drift: 99 items to match, 12 prices to approve, 4 to check");
    expect(text).toContain("<https://precinct-costing.vercel.app/invoices?tab=todo|Open Invoices>");
    expect((text.match(/^• Drift:/gm) ?? []).length).toBe(1);
    // a normal busy week is not trimmed at all
    expect(buildWeeklyReview(busyWeek())).toContain("(top 5 by percent");
  });

  it("can be split by venue for the day each venue gets its own channel", () => {
    const parts = splitWeeklyByVenue(busyWeek()).map(buildWeeklyReview);
    expect(parts).toHaveLength(3);
    expect(parts[0]).toContain("18 invoices read at Drift.");
    expect(parts[0]).not.toContain("Chiobu");
    expect(parts[1]).toContain("6 invoices read at Chiobu.");
    expect(parts[2]).toBe([":receipt: *Invoice review: week to Fri 30 Oct*", "5 invoices read at Greedy. 15 prices updated, 3 confirmed as unchanged.", "", "Nothing is waiting on you."].join("\n"));
  });

  it("small helpers: the week label is Brisbane time, venue names are short, the marker is found", () => {
    expect(weekdayDayLabel(NOW)).toBe("Fri 30 Oct");
    expect(weekdayDayLabel(new Date("2026-10-30T14:30:00Z"))).toBe("Sat 31 Oct"); // 00:30 Saturday in Brisbane
    expect(weekdayDayLabel(new Date("2026-10-30T13:59:00Z"))).toBe("Fri 30 Oct");
    expect(shortVenueName("Greedy Gringo's")).toBe("Greedy");
    expect(shortVenueName("Gelato Rumba")).toBe("Gelato Rumba");
    expect(shortVenueName(null)).toBe("A venue");
    expect(isWeeklyReviewBody(buildWeeklyReview(busyWeek()))).toBe(true);
    expect(isWeeklyReviewBody(buildWeeklyReview(review([])))).toBe(true);
    expect(isWeeklyReviewBody("*Drift: 2 invoices processed.* 1 price updated.")).toBe(false);
    expect(isWeeklyReviewBody(null)).toBe(false);
    expect(WEEKLY_REVIEW_MARKER).toBe("Invoice review: week to");
  });

  it("describes a varying and a once-seen discount", () => {
    const text = buildWeeklyReview(
      review([venue({ invoicesRead: 1, discounts: [{ ...BARRA_DISCOUNT, status: "varies", pctMin: 0.15, pctMax: 0.17 }, { ...BARRA_DISCOUNT, supplier: "Star Spirits Pty Ltd", item: "Vodka", status: "seen once", pctMean: 0.1, perUnit: null, unit: null }] })]),
    );
    expect(text).toContain("• Daniel Street Fish Market takes between 15.0% and 17.0% off Humpty Doo Barramundi fillets.");
    expect(text).toContain("• Star Spirits took 10.0% off Vodka.");
  });
});

// ================================================================ the data side
import { assembleWeeklyData, loadWeeklyRaw, priceDiffers, reviewPeriod, sendWeeklyReview } from "@/lib/invoice-digest-data";

/** A small in-memory stand-in for the parts of supabase-js the weekly review uses. */
function fakeSb(tables: Tables) {
  const upserts: { table: string; row: Row }[] = [];
  const reads: string[] = [];
  const cmp = (a: unknown, b: unknown): number => {
    if (typeof a === "string" && typeof b === "string" && /^\d{4}-\d\d-\d\dT/.test(a) && /^\d{4}-\d\d-\d\dT/.test(b)) return Date.parse(a) - Date.parse(b);
    if (typeof a === "number" && typeof b === "number") return a - b;
    return String(a).localeCompare(String(b));
  };
  const from = (table: string) => {
    const filters: ((r: Row) => boolean)[] = [];
    let op: "select" | "upsert" = "select";
    let row: Row = {};
    let orderBy: string | null = null;
    let desc = false;
    let window: [number, number] | null = null;
    let max = Infinity;
    const b: Record<string, unknown> = {};
    const chain = (fn: (...a: never[]) => void) => (...a: never[]) => (fn(...a), b);
    b.select = chain(() => {});
    b.eq = chain(((c: string, v: unknown) => filters.push((r) => r[c] === v)) as never);
    b.in = chain(((c: string, vs: unknown[]) => filters.push((r) => vs.includes(r[c]))) as never);
    b.is = chain(((c: string, v: unknown) => filters.push((r) => (r[c] ?? null) === v)) as never);
    b.gte = chain(((c: string, v: unknown) => filters.push((r) => r[c] != null && cmp(r[c], v) >= 0)) as never);
    b.gt = chain(((c: string, v: unknown) => filters.push((r) => r[c] != null && cmp(r[c], v) > 0)) as never);
    b.order = chain(((c: string, o?: { ascending?: boolean }) => ((orderBy = c), (desc = o?.ascending === false))) as never);
    b.range = chain(((x: number, y: number) => (window = [x, y])) as never);
    b.limit = chain(((n: number) => (max = n)) as never);
    b.upsert = chain(((r: Row) => ((op = "upsert"), (row = r))) as never);
    b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve()
        .then(() => {
          const t = (tables[table] ??= []);
          if (op === "upsert") {
            t.push({ ...row });
            upserts.push({ table, row: { ...row } });
            return { data: null, error: null };
          }
          reads.push(table);
          let out = t.filter((r) => filters.every((f) => f(r))).map((r) => ({ ...r }));
          if (orderBy) out = out.sort((x, y) => (desc ? -1 : 1) * cmp(x[orderBy!], y[orderBy!]));
          if (window) out = out.slice(window[0], window[1] + 1);
          return { data: out.slice(0, max), error: null };
        })
        .then(res, rej);
    return b;
  };
  return { sb: { from } as never, upserts, tables, reads };
}

const S1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"; // Daniel Street Fish Market
const S2 = "aaaaaaaa-aaaa-4aaa-8aaa-bbbbbbbbbbbb"; // CD Australia Pty Ltd trading as Diablo Co
const id = (n: number) => `d0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [D1, D2, D3, D4, D5, D6, D7, D8, D9, D10, D11, D12] = Array.from({ length: 12 }, (_, i) => id(i + 1));
const q = (n: number) => `e0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const l = (n: number) => `f0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const doc = (idv: string, venue_id: number, over: Row = {}): Row => ({
  id: idv,
  venue_id,
  supplier_id: S1,
  supplier_name_read: "DANIEL STREET",
  doc_type: "invoice",
  status: "applied",
  read_model: "model-x",
  created_at: "2026-10-28T01:00:00Z",
  invoice_number: null,
  invoice_date: "2026-10-28",
  ...over,
});

const line = (n: number, document_id: string, venue_id: number, over: Row = {}): Row => ({
  id: l(n),
  document_id,
  venue_id,
  invoice_date: "2026-10-28",
  line_no: n,
  line_class: "product",
  item_code: null,
  description: "Line",
  unit: "KG",
  unit_price_ex: null,
  qty: null,
  base_qty: null,
  base_unit: null,
  change_pct: null,
  discount_pct: null,
  discount_per_base: null,
  old_pack_price: null,
  new_pack_price: null,
  old_product_price: null,
  new_product_price: null,
  decision: "none",
  state: "open",
  ingredient_id: null,
  ...over,
});

const question = (n: number, document_id: string, venue_id: number, kind: string, over: Row = {}): Row => ({
  id: q(n),
  venue_id,
  document_id,
  line_id: null,
  kind,
  prompt: "A question",
  status: "open",
  ...over,
});

function dataset(): Tables {
  return {
    cost_venues: [
      { id: 1, name: "Drift", slug: "drift", sort: 1 },
      { id: 2, name: "Chiobu", slug: "chiobu", sort: 2 },
      { id: 3, name: "Greedy Gringo's", slug: "greedy", sort: 3 },
    ],
    invoice_suppliers: [
      { id: S1, name: "Daniel Street Fish Market" },
      { id: S2, name: "CD Australia Pty Ltd trading as Diablo Co" },
    ],
    invoice_documents: [
      doc(D1, 1), // read this week
      doc(D2, 1, { supplier_id: S2, supplier_name_read: "CD Australia", status: "needs_review" }), // read (has a model), waiting on a person
      doc(D3, 1, { status: "duplicate" }),
      doc(D4, 1, { status: "failed", read_model: null }),
      doc(D5, 1, { status: "ignored" }),
      doc(D6, 1, { status: "needs_review", read_model: null }), // found in a scan, not read yet
      doc(D7, 3, { supplier_id: null, supplier_name_read: "Star", status: "nothing_to_apply" }),
      doc(D8, 1, { created_at: "2026-10-01T01:00:00Z", invoice_date: "2026-10-01", status: "needs_review" }), // an older invoice with open questions
      doc(D9, 3, { doc_type: "statement", status: "nothing_to_apply" }), // a statement is not an invoice
      doc(D10, 1, { created_at: "2026-10-02T01:00:00Z", invoice_date: "2026-10-02", status: "needs_review" }),
      doc(D11, 1, { created_at: "2026-10-14T01:00:00Z", invoice_date: "2026-10-14" }), // an earlier invoice with the barramundi discount
      doc(D12, 1, { created_at: "2026-10-21T22:00:00Z" }), // just before the week starts (the week starts Thu 22 Oct 22:10 UTC)
    ],
    invoice_lines: [
      // price moves and approvals
      line(1, D1, 1, { item_code: "15026", description: "KINGFISH FILLETS", unit_price_ex: 74.2, change_pct: 0.0769, old_pack_price: 68.9, new_pack_price: 74.2, decision: "needs_approval", state: "open" }),
      line(2, D1, 1, { description: "Humpty Doo Barramundi fillets", unit_price_ex: 44.1, change_pct: 0.0616, old_pack_price: 41.54, new_pack_price: 44.1, decision: "apply", state: "applied" }),
      line(3, D2, 1, { description: "Lychee Liqueur 700ml", unit: "EA", unit_price_ex: 38.62, change_pct: 0.01, old_pack_price: 38.24, new_pack_price: 38.62, decision: "apply", state: "open" }),
      line(4, D2, 1, { description: "Ginger beer", unit: "EA", unit_price_ex: 10.001, change_pct: 0.0001, old_pack_price: 10, new_pack_price: 10.001, decision: "apply", state: "open" }),
      line(5, D2, 1, { description: "Same price", unit_price_ex: 5, change_pct: 0, old_pack_price: 5, new_pack_price: 5, decision: "same", state: "confirmed" }),
      line(6, D7, 3, { description: "Vodka 700ml", unit: "EA", unit_price_ex: 30, change_pct: -0.04, old_product_price: 31.25, new_product_price: 30, decision: "needs_approval", state: "open" }),
      line(7, D3, 1, { description: "Duplicate copy", unit_price_ex: 9, change_pct: 0.5, old_pack_price: 6, new_pack_price: 9, decision: "needs_approval", state: "open" }),
      line(8, D1, 1, { description: "Reverted line", unit_price_ex: 9, change_pct: 0.5, old_pack_price: 6, new_pack_price: 9, decision: "apply", state: "reverted" }),
      // lines the open questions point at
      line(11, D1, 1, { item_code: "15026", description: "Kingfish fillets skin on" }),
      line(12, D8, 1, { item_code: " 15 026 ", description: "KINGFISH FILLETS WING OFF" }),
      line(13, D10, 1, { description: "Humpty Doo Barramundi 1kg" }),
      line(14, D1, 1, { description: "HUMPTY DOO BARRAMUNDI 1KG" }),
      line(15, D3, 1, { item_code: "DUP1", description: "Only on a duplicate" }),
      line(16, D4, 1, { item_code: "FAIL1", description: "Only on a failed one" }),
      line(17, D7, 3, { item_code: "STAR1", description: "Star vodka" }),
      // the barramundi discount, on this week's invoice and an earlier one; and a discount last seen weeks ago
      line(21, D1, 1, { description: "Humpty Doo Barramundi fillets", unit_price_ex: 41.54, qty: 2.39, base_qty: 2.39, base_unit: "kg", discount_pct: 0.1662, discount_per_base: 6.88, invoice_date: "2026-10-28" }),
      line(22, D11, 1, { description: "Humpty Doo Barramundi fillets", unit_price_ex: 41.54, qty: 2, base_qty: 2, base_unit: "kg", discount_pct: 0.1662, discount_per_base: 6.88, invoice_date: "2026-10-14" }),
      line(23, D10, 1, { description: "Old supplier discount item", discount_pct: 0.1, discount_per_base: 1, base_unit: "kg", invoice_date: "2026-10-02" }),
    ],
    invoice_questions: [
      // items to match: three invoices, two distinct items (code 15026 twice, the barramundi description twice)
      question(1, D1, 1, "unmatched_line", { line_id: l(11) }),
      question(2, D8, 1, "ambiguous_match", { line_id: l(12) }),
      question(3, D10, 1, "unmatched_line", { line_id: l(13) }),
      question(4, D1, 1, "unmatched_line", { line_id: l(14) }),
      question(5, D3, 1, "unmatched_line", { line_id: l(15) }), // duplicate document: left out
      question(6, D4, 1, "unmatched_line", { line_id: l(16) }), // failed document: left out
      question(7, D1, 1, "unmatched_line", { line_id: l(11), status: "answered" }), // answered: left out
      question(8, D7, 3, "unmatched_line", { line_id: l(17) }),
      // to check
      question(10, D1, 1, "unit_unclear"),
      question(11, D1, 1, "totals_mismatch"),
      question(12, D1, 1, "new_supplier", { prompt: "The invoice says Daniel Street with ABN 61 151 388 094, but we have that supplier with ABN 11 111 111 111. Is it the same supplier?" }),
      question(13, D1, 1, "new_supplier", { prompt: "We have not seen Daniel Street before. Is this a new supplier?" }), // not an ABN mismatch: not counted
      question(14, D2, 1, "other"),
      question(15, D1, 1, "big_change"), // counted as a price to approve, not here
      question(16, D1, 1, "venue_mismatch"),
      question(17, D3, 1, "credit_unclear"), // duplicate document
      question(18, D7, 3, "credit_unclear"),
    ],
    invoice_price_changes: [
      { id: "c1", venue_id: 1, kind: "price_change", status: "applied", applied_at: "2026-10-28T02:00:00Z", document_id: D1 },
      { id: "c2", venue_id: 1, kind: "price_change", status: "applied", applied_at: "2026-10-29T02:00:00Z", document_id: D1 },
      { id: "c3", venue_id: 1, kind: "price_change", status: "applied", applied_at: "2026-10-29T03:00:00Z", document_id: D2 },
      { id: "c4", venue_id: 1, kind: "price_confirmed", status: "applied", applied_at: "2026-10-29T04:00:00Z", document_id: D2 },
      { id: "c5", venue_id: 1, kind: "price_confirmed", status: "applied", applied_at: "2026-10-27T04:00:00Z", document_id: D2 },
      { id: "c6", venue_id: 1, kind: "price_change", status: "applied", applied_at: "2026-10-10T04:00:00Z", document_id: D11 }, // before the week
      { id: "c7", venue_id: 1, kind: "price_change", status: "reverted", applied_at: "2026-10-28T04:00:00Z", document_id: D1 }, // undone
      { id: "c8", venue_id: 3, kind: "price_change", status: "applied", applied_at: "2026-10-28T04:00:00Z", document_id: D7 },
    ],
    invoice_digests: [],
  };
}

async function weekly(tables: Tables = dataset()) {
  const f = fakeSb(tables);
  const raw = await loadWeeklyRaw(f.sb, NOW);
  return { f, raw, data: assembleWeeklyData(raw, ORIGIN) };
}

describe("the weekly numbers (definitions shared with the To Do screens)", () => {
  it("the period is the 7 days up to the run, Brisbane dates", () => {
    const p = reviewPeriod(NOW);
    expect(p.from.toISOString()).toBe("2026-10-22T22:10:00.000Z");
    expect(p.fromDay).toBe("2026-10-23");
    expect(p.toDay).toBe("2026-10-30");
  });

  it("counts invoices read (not duplicate, failed, ignored, unread or statements) and prices updated or confirmed in the week", async () => {
    const { data } = await weekly();
    const drift = data.venues.find((v) => v.venueSlug === "drift")!;
    expect(drift.invoicesRead).toBe(2); // D1 and D2; D12 was before the week, D6 is unread, D3 D4 D5 are set aside
    expect(drift.pricesUpdated).toBe(3); // c1 c2 c3; not the old one, not the undone one
    expect(drift.pricesConfirmed).toBe(2); // c4 c5
    expect(drift.stillReading).toBe(1); // D6
    const greedy = data.venues.find((v) => v.venueSlug === "greedy")!;
    expect(greedy.invoicesRead).toBe(1); // D7; the statement D9 is not an invoice
    expect(greedy.pricesUpdated).toBe(1);
    expect(data.venues.find((v) => v.venueSlug === "chiobu")).toMatchObject({ invoicesRead: 0, pricesUpdated: 0, toMatch: 0, toApprove: 0, toCheck: 0 });
  });

  it("items to match are the DISTINCT supplier and item among open match questions, on documents still in play", async () => {
    const { data } = await weekly();
    // questions 1, 2 (same code once normalised), 3 and 4 (same description once normalised) on one supplier: two items.
    // Duplicate, failed and answered ones are left out.
    expect(data.venues.find((v) => v.venueSlug === "drift")!.toMatch).toBe(2);
    expect(data.venues.find((v) => v.venueSlug === "greedy")!.toMatch).toBe(1);
  });

  it("the same item code from a different supplier is a different item", async () => {
    const t = dataset();
    t.invoice_documents.push(doc(id(30), 1, { supplier_id: S2, supplier_name_read: "Diablo", status: "needs_review" }));
    t.invoice_lines.push(line(30, id(30), 1, { item_code: "15026", description: "Something else" }));
    t.invoice_questions.push(question(30, id(30), 1, "unmatched_line", { line_id: l(30) }));
    const { data } = await weekly(t);
    expect(data.venues.find((v) => v.venueSlug === "drift")!.toMatch).toBe(3);
  });

  it("prices to approve are open product lines that really change the price, on documents still in play", async () => {
    const { data } = await weekly();
    // line 1 (68.90 to 74.20) and line 3 (38.24 to 38.62) count; line 4 differs by a tenth of a cent; line 7 is on a duplicate; line 8 is reverted
    expect(data.venues.find((v) => v.venueSlug === "drift")!.toApprove).toBe(2);
    expect(data.venues.find((v) => v.venueSlug === "greedy")!.toApprove).toBe(1); // an ordering product price pair
  });

  it("to check counts the other open questions, and a supplier question only when it is about an ABN", async () => {
    const { data } = await weekly();
    // unit_unclear, totals_mismatch, new_supplier with an ABN, other = 4; not the plain new supplier, big_change, venue_mismatch or the duplicate's
    expect(data.venues.find((v) => v.venueSlug === "drift")!.toCheck).toBe(4);
    expect(data.venues.find((v) => v.venueSlug === "greedy")!.toCheck).toBe(1);
  });

  it("price moves come from this week's read invoices only, applied or waiting, up or down", async () => {
    const { data } = await weekly();
    const drift = data.venues.find((v) => v.venueSlug === "drift")!;
    expect(sortMoves(drift.moves).map((m) => [m.item, m.supplier, m.oldPrice, m.newPrice])).toEqual([
      ["KINGFISH FILLETS", "Daniel Street Fish Market", 68.9, 74.2],
      ["Humpty Doo Barramundi fillets", "Daniel Street Fish Market", 41.54, 44.1],
      ["Lychee Liqueur 700ml", "Diablo Co", 38.24, 38.62],
    ]);
    const greedy = data.venues.find((v) => v.venueSlug === "greedy")!;
    expect(greedy.moves).toHaveLength(1);
    expect(greedy.moves[0]).toMatchObject({ item: "Vodka 700ml", supplier: "Star", oldPrice: 31.25, newPrice: 30 });
  });

  it("a supplier discount appears only when its latest invoice falls in the week", async () => {
    const { data } = await weekly();
    const drift = data.venues.find((v) => v.venueSlug === "drift")!;
    expect(drift.discounts).toHaveLength(1);
    expect(drift.discounts[0]).toMatchObject({ supplier: "Daniel Street Fish Market", status: "standing", pctMean: 0.1662, perUnit: 6.88, unit: "kg" });
    // the discount last seen on 2 Oct is not news
    expect(drift.discounts.some((d) => /Old supplier/.test(d.item))).toBe(false);
  });

  it("the full message for this data, word for word", async () => {
    const { data } = await weekly();
    expect(buildWeeklyReview(data)).toBe(
      [
        ":receipt: *Invoice review: week to Fri 30 Oct*",
        "3 invoices read (Drift 2, Greedy 1). 4 prices updated, 2 confirmed as unchanged.",
        "",
        "*Biggest price moves* (top 4 by percent, up or down):",
        "• Kingfish fillets (Daniel Street Fish Market): $68.90 to $74.20 per kg, up 7.7%",
        "• Humpty Doo Barramundi fillets (Daniel Street Fish Market): $41.54 to $44.10 per kg, up 6.2%",
        "• Vodka 700ml (Star): $31.25 to $30.00 each, down 4.0%",
        "• Lychee Liqueur 700ml (Diablo Co): $38.24 to $38.62 each, up 1.0%",
        "",
        "*Supplier discounts we spotted*:",
        "• Daniel Street Fish Market takes 16.6% ($6.88 per kg) off Humpty Doo Barramundi fillets.",
        "",
        "*Still to do*:",
        "• Drift: 2 items to match, 2 prices to approve, 4 to check",
        "• Greedy: 1 item to match, 1 price to approve, 1 to check",
        "*Reading*: 1 invoice is still being read.",
        "",
        "<https://precinct-costing.vercel.app/invoices?tab=todo|Open Invoices>",
      ].join("\n"),
    );
  });

  it("priceDiffers: a pair counts when the new price is not the old one by half a cent or more", () => {
    const none = { old_pack_price: null, new_pack_price: null, old_product_price: null, new_product_price: null };
    expect(priceDiffers(none)).toBe(false);
    expect(priceDiffers({ ...none, old_pack_price: 10, new_pack_price: 10.004 })).toBe(false);
    expect(priceDiffers({ ...none, old_pack_price: 10, new_pack_price: 10.01 })).toBe(true);
    expect(priceDiffers({ ...none, old_pack_price: null, new_pack_price: 10 })).toBe(true);
    expect(priceDiffers({ ...none, old_product_price: 3, new_product_price: 4 })).toBe(true);
    expect(priceDiffers({ ...none, old_pack_price: 10, new_pack_price: null })).toBe(false);
  });

  it("reads more than one page of rows", async () => {
    const t = dataset();
    for (let i = 0; i < 1100; i++) t.invoice_price_changes.push({ id: `bulk${i}`, venue_id: 2, kind: "price_confirmed", status: "applied", applied_at: "2026-10-28T04:00:00Z", document_id: D1 });
    const { data } = await weekly(t);
    expect(data.venues.find((v) => v.venueSlug === "chiobu")!.pricesConfirmed).toBe(1100);
  });
});

// ================================================================ the route
const SECRET = "test-secret-value-0123456789abcdef";
let current: ReturnType<typeof fakeSb>;

vi.mock("@/lib/invoice-digest-data", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/invoice-digest-data")>();
  return { ...orig, getServiceClient: () => current.sb };
});

import * as digestRoute from "@/app/api/invoices/digest/route";

const req = (method: string, path: string, headers: Record<string, string> = {}, body?: unknown) =>
  new Request(`https://app.example${path}`, { method, headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
const authed = { "x-invoice-secret": SECRET };
const WEBHOOK = "https://hooks.example/services/T000/B000/XXXX";
const okFetch = () => vi.fn(async () => ({ ok: true, status: 200 }) as Response);

beforeEach(() => {
  current = fakeSb(dataset());
  vi.stubEnv("INVOICE_INGEST_SECRET", SECRET);
  vi.stubEnv("INVOICE_SLACK_WEBHOOK_URL", WEBHOOK);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("POST and GET /api/invoices/digest, weekly mode", () => {
  it("needs the secret: 401 for none or a wrong one, 503 when the server has none or a weak one", async () => {
    expect((await digestRoute.POST(req("POST", "/api/invoices/digest", {}, { mode: "weekly" }))).status).toBe(401);
    expect((await digestRoute.POST(req("POST", "/api/invoices/digest", { "x-invoice-secret": "nope" }, { mode: "weekly" }))).status).toBe(401);
    expect((await digestRoute.GET(req("GET", "/api/invoices/digest?mode=weekly"))).status).toBe(401);
    vi.stubEnv("INVOICE_INGEST_SECRET", "weak-secret");
    for (const res of [await digestRoute.POST(req("POST", "/api/invoices/digest", { "x-invoice-secret": "weak-secret" }, { mode: "weekly" })), await digestRoute.GET(req("GET", "/api/invoices/digest?mode=weekly", { "x-invoice-secret": "weak-secret" }))]) {
      expect(res.status).toBe(503);
      expect(JSON.stringify(await res.json())).not.toContain("weak-secret");
    }
    vi.stubEnv("INVOICE_INGEST_SECRET", "");
    expect((await digestRoute.POST(req("POST", "/api/invoices/digest", authed, { mode: "weekly" }))).status).toBe(503);
    expect(current.upserts).toHaveLength(0);
  });

  it("posts the review to Slack once, records ONE row, and answers { sent, text }", async () => {
    const f = okFetch();
    vi.stubGlobal("fetch", f);
    const res = await digestRoute.POST(req("POST", "/api/invoices/digest", authed, { mode: "weekly" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.sent).toBe(true);
    expect(json.text).toMatch(/^:receipt: \*Invoice review: week to Fri 30 Oct\*\n3 invoices read \(Drift 2, Greedy 1\)\./);
    expect(JSON.stringify(json)).not.toContain(WEBHOOK);
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(WEBHOOK);
    expect(JSON.parse(String(init.body))).toEqual({ text: json.text });
    expect(current.upserts).toHaveLength(1);
    expect(current.upserts[0].table).toBe("invoice_digests");
    expect(current.upserts[0].row).toMatchObject({
      kind: "slack",
      document_ids: [],
      question_ids: [],
      body: json.text,
      period_from: "2026-10-22T22:10:00.000Z",
      period_to: "2026-10-29T22:10:00.000Z",
      sent_at: "2026-10-29T22:10:00.000Z",
    });
    expect(current.upserts[0].row).not.toHaveProperty("venue_id");
  });

  it("is idempotent: a second call inside 5 days posts nothing and records nothing", async () => {
    const f = okFetch();
    vi.stubGlobal("fetch", f);
    await digestRoute.POST(req("POST", "/api/invoices/digest", authed, { mode: "weekly" }));
    vi.setSystemTime(new Date(NOW.getTime() + 60 * 1000));
    const again = await digestRoute.POST(req("POST", "/api/invoices/digest", authed, { mode: "weekly" }));
    expect(await again.json()).toEqual({ sent: false, text: null, note: "Already sent this week." });
    vi.setSystemTime(new Date(NOW.getTime() + 4.9 * 24 * 3600 * 1000));
    expect((await (await digestRoute.POST(req("POST", "/api/invoices/digest", authed, { mode: "weekly" }))).json()).note).toBe("Already sent this week.");
    expect(f).toHaveBeenCalledTimes(1);
    expect(current.upserts).toHaveLength(1);
    // the next Friday is a new week
    vi.setSystemTime(new Date(NOW.getTime() + 7 * 24 * 3600 * 1000));
    const next = await (await digestRoute.POST(req("POST", "/api/invoices/digest", authed, { mode: "weekly" }))).json();
    expect(next.sent).toBe(true);
    expect(next.text).toContain("week to Fri 6 Nov");
    expect(f).toHaveBeenCalledTimes(2);
    expect(current.upserts).toHaveLength(2);
  });

  it("other digests do not block it: an old per-run message or a weekly email row", async () => {
    current.tables.invoice_digests.push(
      { id: "x1", kind: "slack", document_ids: [D1], body: "*Drift: 2 invoices processed.* 1 price updated.", sent_at: "2026-10-29T01:00:00Z" },
      { id: "x2", kind: "weekly_email", document_ids: [], body: `Weekly email of 3 open questions ${WEEKLY_REVIEW_MARKER}`, sent_at: "2026-10-29T01:00:00Z" },
      { id: "x3", kind: "slack", document_ids: [], body: ":receipt: *Invoice review: week to Fri 16 Oct*", sent_at: "2026-10-15T22:00:00Z" }, // two weeks ago
    );
    vi.stubGlobal("fetch", okFetch());
    expect((await (await digestRoute.POST(req("POST", "/api/invoices/digest", authed, { mode: "weekly" }))).json()).sent).toBe(true);
  });

  it("with no webhook the text comes back, nothing is posted or recorded, and a later call can still send", async () => {
    vi.stubEnv("INVOICE_SLACK_WEBHOOK_URL", "");
    const f = okFetch();
    vi.stubGlobal("fetch", f);
    const json = await (await digestRoute.POST(req("POST", "/api/invoices/digest", authed, { mode: "weekly" }))).json();
    expect(json.sent).toBe(false);
    expect(json.text).toContain("Invoice review: week to Fri 30 Oct");
    expect(json.note).toBe("No Slack address is set up.");
    expect(f).not.toHaveBeenCalled();
    expect(current.upserts).toHaveLength(0);
    vi.stubEnv("INVOICE_SLACK_WEBHOOK_URL", WEBHOOK);
    expect((await (await digestRoute.POST(req("POST", "/api/invoices/digest", authed, { mode: "weekly" }))).json()).sent).toBe(true);
  });

  it("a post Slack refuses, or a network error, is not recorded, so the next call tries again", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500 }) as Response));
    const bad = await (await digestRoute.POST(req("POST", "/api/invoices/digest", authed, { mode: "weekly" }))).json();
    expect(bad).toMatchObject({ sent: false, note: "Slack did not accept the message." });
    expect(bad.text).toContain("Invoice review");
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("down"); }));
    expect((await (await digestRoute.POST(req("POST", "/api/invoices/digest", authed, { mode: "weekly" }))).json()).sent).toBe(false);
    expect(current.upserts).toHaveLength(0);
    const good = okFetch();
    vi.stubGlobal("fetch", good);
    expect((await (await digestRoute.POST(req("POST", "/api/invoices/digest", authed, { mode: "weekly" }))).json()).sent).toBe(true);
    expect(current.upserts).toHaveLength(1);
  });

  it("GET ?mode=weekly previews the text and posts and records nothing, even after it was sent", async () => {
    const f = okFetch();
    vi.stubGlobal("fetch", f);
    const before = await (await digestRoute.GET(req("GET", "/api/invoices/digest?mode=weekly", authed))).json();
    expect(before.sent).toBe(false);
    expect(before.text).toContain("3 invoices read (Drift 2, Greedy 1).");
    expect(f).not.toHaveBeenCalled();
    expect(current.upserts).toHaveLength(0);
    await digestRoute.POST(req("POST", "/api/invoices/digest", authed, { mode: "weekly" }));
    const after = await (await digestRoute.GET(req("GET", "/api/invoices/digest?mode=weekly", authed))).json();
    expect(after.text).toBe(before.text);
    expect(f).toHaveBeenCalledTimes(1);
    expect(current.upserts).toHaveLength(1);
  });

  it("the old per-run POST still posts nothing, and bad bodies are rejected", async () => {
    const f = okFetch();
    vi.stubGlobal("fetch", f);
    const old = await digestRoute.POST(req("POST", "/api/invoices/digest", authed, { documentIds: [D1, D2] }));
    expect(old.status).toBe(200);
    expect(await old.json()).toMatchObject({ sent: false, text: null, messages: [] });
    expect(f).not.toHaveBeenCalled();
    expect(current.upserts).toHaveLength(0);
    for (const body of [{}, { mode: "daily" }, { mode: "weekly-ish" }, { documentIds: ["x"] }, null]) {
      expect((await digestRoute.POST(req("POST", "/api/invoices/digest", authed, body))).status).toBe(400);
    }
  });

  it("a failed read answers a plain error and posts nothing", async () => {
    current = fakeSb(dataset());
    const real = current.sb as unknown as { from: (t: string) => unknown };
    current.sb = { from: (t: string) => (t === "invoice_questions" ? { select: () => { throw new Error("db down SECRET-DETAIL"); } } : real.from(t)) } as never;
    const f = okFetch();
    vi.stubGlobal("fetch", f);
    const res = await digestRoute.POST(req("POST", "/api/invoices/digest", authed, { mode: "weekly" }));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("SECRET-DETAIL");
    expect(f).not.toHaveBeenCalled();
  });

  it("sendWeeklyReview can be called straight with an explicit webhook and clock", async () => {
    const f = okFetch();
    const r = await sendWeeklyReview(current.sb, { webhookUrl: WEBHOOK, fetchImpl: f, now: NOW, origin: "https://x.example" });
    expect(r.sent).toBe(true);
    expect(r.text).toContain("<https://x.example/invoices?tab=todo|Open Invoices>");
  });
});

describe("what the weekly review leaves out", () => {
  it("no raw .insert( and no technical words in the strings the review builds", () => {
    for (const f of ["lib/invoice-digest.ts", "lib/invoice-digest-data.ts", "app/api/invoices/digest/route.ts"]) {
      const src = readFileSync(f, "utf8");
      expect(src.split("\n").filter((x) => /\.insert\(/.test(x) && !/^\s*(\/\/|\*|\/\*)/.test(x))).toEqual([]);
    }
    const src = readFileSync("lib/invoice-digest.ts", "utf8");
    const weekly = src.slice(src.indexOf("the weekly Slack review (the ONLY Slack message)"));
    const code = weekly
      .split("\n")
      .filter((x) => !/^\s*(\/\/|\*|\/\*)/.test(x))
      .join("\n");
    expect(code).not.toMatch(/reconcil|learning mode|guard|claude|anthropic/i);
  });
});
