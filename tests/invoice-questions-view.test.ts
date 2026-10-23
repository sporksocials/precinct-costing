import { readFileSync } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  answeredLabel,
  brisbaneStamp,
  canSearchIngredients,
  countLabel,
  customIngredientId,
  describeOption,
  findIngredients,
  groupQuestions,
  groupTitle,
  ingredientAnswer,
  ingredientSearchDocs,
  isMatchOption,
  lineText,
  needsPackHelper,
  packsAnswer,
  PACKS_OPTION_ID,
  parseAnswerNote,
  parsePacks,
  savedText,
  shortDate,
  type IngredientLite,
  type OptionLookups,
  type ProductLite,
  type QDoc,
  type QLine,
  type QuestionBundle,
  unitWord,
} from "@/lib/invoice-questions-view";
import type { InvoiceQuestionRow, QuestionOption } from "@/lib/invoice-types";

/* Daniel Street Fish Market #51329, 14 Oct 2026 (hand-written fixture, no client files) */
const doc = (over: Partial<QDoc> = {}): QDoc => ({ id: "d1", venue_id: 1, supplier_id: "s1", supplier_name_read: "DANIEL STREET FISH MKT", invoice_number: "51329", invoice_date: "2026-10-14", page_pdf_path: "1/d1.pdf", status: "needs_review", ...over });
const kingfish: QLine = { id: "l1", line_no: 1, page: 1, item_code: "15026", description: "Kingfish fillets skin on wing off per kg", qty: 1.85, unit: "KG", unit_price_ex: 68.9, line_total_ex: 127.47, ingredient_id: null, product_id: null };
const barra: QLine = { id: "l2", line_no: 2, page: 1, item_code: "15056", description: "Humpty Doo Barramundi fillets per kg", qty: 2.39, unit: "KG", unit_price_ex: 41.54, line_total_ex: 98.98, ingredient_id: null, product_id: null };

const opts: QuestionOption[] = [
  { id: "m1", label: "Kingfish Fillets", ingredient_id: "ing-king" },
  { id: "m2", label: "Order Kingfish Whole", product_id: "prod-king" },
  { id: "skip", label: "Ignore This Line", action: "ignore_line" },
];
const question = (over: Partial<InvoiceQuestionRow> = {}): InvoiceQuestionRow => ({
  id: "q1", venue_id: 1, document_id: "d1", line_id: "l1", kind: "unmatched_line", prompt: "What is Kingfish fillets skin on wing off per kg?", options: opts, status: "open",
  answer: null, answered_by: null, answered_at: null, emailed_at: null, created_at: "2026-10-24T01:00:00Z", ...over,
});
const bundle = (q: Partial<InvoiceQuestionRow>, d: QDoc | null = doc(), l: QLine | null = kingfish): QuestionBundle => ({ q: question(q), doc: d, line: l, supplierName: "Daniel Street Fish Market" });

const king: IngredientLite = { id: "ing-king", name: "Kingfish Fillets", supplier_id: 7, supplier_code: "15026", active: true, pack_size: 1, pack_unit: "kg", pack_price: 68.9, price_inc_gst: false, gst_free: true };
const prod: ProductLite = { id: "prod-king", name: "Kingfish Whole", unit_name: "kg", price_inc_gst: 62 };
const look: OptionLookups = { ingredients: new Map([[king.id, king]]), products: new Map([[prod.id, prod]]) };

describe("dates and words", () => {
  it("shows day and month, adding the year only when it differs from today's", () => {
    expect(shortDate("2026-10-14", "2026-10-24")).toBe("14 Oct");
    expect(shortDate("2025-12-30", "2026-10-24")).toBe("30 Dec 2025");
    expect(shortDate("2026-10-14")).toBe("14 Oct");
    expect(shortDate(null)).toBe("");
    expect(shortDate("junk")).toBe("");
  });
  it("words a Brisbane time stamp across the UTC day boundary", () => {
    expect(brisbaneStamp("2026-10-24T05:15:00Z")).toBe("Sat 24 Oct, 3:15 pm");
    expect(brisbaneStamp("2026-10-23T14:05:00Z")).toBe("Sat 24 Oct, 12:05 am");
    expect(brisbaneStamp("nope")).toBe("");
    expect(brisbaneStamp(null)).toBe("");
  });
  it("titles an invoice the way the brief says", () => {
    expect(groupTitle({ doc: doc(), supplierName: "Daniel Street Fish Market" }, "2026-10-24")).toBe("Daniel Street Fish Market, invoice 51329, 14 Oct");
    expect(groupTitle({ doc: doc({ invoice_number: null, invoice_date: null }), supplierName: null }, "2026-10-24")).toBe("DANIEL STREET FISH MKT");
    expect(groupTitle({ doc: null, supplierName: null })).toBe("Unknown supplier");
  });
  it("words an invoice line with its code, quantity, price and total", () => {
    expect(lineText(kingfish)).toEqual({ title: "Kingfish fillets skin on wing off per kg", meta: "Code 15026 · 1.85 KG @ $68.90 = $127.47 ex GST · Page 1" });
    expect(lineText({ ...kingfish, item_code: null, qty: null, unit: null, unit_price_ex: null, line_total_ex: -16.45, page: null })?.meta).toBe("-$16.45 ex GST");
    expect(lineText(null)).toBeNull();
  });
});

