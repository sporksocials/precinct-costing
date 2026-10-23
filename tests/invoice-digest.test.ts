import { describe, expect, it } from "vitest";
import {
  WEEKLY_MAX_BYTES,
  WEEKLY_MAX_FILES,
  WEEKLY_MAX_QUESTIONS,
  attachedNames,
  attentionLine,
  buildSlackDigest,
  buildWeeklyEmail,
  dayLabel,
  fmtChange,
  fmtPrice,
  isDueForEmail,
  mondayLabel,
  plainText,
  planWeekly,
  shortSupplier,
  slackEscape,
  tidyItem,
  withoutAttachments,
  type AttentionItem,
  type SlackDigestData,
  type VenueIn,
  type WeeklyDocIn,
  type WeeklyQuestionIn,
} from "@/lib/invoice-digest";
import { assembleSlackData, toAttentionItem, type SlackRaw } from "@/lib/invoice-digest-data";

const ORIGIN = "https://precinct-costing.vercel.app";
const DASHES = /[—–―]/;
const PRODUCT_WORDS = /claude|anthropic|\bAI\b/i;

const KINGFISH: AttentionItem = { supplier: "Daniel Street Fish Market", item: "Kingfish fillets", oldPrice: 68.9, newPrice: 74.2, unit: "KG", pct: (74.2 - 68.9) / 68.9 };
const BARRA: AttentionItem = { supplier: "Daniel Street Fish Market", item: "HUMPTY DOO BARRAMUNDI FILLETS", oldPrice: 41.54, newPrice: 44.1, unit: "KG", pct: (44.1 - 41.54) / 41.54 };
const GINGER: AttentionItem = { supplier: "CD Australia Pty Ltd trading as Diablo Co", item: "Diablo Ginger Beer 50L Keg", oldPrice: 359, newPrice: 389, unit: "EA", pct: 30 / 359 };

function slack(over: Partial<SlackDigestData> = {}): SlackDigestData {
  return {
    venueName: "Drift",
    venueSlug: "drift",
    origin: ORIGIN,
    invoices: 3,
    pricesUpdated: 14,
    needApproval: 2,
    needApprovalAllOver: true,
    autoApplyPct: 0.05,
    questions: 1,
    failed: 0,
    items: [BARRA, KINGFISH],
    ...over,
  };
}

describe("text helpers", () => {
  it("plainText removes dashes, AI product names and line breaks", () => {
    expect(plainText("Price rose — check it")).toBe("Price rose, check it");
    expect(plainText("Range 5–10 units")).toBe("Range 5, 10 units");
    expect(plainText("Claude says  ok\nnow")).toBe("the system says ok now");
    expect(plainText("An Anthropic model, AI generated")).toBe("An the system model, the system generated");
    expect(plainText(null)).toBe("");
  });
  it("slackEscape handles the three special characters, ampersand first", () => {
    expect(slackEscape("Fish & Chips <b> >")).toBe("Fish &amp; Chips &lt;b&gt; &gt;");
    expect(slackEscape("&lt;")).toBe("&amp;lt;");
  });
  it("formats prices and changes the same way every time", () => {
    expect(fmtPrice(68.9)).toBe("$68.90");
    expect(fmtPrice(1234.5)).toBe("$1,234.50");
    expect(fmtPrice(0)).toBe("$0.00");
    expect(fmtChange(0.0769)).toBe("+7.7%");
    expect(fmtChange(-0.032)).toBe("-3.2%");
    expect(fmtChange(0)).toBe("0.0%");
  });
  it("shortSupplier drops company suffixes and uses the trading name", () => {
    expect(shortSupplier("CD Australia Pty Ltd trading as Diablo Co")).toBe("Diablo Co");
    expect(shortSupplier("Daniel Street Fish Market")).toBe("Daniel Street Fish Market");
    expect(shortSupplier("Star Spirits Pty Ltd")).toBe("Star Spirits");
    expect(shortSupplier(null)).toBe("Unknown supplier");
  });
  it("tidyItem brings ALL CAPS down and cuts long text at a word", () => {
    expect(tidyItem("HUMPTY DOO BARRAMUNDI FILLETS")).toBe("Humpty doo barramundi fillets");
    expect(tidyItem("Kingfish fillets")).toBe("Kingfish fillets");
    const long = tidyItem("Great Northern Super Crisp Lager 49.5 L Keg Stainless Returnable Deposit Applies");
    expect(long.length).toBeLessThanOrEqual(48);
    expect(long.endsWith(" ")).toBe(false);
  });
  it("Brisbane dates: the Monday on or before, and readable days", () => {
    expect(mondayLabel(new Date("2026-10-25T21:00:00Z"))).toBe("26 Oct"); // Mon 26 Oct 07:00 Brisbane
    expect(mondayLabel(new Date("2026-10-26T03:00:00Z"))).toBe("26 Oct");
    expect(mondayLabel(new Date("2026-10-24T02:00:00Z"))).toBe("19 Oct"); // a Saturday
    expect(mondayLabel(new Date("2026-10-25T13:00:00Z"))).toBe("19 Oct"); // Sunday 11pm Brisbane is still the 19 Oct week
    expect(dayLabel("2026-10-14")).toBe("14 Oct 2026");
    expect(dayLabel(null)).toBe("undated");
  });
});