describe("grouping", () => {
  it("groups by invoice, newest group first, invoice-wide questions first inside a group", () => {
    const a = bundle({ id: "qa", line_id: "l2", created_at: "2026-10-24T01:00:00Z" }, doc(), barra);
    const b = bundle({ id: "qb", line_id: "l1", created_at: "2026-10-24T01:01:00Z" });
    const c = bundle({ id: "qc", line_id: null, kind: "totals_mismatch", created_at: "2026-10-24T01:02:00Z" }, doc(), null);
    const other = bundle({ id: "qd", document_id: "d2", created_at: "2026-10-25T00:00:00Z" }, doc({ id: "d2", invoice_number: "9764204", invoice_date: "2026-10-17" }));
    const groups = groupQuestions([a, b, c, other], "2026-10-26");
    expect(groups.map((g) => g.docId)).toEqual(["d2", "d1"]);
    expect(groups[1].title).toBe("Daniel Street Fish Market, invoice 51329, 14 Oct");
    expect(groups[1].bundles.map((x) => x.q.id)).toEqual(["qc", "qb", "qa"]);
  });
  it("is empty for no questions", () => {
    expect(groupQuestions([])).toEqual([]);
  });
});

describe("answer buttons", () => {
  it("a match names the ingredient and shows its current price on the pack's own GST basis", () => {
    const v = describeOption(opts[0], look, "KG");
    expect(v.label).toBe("Kingfish Fillets");
    expect(v.sub).toBe("Now $68.90 per 1 kg pack, GST free");
    expect(v.variant).toBe("tinted");
    expect(describeOption(opts[0], { ...look, ingredients: new Map([[king.id, { ...king, gst_free: false, price_inc_gst: true }]]) }).sub).toBe("Now $68.90 per 1 kg pack, inc GST");
    expect(describeOption(opts[0], { ...look, ingredients: new Map([[king.id, { ...king, gst_free: false }]]) }).sub).toBe("Now $68.90 per 1 kg pack, ex GST");
  });
  it("an ordering product shows its inc GST price; no price says so", () => {
    expect(describeOption(opts[1], look).sub).toBe("Ordering price now $62.00 per kg, inc GST");
    expect(describeOption(opts[1], { ...look, products: new Map([[prod.id, { ...prod, price_inc_gst: null }]]) }).sub).toBe("No ordering price set yet");
  });
  it("mentions a pack size other than one", () => {
    const v = describeOption({ id: "x", label: "Cans", ingredient_id: "ing-king", packs_per_unit: 24 }, look, "CTN");
    expect(v.sub).toContain("each carton holds 24");
  });
  it("actions get plain or primary buttons, never colour alone", () => {
    expect(describeOption(opts[2], look)).toMatchObject({ label: "Ignore This Line", sub: null, variant: "plain" });
    expect(describeOption({ id: "a", label: "Approve This Price", action: "approve_change" }, look).variant).toBe("primary");
    expect(isMatchOption(opts[0])).toBe(true);
    expect(isMatchOption(opts[2])).toBe(false);
  });
  it("turns a printed unit into a word for a sentence", () => {
    expect(unitWord("CTN")).toBe("carton");
    expect(unitWord("EA")).toBe("unit");
    expect(unitWord("KG")).toBe("kg");
    expect(unitWord(null)).toBe("unit");
  });
  it("knows which questions offer a search and a pack helper", () => {
    expect(canSearchIngredients("unmatched_line")).toBe(true);
    expect(canSearchIngredients("ambiguous_match")).toBe(true);
    expect(canSearchIngredients("big_change")).toBe(false);
    expect(needsPackHelper("unit_unclear")).toBe(true);
    expect(needsPackHelper("unmatched_line")).toBe(false);
  });
});