describe("Slack digest", () => {
  it("golden message for a busy Drift run", () => {
    expect(buildSlackDigest(slack())).toBe(
      [
        ":warning: *Drift: 3 invoices processed.* 14 prices updated, 2 need approval (over 5%), 1 question.",
        "",
        "• Kingfish fillets, Daniel Street Fish Market: $68.90 to $74.20/kg (+7.7%)",
        "• Humpty doo barramundi fillets, Daniel Street Fish Market: $41.54 to $44.10/kg (+6.2%)",
        "",
        "<https://precinct-costing.vercel.app/invoices?venue=drift|Review them in the CFP App>",
        "<https://precinct-costing.vercel.app/invoices/questions?venue=drift|Answer the questions>",
        "",
      ]
        .join("\n")
        .trimEnd(),
    );
  });

  it("sorts by the biggest move, caps the bullets at six and says how many more", () => {
    const items = Array.from({ length: 9 }, (_, i): AttentionItem => ({ supplier: "Star", item: `Item ${i + 1}`, oldPrice: 10, newPrice: 10 + (i + 1) / 10, unit: "ea", pct: (i + 1) / 100 }));
    const text = buildSlackDigest(slack({ items, needApproval: 9, questions: 0 }))!;
    const bullets = text.split("\n").filter((l) => l.startsWith("•"));
    expect(bullets).toHaveLength(6);
    expect(bullets[0]).toContain("Item 9");
    expect(bullets[5]).toContain("Item 4");
    expect(text).toContain("and 3 more in the app");
    expect(text).not.toContain("Answer the questions");
  });

  it("is singular for one of everything and leaves out zero parts", () => {
    const text = buildSlackDigest(slack({ invoices: 1, pricesUpdated: 1, needApproval: 1, questions: 1, items: [] }))!;
    expect(text.split("\n")[0]).toBe(":warning: *Drift: 1 invoice processed.* 1 price updated, 1 needs approval (over 5%), 1 question.");
    const quietish = buildSlackDigest(slack({ pricesUpdated: 0, needApproval: 2, questions: 0, items: [] }))!;
    expect(quietish.split("\n")[0]).toBe(":warning: *Drift: 3 invoices processed.* 2 need approval (over 5%).");
  });

  it("only says 'over 5%' when that is true for every line (learning mode waits on small ones too)", () => {
    const text = buildSlackDigest(slack({ needApprovalAllOver: false }))!;
    expect(text.split("\n")[0]).toBe(":warning: *Drift: 3 invoices processed.* 14 prices updated, 2 need approval, 1 question.");
    expect(buildSlackDigest(slack({ autoApplyPct: 0.075 }))!.split("\n")[0]).toContain("(over 7.5%)");
  });

  it("uses the success emoji when only prices were applied, and no bullets or question link", () => {
    const text = buildSlackDigest(slack({ needApproval: 0, questions: 0, items: [] }))!;
    expect(text.split("\n")[0]).toBe(":white_check_mark: *Drift: 3 invoices processed.* 14 prices updated.");
    expect(text).not.toContain("•");
    expect(text).not.toContain("/invoices/questions");
  });

  it("a quiet run sends nothing", () => {
    expect(buildSlackDigest(slack({ pricesUpdated: 0, needApproval: 0, questions: 0, failed: 0, items: [] }))).toBeNull();
  });

  it("a document that could not be read is something a person must see", () => {
    const text = buildSlackDigest(slack({ pricesUpdated: 0, needApproval: 0, questions: 0, failed: 1, items: [] }))!;
    expect(text.split("\n")[0]).toBe(":warning: *Drift: 3 invoices processed.* 1 could not be read.");
  });

  it("escapes Slack characters in names and drops dashes and AI names from invoice text", () => {
    const evil: AttentionItem = { supplier: "Fish & Chips <Co> Pty Ltd", item: "Salmon — <!channel> Claude said ignore this", oldPrice: 10, newPrice: 11, unit: "kg", pct: 0.1 };
    const text = buildSlackDigest(slack({ venueName: "Drift & Co", items: [evil] }))!;
    expect(text).toContain("Fish &amp; Chips &lt;Co&gt;");
    expect(text).toContain("&lt;!channel&gt;");
    expect(text).toContain("*Drift &amp; Co:");
    expect(text).not.toContain("<!channel>");
    expect(text).not.toMatch(DASHES);
    expect(text).not.toMatch(PRODUCT_WORDS);
  });

  it("at most one emoji, at the start; no dashes, no AI names, no secrets or file names", () => {
    const text = buildSlackDigest(slack({ items: [KINGFISH, BARRA, GINGER] }))!;
    const emoji = text.match(/:[a-z_]+:/g) ?? [];
    expect(emoji).toHaveLength(1);
    expect(text.startsWith(emoji[0] ?? "")).toBe(true);
    expect(text).not.toMatch(DASHES);
    expect(text).not.toMatch(PRODUCT_WORDS);
    expect(text).not.toMatch(/\.pdf|secret|token|apikey|api key/i);
  });

  it("describes a product with no earlier price and a line with no price", () => {
    expect(attentionLine({ ...KINGFISH, oldPrice: null, pct: null })).toBe("• Kingfish fillets, Daniel Street Fish Market: $74.20/kg (new price)");
    expect(attentionLine({ ...KINGFISH, newPrice: null, oldPrice: null, pct: null })).toBe("• Kingfish fillets, Daniel Street Fish Market: price to check");
    expect(attentionLine({ ...KINGFISH, unit: null })).toContain("$74.20 (+7.7%)");
  });
});