describe("custom answers", () => {
  it("a search pick sends custom:<id> with the ingredient in the note", () => {
    const a = ingredientAnswer("ing-king");
    expect(a.optionId).toBe("custom:ing-king");
    expect(JSON.parse(a.note)).toEqual({ ingredient_id: "ing-king" });
    expect(customIngredientId(a.optionId)).toBe("ing-king");
    expect(JSON.parse(ingredientAnswer("x", 6).note)).toEqual({ ingredient_id: "x", packs_per_unit: 6 });
  });
  it("a pack size sends custom:packs and never reads as an ingredient", () => {
    const a = packsAnswer(12);
    expect(a.optionId).toBe(PACKS_OPTION_ID);
    expect(JSON.parse(a.note)).toEqual({ packs_per_unit: 12 });
    expect(customIngredientId(PACKS_OPTION_ID)).toBeNull();
    expect(customIngredientId("m1")).toBeNull();
  });
  it("reads a note back and ignores anything that is not ours", () => {
    expect(parseAnswerNote('{"ingredient_id":"a","packs_per_unit":6}')).toEqual({ ingredient_id: "a", packs_per_unit: 6 });
    expect(parseAnswerNote("not json")).toBeNull();
    expect(parseAnswerNote('{"ingredient_id":5}')).toBeNull();
    expect(parseAnswerNote(null)).toBeNull();
    expect(parseAnswerNote("[1]")).toBeNull();
  });
  it("parses pack sizes strictly", () => {
    expect(parsePacks("12")).toBe(12);
    expect(parsePacks(" 1,200 ")).toBe(1200);
    expect(parsePacks("0.5")).toBe(0.5);
    for (const bad of ["0", "-3", "abc", "", "1e3", "12 cans", "10001", "1.23456"]) expect(parsePacks(bad), bad).toBeNull();
  });
});

describe("ingredient search", () => {
  const list: IngredientLite[] = [
    king,
    { ...king, id: "ing-barra", name: "Barramundi Fillets Skin On", supplier_code: "15056" },
    { ...king, id: "ing-old", name: "Kingfish Old", active: false },
    { ...king, id: "ing-lime", name: "Limes", supplier_code: "9", supplier_id: 8 },
  ];
  const docs = ingredientSearchDocs(list, (id) => (id === 7 ? "Daniel Street" : "Fruit Co"));
  it("finds by name, tolerates a typo, and by supplier code", () => {
    expect(findIngredients(docs, "kingfish")[0].id).toBe("ing-king");
    expect(findIngredients(docs, "baramundi")[0].id).toBe("ing-barra");
    expect(findIngredients(docs, "15056")[0].id).toBe("ing-barra");
  });
  it("leaves out inactive ingredients and waits for two letters", () => {
    expect(findIngredients(docs, "kingfish").map((i) => i.id)).not.toContain("ing-old");
    expect(findIngredients(docs, "k")).toEqual([]);
    expect(findIngredients(docs, "  ")).toEqual([]);
  });
});

describe("the Saved toast", () => {
  it("names the supplier code and what it is now", () => {
    const b = bundle({});
    expect(savedText(b, opts[0], "Kingfish Fillets")).toBe("Saved. Daniel Street Fish Market code 15026 is now Kingfish Fillets.");
  });
  it("falls back to the description when the line has no code", () => {
    const b = bundle({}, doc(), { ...kingfish, item_code: null, description: "Lychee Liqueur 700ml Bottle" });
    expect(savedText(b, opts[0], "Lychee Liqueur 700ml")).toBe("Saved. Daniel Street Fish Market Lychee Liqueur 700ml Bottle is now Lychee Liqueur 700ml.");
  });
  it("words the non-match answers without promising an undo", () => {
    const b = bundle({});
    expect(savedText(b, { action: "ignore_line", label: "Ignore This Line" })).toBe("Saved. That line will be ignored.");
    expect(savedText(b, { action: "approve_change", label: "x" })).toContain("approved");
    expect(savedText(b, { action: "reject_change", label: "x" })).toContain("stays as it was");
    expect(savedText(b, { label: "Something else" })).toBe("Saved. Something else.");
    expect(savedText(b, { label: "12 in each" }, null, 12)).toBe("Saved. One kg of Kingfish fillets skin on wing off per kg holds 12.");
    for (const a of ["ignore_line", "not_a_product", "approve_change", "reject_change", "confirm_venue", "wrong_venue", "reread", "ignore_document"] as const) {
      expect(savedText(b, { action: a, label: "x" }), a).not.toMatch(/undo|[–—]/i);
    }
  });
});

describe("the answered list", () => {
  const names = (id: string) => (id === "ing-king" ? "Kingfish Fillets" : undefined);
  it("reads an offered answer, a search pick and a pack size", () => {
    expect(answeredLabel({ options: opts, answer: { option_id: "m1" } }, names)).toBe("Kingfish Fillets");
    expect(answeredLabel({ options: opts, answer: { option_id: "custom:ing-king", note: '{"ingredient_id":"ing-king"}' } }, names)).toBe("Matched to Kingfish Fillets");
    expect(answeredLabel({ options: opts, answer: { option_id: "custom:ing-gone" } }, names)).toBe("Answered");
    expect(answeredLabel({ options: opts, answer: { option_id: PACKS_OPTION_ID, note: '{"packs_per_unit":12}' } }, names)).toBe("One unit holds 12");
    expect(answeredLabel({ options: opts, answer: null }, names)).toBe("Answered");
  });
  it("labels the tabs, capping a long answered list", () => {
    expect(countLabel("To Answer", 3)).toBe("To Answer (3)");
    expect(countLabel("Answered", 100, 100)).toBe("Answered (100+)");
    expect(countLabel("Answered", 12, 100)).toBe("Answered (12)");
  });
});