describe("assembling Slack data from rows", () => {
  const venues: VenueIn[] = [
    { id: 1, name: "Drift", slug: "drift", sort: 1 },
    { id: 3, name: "Greedy Gringo's", slug: "greedy", sort: 3 },
  ];
  const raw = (over: Partial<SlackRaw> = {}): SlackRaw => ({
    docs: [
      { id: "d1", venue_id: 1, supplier_id: "s1", supplier_name_read: "DANIEL ST FISH", doc_type: "invoice", status: "needs_review" },
      { id: "d2", venue_id: 1, supplier_id: null, supplier_name_read: "CD Australia Pty Ltd trading as Diablo Co", doc_type: "invoice", status: "applied" },
      { id: "d3", venue_id: 1, supplier_id: null, supplier_name_read: null, doc_type: "statement", status: "nothing_to_apply" },
      { id: "d4", venue_id: 3, supplier_id: null, supplier_name_read: "Star", doc_type: "invoice", status: "duplicate" },
      { id: "d5", venue_id: 3, supplier_id: null, supplier_name_read: "Star", doc_type: "invoice", status: "failed" },
    ],
    lines: [
      { document_id: "d1", line_no: 1, line_class: "product", description: "Kingfish fillets", unit: "KG", unit_price_ex: 74.2, change_pct: 0.0769, old_pack_price: null, new_pack_price: null, old_product_price: null, new_product_price: null, decision: "needs_approval", state: "open" },
      { document_id: "d1", line_no: 2, line_class: "delivery", description: "Delivery", unit: null, unit_price_ex: 5.91, change_pct: null, old_pack_price: null, new_pack_price: null, old_product_price: null, new_product_price: null, decision: "needs_approval", state: "open" },
      { document_id: "d2", line_no: 1, line_class: "product", description: "Lychee Liqueur 700ml", unit: "EA", unit_price_ex: 38.62, change_pct: 0.03, old_pack_price: null, new_pack_price: null, old_product_price: null, new_product_price: null, decision: "needs_approval", state: "open" },
    ],
    changes: [{ document_id: "d2" }, { document_id: "d2" }, { document_id: "d4" }],
    questions: [
      { document_id: "d1", kind: "big_change", status: "open" },
      { document_id: "d2", kind: "unmatched_line", status: "open" },
      { document_id: "d2", kind: "unit_unclear", status: "answered" },
    ],
    supplierNames: new Map([["s1", "Daniel Street Fish Market"]]),
    venues,
    autoApplyPct: 0.05,
    ...over,
  });

  it("counts per venue, leaves out repeats, statements and delivery lines, and keeps big_change questions out of the question count", () => {
    const out = assembleSlackData(raw(), ORIGIN);
    expect(out.map((d) => d.venueSlug)).toEqual(["drift", "greedy"]);
    const drift = out[0];
    expect(drift.invoices).toBe(2);
    expect(drift.pricesUpdated).toBe(2);
    expect(drift.needApproval).toBe(2);
    expect(drift.questions).toBe(1);
    expect(drift.needApprovalAllOver).toBe(false); // the 3% Diablo line is under the limit
    expect(drift.items.map((i) => i.supplier)).toEqual(["Daniel Street Fish Market", "Diablo Co"]);
    const greedy = out[1];
    expect(greedy.invoices).toBe(0);
    expect(greedy.failed).toBe(1);
    expect(greedy.pricesUpdated).toBe(0); // d4 is a repeat and is left out
  });

  it("a run that only repeats earlier documents gives no data and so no message", () => {
    const only = raw({ docs: [{ id: "d4", venue_id: 3, supplier_id: null, supplier_name_read: "Star", doc_type: "invoice", status: "duplicate" }], lines: [], changes: [], questions: [] });
    expect(assembleSlackData(only, ORIGIN)).toEqual([]);
  });

  it("works the old price back from the change so the pair always agrees", () => {
    const item = toAttentionItem(raw().lines[0], "Daniel Street Fish Market");
    expect(item.newPrice).toBe(74.2);
    expect(item.oldPrice).toBe(68.9);
    const fallback = toAttentionItem({ ...raw().lines[0], unit_price_ex: null, new_pack_price: 120, old_pack_price: 100 }, "X");
    expect([fallback.oldPrice, fallback.newPrice]).toEqual([100, 120]);
  });
});