describe("the data layer (in-memory database)", () => {
  let sb: SupabaseClient;
  beforeAll(async () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("fetch", async () => ({ ok: true, json: async () => ({}) }));
    const { createDemoClient } = await import("@/lib/supabase/demo-client");
    sb = createDemoClient();
    await sb.from("invoice_suppliers").insert([{ id: "s1", name: "Daniel Street Fish Market" }]);
    await sb.from("invoice_documents").insert([{ ...doc(), id: "d1" }, { ...doc({ id: "d2", venue_id: 2, invoice_number: "ENV-34730" }), supplier_id: null }]);
    await sb.from("invoice_lines").insert([{ ...kingfish }, { ...barra }]);
    await sb.from("invoice_questions").insert([
      question({ id: "o1" }),
      question({ id: "o2", line_id: "l2", created_at: "2026-10-24T02:00:00Z" }),
      question({ id: "o3", document_id: "d2", venue_id: 2, line_id: null, kind: "totals_mismatch" }),
      question({ id: "a1", status: "answered", answer: { option_id: "skip" }, answered_by: "mon@x.com", answered_at: "2026-10-24T03:00:00Z" }),
    ]);
  });
  it("loads open questions newest first with their invoice, line and supplier name", async () => {
    const { loadQuestionBundles } = await import("@/lib/invoice-data-extra");
    const r = await loadQuestionBundles(sb, { status: "open" });
    expect(r.available).toBe(true);
    expect(r.bundles).toHaveLength(3);
    const first = r.bundles.find((b) => b.q.id === "o1")!;
    expect(first.supplierName).toBe("Daniel Street Fish Market");
    expect(first.line?.item_code).toBe("15026");
    expect(first.doc?.invoice_number).toBe("51329");
    expect(r.bundles[0].q.id).toBe("o2");
  });
  it("narrows by venue and by invoice, and lists answered ones separately", async () => {
    const { loadQuestionBundles } = await import("@/lib/invoice-data-extra");
    expect((await loadQuestionBundles(sb, { status: "open", venueId: 2 })).bundles.map((b) => b.q.id)).toEqual(["o3"]);
    expect((await loadQuestionBundles(sb, { status: "open", docId: "d1" })).bundles.map((b) => b.q.id).sort()).toEqual(["o1", "o2"]);
    expect((await loadQuestionBundles(sb, { status: "answered" })).bundles.map((b) => b.q.id)).toEqual(["a1"]);
  });
  it("an invoice-wide question has no line", async () => {
    const { loadQuestionBundles } = await import("@/lib/invoice-data-extra");
    const r = await loadQuestionBundles(sb, { status: "open", venueId: 2 });
    expect(r.bundles[0].line).toBeNull();
    expect(r.bundles[0].supplierName).toBeNull();
  });
});

describe("source rules for this screen", () => {
  const files = ["components/invoices/q-screen.tsx", "components/invoices/q-card.tsx", "components/invoices/q-search.tsx", "components/invoices/q-packs.tsx", "components/invoices/q-pdf-link.tsx", "app/(app)/invoices/questions/page.tsx"];
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  it("has no em or en dashes in anything a person reads", () => {
    for (const f of [...files, "lib/invoice-questions-view.ts"]) expect(strip(readFileSync(f, "utf8")), f).not.toMatch(/[–—]/);
  });
  it("has no tap target shrunk below 44px at a breakpoint", () => {
    for (const f of files) {
      for (const m of readFileSync(f, "utf8").matchAll(/\b(?:sm|md|lg|xl):(?:min-)?h-(?:\[(\d+)px\]|(\d+(?:\.\d+)?))(?![\d\w%/])/g)) {
        const px = m[1] != null ? Number(m[1]) : Number(m[2]) * 4;
        expect(px, `${f}: ${m[0]}`).toBeGreaterThanOrEqual(44);
      }
    }
  });
  it("never writes or deletes by itself: the only write is the answer", () => {
    for (const f of files) {
      const src = strip(readFileSync(f, "utf8"));
      expect(src, f).not.toMatch(/\.(insert|update|upsert|delete)\(/);
    }
    expect(strip(readFileSync("components/invoices/q-screen.tsx", "utf8"))).toContain("answerQuestion(");
  });
});