// ---------------------------------------------------------------- weekly email
const VENUES: VenueIn[] = [
  { id: 1, name: "Drift", slug: "drift", sort: 1 },
  { id: 3, name: "Greedy Gringo's", slug: "greedy", sort: 3 },
];
const NOW = new Date("2026-10-25T21:00:00Z"); // Monday 26 Oct 2026, 7am Brisbane

function doc(id: string, venue: number, supplier: string, no: string | null, date: string, extra: Partial<WeeklyDocIn> = {}): WeeklyDocIn {
  return { id, venue_id: venue, supplier, invoice_number: no, invoice_date: date, page_pdf_path: `drift/2026/${id}.pdf`, status: "needs_review", pdf_bytes: 300_000, ...extra };
}
function q(id: string, docId: string, venue: number, prompt: string, extra: Partial<WeeklyQuestionIn> = {}): WeeklyQuestionIn {
  return { id, venue_id: venue, document_id: docId, prompt, emailed_at: null, created_at: `2026-10-2${id.length % 5}T01:00:00Z`, ...extra };
}

const DOCS = [
  doc("doc-a", 1, "Daniel Street Fish Market", "51329", "2026-10-14"),
  doc("doc-b", 1, "CD Australia Pty Ltd trading as Diablo Co", "ENV-34730", "2026-10-22"),
  doc("doc-c", 3, "Star Spirits Pty Ltd", "88120", "2026-10-20"),
];
const QUESTIONS: WeeklyQuestionIn[] = [
  q("q1", "doc-a", 1, "Is 'Humpty Doo Barramundi fillets' the same as Barramundi fillets (skin on)?", { created_at: "2026-10-20T01:00:00Z" }),
  q("q2", "doc-a", 1, "The credit of $16.45 sits under the barramundi. Is it for that fish?", { created_at: "2026-10-20T02:00:00Z" }),
  q("q3", "doc-b", 1, "Lychee Liqueur 700ml has no item code. Is it our Lychee Liqueur?", { created_at: "2026-10-23T01:00:00Z" }),
  q("q4", "doc-c", 3, "Does the invoice total of $480.00 match what was delivered?", { created_at: "2026-10-21T01:00:00Z" }),
];

describe("weekly email plan", () => {
  it("groups by venue then invoice, in venue order, oldest invoice first", () => {
    const plan = planWeekly({ questions: QUESTIONS, docs: DOCS, venues: VENUES, now: NOW });
    expect(plan.groups.map((g) => g.name)).toEqual(["Drift", "Greedy Gringo's"]);
    expect(plan.groups[0].invoices.map((i) => i.invoiceNumber)).toEqual(["51329", "ENV-34730"]);
    expect(plan.groups[0].invoices[0].questions.map((x) => x.id)).toEqual(["q1", "q2"]);
    expect(plan.invoiceCount).toBe(3);
    expect(plan.questionIds).toEqual(["q1", "q2", "q4", "q3"].sort((a, b) => QUESTIONS.find((x) => x.id === a)!.created_at.localeCompare(QUESTIONS.find((x) => x.id === b)!.created_at)));
    expect(plan.moreQuestions).toBe(0);
  });

  it("skips questions on ignored or duplicate documents and documents it cannot find", () => {
    const docs = [doc("doc-a", 1, "Daniel Street", "1", "2026-10-14", { status: "ignored" }), doc("doc-b", 1, "Diablo", "2", "2026-10-15", { status: "duplicate" })];
    const plan = planWeekly({ questions: QUESTIONS, docs, venues: VENUES, now: NOW });
    expect(plan.questionIds).toEqual([]);
  });

  it("repeats a question only when it has stayed open for a week, and marks it Still waiting", () => {
    const emailed = (days: number) => new Date(NOW.getTime() - days * 86400_000).toISOString();
    expect(isDueForEmail({ emailed_at: null }, NOW)).toBe(true);
    expect(isDueForEmail({ emailed_at: emailed(6.9) }, NOW)).toBe(false);
    expect(isDueForEmail({ emailed_at: emailed(7) }, NOW)).toBe(true);
    const qs = [q("q1", "doc-a", 1, "A?", { emailed_at: emailed(2) }), q("q2", "doc-a", 1, "B?", { emailed_at: emailed(9) }), q("q3", "doc-a", 1, "C?")];
    const plan = planWeekly({ questions: qs, docs: DOCS, venues: VENUES, now: NOW });
    expect(plan.questionIds.sort()).toEqual(["q2", "q3"]);
    const flags = Object.fromEntries(plan.groups[0].invoices[0].questions.map((x) => [x.id, x.stillWaiting]));
    expect(flags).toEqual({ q2: true, q3: false });
  });

  it("caps attachments at 15 files and tells the rest apart", () => {
    const docs: WeeklyDocIn[] = [];
    const qs: WeeklyQuestionIn[] = [];
    for (let i = 0; i < 20; i++) {
      docs.push(doc(`doc-${i}`, 1, `Supplier ${i}`, String(1000 + i), `2026-10-${String(1 + i).padStart(2, "0")}`, { pdf_bytes: 100_000 }));
      qs.push(q(`q-${i}`, `doc-${i}`, 1, "Question?", { created_at: `2026-10-20T${String(i).padStart(2, "0")}:00:00Z` }));
    }
    const plan = planWeekly({ questions: qs, docs, venues: VENUES, now: NOW });
    expect(plan.invoiceCount).toBe(20);
    expect(attachedNames(plan)).toHaveLength(WEEKLY_MAX_FILES);
    const inv = plan.groups[0].invoices;
    expect(inv.slice(0, 15).every((i) => i.attachmentName)).toBe(true);
    expect(inv.slice(15).every((i) => i.attachmentName === null)).toBe(true);
  });

  it("caps attachments at 20 MB, skipping one that would tip it over but still taking smaller ones", () => {
    const docs = [
      doc("big1", 1, "A", "1", "2026-10-01", { pdf_bytes: 9 * 1024 * 1024 }),
      doc("big2", 1, "B", "2", "2026-10-02", { pdf_bytes: 9 * 1024 * 1024 }),
      doc("big3", 1, "C", "3", "2026-10-03", { pdf_bytes: 9 * 1024 * 1024 }),
      doc("small", 1, "D", "4", "2026-10-04", { pdf_bytes: 1024 * 1024 }),
    ];
    const qs = docs.map((d, i) => q(`q${i}`, d.id, 1, "Question?", { created_at: `2026-10-20T0${i}:00:00Z` }));
    const plan = planWeekly({ questions: qs, docs, venues: VENUES, now: NOW });
    const names = Object.fromEntries(plan.groups[0].invoices.map((i) => [i.documentId, i.attachmentName]));
    expect(names.big1).toBeTruthy();
    expect(names.big2).toBeTruthy();
    expect(names.big3).toBeNull();
    expect(names.small).toBeTruthy();
    expect(WEEKLY_MAX_BYTES).toBe(20 * 1024 * 1024);
  });

  it("an unknown PDF size counts as 2 MB, and an invoice with no PDF is never attached", () => {
    const docs = [doc("nopdf", 1, "A", "1", "2026-10-01", { page_pdf_path: null })];
    const plan = planWeekly({ questions: [q("q1", "nopdf", 1, "Q?")], docs, venues: VENUES, now: NOW });
    expect(plan.groups[0].invoices[0].attachmentName).toBeNull();
  });

  it("lists at most 60 questions and counts the rest", () => {
    const docs = [doc("doc-a", 1, "A", "1", "2026-10-01")];
    const qs = Array.from({ length: 70 }, (_, i) => q(`q-${i}`, "doc-a", 1, `Question ${i}?`, { created_at: `2026-10-20T00:${String(i).padStart(2, "0")}:00Z` }));
    const plan = planWeekly({ questions: qs, docs, venues: VENUES, now: NOW });
    expect(plan.questionIds).toHaveLength(WEEKLY_MAX_QUESTIONS);
    expect(plan.moreQuestions).toBe(10);
    expect(buildWeeklyEmail(plan, { origin: ORIGIN, now: NOW }).text).toContain("10 more questions are waiting in the app too.");
  });

  it("names every attachment uniquely, even for the same supplier and number", () => {
    const docs = [doc("x1", 1, "Star", "5", "2026-10-01"), doc("x2", 1, "Star", "5", "2026-10-01")];
    const plan = planWeekly({ questions: [q("q1", "x1", 1, "A?"), q("q2", "x2", 1, "B?", { created_at: "2026-10-20T05:00:00Z" })], docs, venues: VENUES, now: NOW });
    const names = attachedNames(plan);
    expect(new Set(names.map((n) => n.toLowerCase())).size).toBe(2);
    expect(names.every((n) => n.endsWith(".pdf") && !/[\\/:*?"<>|]/.test(n))).toBe(true);
  });
});

describe("weekly email text", () => {
  const plan = () => planWeekly({ questions: QUESTIONS, docs: DOCS, venues: VENUES, now: NOW });

  it("is skipped when there is nothing to ask", () => {
    const empty = planWeekly({ questions: [], docs: [], venues: VENUES, now: NOW });
    const e = buildWeeklyEmail(empty, { origin: ORIGIN, now: NOW });
    expect(e).toEqual({ skipped: true, subject: "", text: "", html: "", questionIds: [] });
  });

  it("subject names the Brisbane Monday", () => {
    expect(buildWeeklyEmail(plan(), { origin: ORIGIN, now: NOW }).subject).toBe("Invoice questions for the week of 26 Oct");
  });

  it("can be forwarded as is: internal header, divider, then greeting to Mon and Matt and the sign-off", () => {
    const e = buildWeeklyEmail(plan(), { origin: ORIGIN, now: NOW });
    const lines = e.text.split("\n");
    expect(lines[0]).toBe("Forward everything below the line to Mon and Matt. 4 questions, 3 invoices, PDFs attached.");
    expect(lines[1]).toMatch(/^-{20,}$/);
    const below = lines.slice(2).join("\n");
    expect(below).toContain("Hi Mon and Matt,");
    expect(below).toContain("These are the invoice questions waiting on you this week. Each one takes a few seconds in the CFP App.");
    expect(below).toContain("Troy and Abbey");
    expect(below).toContain("https://precinct-costing.vercel.app/invoices/questions");
    // nothing below the line talks to Troy and Abbey
    expect(below).not.toMatch(/forward/i);
  });

  it("groups under the venue, then names each invoice with its supplier, number, date and PDF", () => {
    const text = buildWeeklyEmail(plan(), { origin: ORIGIN, now: NOW }).text;
    expect(text.indexOf("DRIFT")).toBeLessThan(text.indexOf("GREEDY GRINGO'S"));
    expect(text).toContain("Daniel Street Fish Market, invoice 51329, 14 Oct 2026\nPDF attached: Drift Daniel Street Fish Market 51329 14 Oct 2026.pdf\n  1. Is 'Humpty Doo Barramundi fillets'");
    expect(text).toContain("Diablo Co, invoice ENV-34730, 22 Oct 2026");
    expect(text).toContain("Star Spirits, invoice 88120, 20 Oct 2026");
    expect(text).toContain("Answer the Drift questions: https://precinct-costing.vercel.app/invoices/questions?venue=drift");
  });

  it("says which invoices have no PDF attached and counts the attachments in the header", () => {
    const p = withoutAttachments(plan(), ["doc-b"]);
    const e = buildWeeklyEmail(p, { origin: ORIGIN, now: NOW });
    expect(e.text.split("\n")[0]).toBe("Forward everything below the line to Mon and Matt. 4 questions, 3 invoices, 2 PDFs attached, and the other 1 is in the app.");
    expect(e.text).toContain("No PDF attached, so open it in the app.");
    const none = buildWeeklyEmail(withoutAttachments(plan(), ["doc-a", "doc-b", "doc-c"]), { origin: ORIGIN, now: NOW });
    expect(none.text.split("\n")[0]).toContain("No PDFs attached");
  });

  it("marks questions that have waited a week", () => {
    const old = new Date(NOW.getTime() - 8 * 86400_000).toISOString();
    const p = planWeekly({ questions: [q("q1", "doc-a", 1, "Is it the same?", { emailed_at: old })], docs: DOCS, venues: VENUES, now: NOW });
    const e = buildWeeklyEmail(p, { origin: ORIGIN, now: NOW });
    expect(e.text).toContain("1. Still waiting: Is it the same?");
    expect(e.html).toContain("<em>Still waiting:</em> Is it the same?");
  });

  it("html carries the same content, escaped", () => {
    const hostile = [q("q1", "doc-a", 1, "Is <b>Bream</b> & chips the same?"), q("q2", "doc-a", 1, "Fine?", { created_at: "2026-10-20T09:00:00Z" })];
    const e = buildWeeklyEmail(planWeekly({ questions: hostile, docs: DOCS, venues: VENUES, now: NOW }), { origin: ORIGIN, now: NOW });
    expect(e.html).toContain("Is &lt;b&gt;Bream&lt;/b&gt; &amp; chips the same?");
    expect(e.html).not.toContain("<b>Bream</b>");
    expect(e.html).toContain("Hi Mon and Matt,");
    expect(e.html).toContain("<hr");
    expect(e.html).toContain('href="https://precinct-costing.vercel.app/invoices/questions"');
  });

  it("no dash characters and no AI product names anywhere, even when a stored prompt has them", () => {
    const nasty = [
      q("q1", "doc-a", 1, "Is this — Claude’s guess – the same as Barramundi? Anthropic AI wrote this."),
      q("q2", "doc-b", 1, "Plain question?", { created_at: "2026-10-21T00:00:00Z" }),
    ];
    const e = buildWeeklyEmail(planWeekly({ questions: nasty, docs: DOCS, venues: VENUES, now: NOW }), { origin: ORIGIN, now: NOW });
    for (const part of [e.subject, e.text, e.html]) {
      expect(part).not.toMatch(DASHES);
      expect(part).not.toMatch(PRODUCT_WORDS);
    }
    expect(e.text).toContain("Is this, the system");
  });

  it("never contains a secret, a signed link or a storage path", () => {
    const e = buildWeeklyEmail(plan(), { origin: ORIGIN, now: NOW });
    for (const part of [e.text, e.html]) expect(part).not.toMatch(/token=|x-invoice-secret|drift\/2026\//i);
  });
});
