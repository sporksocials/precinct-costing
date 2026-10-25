import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  acceptableCount,
  acceptSuggestions,
  buildBatch,
  decisionAnswer,
  ignoreList,
  isMatchKind,
  newIngredientFields,
  readableCase,
  reviewLineText,
  rowStatus,
  rowSuggestion,
  saveLabel,
  splitReview,
  type Decision,
  type QLine,
  type QuestionBundle,
} from "../lib/invoice-questions-view";
import { ambiguousQuestion, unmatchedQuestion } from "../lib/invoice-questions";
import { BIDFOOD_LINES } from "./fixtures/invoice-ingredients";

function bundle(n: number, over: { kind?: any; lineId?: string | null; options?: any[]; line?: Partial<QLine>; created?: string } = {}): QuestionBundle {
  const l = BIDFOOD_LINES[n - 1] ?? BIDFOOD_LINES[0];
  const lineId = over.lineId === undefined ? `L${n}` : over.lineId;
  return {
    q: { id: `Q${n}`, venue_id: 1, document_id: "d1", line_id: lineId, kind: over.kind ?? "unmatched_line", prompt: "x", options: over.options ?? [], status: "open", answer: null, answered_by: null, answered_at: null, emailed_at: null, created_at: over.created ?? `2026-10-25T00:00:0${n}Z` },
    doc: { id: "d1", venue_id: 1, supplier_id: "s1", supplier_name_read: "Bidfood", invoice_number: "I71910723.SUN", invoice_date: "2026-10-25", page_pdf_path: null, status: "needs_review" },
    line: lineId ? { id: lineId, line_no: n, page: 1, item_code: l.code, description: l.description, qty: l.qty, unit: l.unit, unit_price_ex: l.price, line_total_ex: l.qty * l.price, ingredient_id: null, product_id: null, ...over.line } : null,
    supplierName: "Bidfood",
    costSupplierId: 7,
  };
}

describe("the question wording", () => {
  it("is short: the supplier and the line, nothing repeated twelve times", () => {
    const q = unmatchedQuestion({ supplier: "Bidfood", lineNo: 4, description: "POTATO WEDGES SEASONED (MCCAIN) 2kg", code: "8229", suggestions: [] });
    expect(q.prompt).toBe("Bidfood sent POTATO WEDGES SEASONED (MCCAIN) 2kg.");
    expect(q.prompt).not.toMatch(/Which product/);
    expect(q.options.map((o) => o.action)).toEqual(["not_a_product", "ignore_line"]);
  });
  it("keeps candidate options for old callers, and the ambiguous wording short too", () => {
    const a = ambiguousQuestion({ supplier: "Bidfood", lineNo: 1, description: "ONIONS", code: null, candidates: [{ ingredient: { id: "i1", name: "Onion" } as any, product: null }] });
    expect(a.prompt).toBe("Bidfood sent ONIONS. It could be more than one product.");
    expect(a.options[0]).toMatchObject({ ingredient_id: "i1", label: "Onion" });
    const u = unmatchedQuestion({ supplier: "Bidfood", lineNo: 1, description: "X", code: null, suggestions: [{ ingredient: { id: "i2", name: "Wedges" } as any, product: null }] });
    expect(u.options[0]).toMatchObject({ ingredient_id: "i2" });
  });
});

describe("splitReview", () => {
  it("puts line questions in the table in invoice order and everything else apart", () => {
    const rows = [
      bundle(3),
      bundle(1),
      bundle(2, { kind: "unit_unclear" }),
      bundle(5, { kind: "new_supplier", lineId: null }),
      bundle(4, { kind: "ambiguous_match" }),
      bundle(6, { kind: "big_change" }),
    ];
    const { match, other } = splitReview(rows);
    expect(match.map((b) => b.q.id)).toEqual(["Q1", "Q3", "Q4"]);
    // invoice-wide questions first, then line questions in order
    expect(other.map((b) => b.q.id)).toEqual(["Q5", "Q2", "Q6"]);
    expect(isMatchKind("unmatched_line") && isMatchKind("ambiguous_match") && !isMatchKind("unit_unclear")).toBe(true);
  });
});

describe("suggestions", () => {
  const local = [{ ingredientId: "i-local", score: 0.8, why: "shares wedge" }, { ingredientId: "i-b", score: 0.5, why: "x" }];
  it("prefers the AI suggestion on the question, then a strong local one, else nothing", () => {
    const ai = [{ id: "suggest:i-ai", label: "Suggested: Wedges", ingredient_id: "i-ai", confidence: 0.9, reason: "Same product." }, { id: "np", label: "x", action: "not_a_product" as const }];
    expect(rowSuggestion(ai, local, 0.65)).toEqual({ ingredientId: "i-ai", source: "ai", score: 0.9, reason: "Same product." });
    expect(rowSuggestion([], local, 0.65)).toMatchObject({ ingredientId: "i-local", source: "local" });
    expect(rowSuggestion([], [{ ingredientId: "i-b", score: 0.5, why: "x" }], 0.65)).toBeNull();
    expect(rowSuggestion([], [], 0.65)).toBeNull();
  });
  it("Accept All Suggestions takes only rows with a suggestion and no choice, and never overwrites a choice", () => {
    const rows = [
      { id: "Q1", suggestion: { ingredientId: "a", source: "local" as const, score: 0.8, reason: null } },
      { id: "Q2", suggestion: null },
      { id: "Q3", suggestion: { ingredientId: "gone", source: "ai" as const, score: 0.9, reason: null } },
      { id: "Q4", suggestion: { ingredientId: "b", source: "ai" as const, score: 0.9, reason: null } },
    ];
    const names: Record<string, string> = { a: "Wedges", b: "Bacon" };
    const mine = new Map<string, Decision>([["Q4", { t: "none" }]]);
    expect(acceptableCount(rows, mine, (id) => names[id])).toBe(1);
    const next = acceptSuggestions(rows, mine, (id) => names[id]);
    expect(next.get("Q1")).toEqual({ t: "ingredient", ingredientId: "a", name: "Wedges", via: "suggestion" });
    expect(next.has("Q2")).toBe(false);
    expect(next.has("Q3")).toBe(false); // that ingredient is gone from the app
    expect(next.get("Q4")).toEqual({ t: "none" }); // untouched
    expect(mine.size).toBe(1); // the old map is not changed
  });
  it("a suggestion alone does not make a row chosen", () => {
    const sug = { ingredientId: "a", source: "local" as const, score: 0.8, reason: null };
    expect(rowStatus(undefined, sug)).toBe("suggested");
    expect(rowStatus(undefined, null)).toBe("needs_choice");
    expect(rowStatus({ t: "ingredient", ingredientId: "a", name: "A", via: "pick" }, sug)).toBe("matched");
    expect(rowStatus({ t: "none" }, sug)).toBe("not_in_app");
  });
});

describe("what Save Matches sends", () => {
  it("an ingredient goes as custom:<id> with the checked note, Not In The App as the standard answer, other questions as their own option", () => {
    const rows = [bundle(1), bundle(2), bundle(3), bundle(4, { kind: "unit_unclear" }), bundle(5)];
    const d = new Map<string, Decision>([
      ["Q1", { t: "ingredient", ingredientId: "ing-9", name: "Wedges", via: "pick" }],
      ["Q2", { t: "none" }],
      ["Q4", { t: "option", optionId: "custom:packs", label: "6 in each", note: '{"packs_per_unit":6}' }],
      ["Q5", { t: "option", optionId: "np", label: "Not a product" }],
    ]);
    expect(buildBatch(rows, d)).toEqual([
      { questionId: "Q1", optionId: "custom:ing-9", note: '{"ingredient_id":"ing-9"}' },
      { questionId: "Q2", optionId: "not_a_product" },
      { questionId: "Q4", optionId: "custom:packs", note: '{"packs_per_unit":6}' },
      { questionId: "Q5", optionId: "np" },
    ]);
    // a row with no choice is left open
    expect(buildBatch(rows, new Map()).length).toBe(0);
    expect(decisionAnswer(rows[0], { t: "none" })).toEqual({ questionId: "Q1", optionId: "not_a_product" });
  });
  it("the button counts what is chosen", () => {
    expect(saveLabel(0)).toBe("Save Matches");
    expect(saveLabel(9)).toBe("Save Matches (9)");
  });
  it("lists what Not In The App All Remaining will ignore", () => {
    const l = ignoreList([bundle(4), bundle(5)]);
    expect(l).toEqual([
      { id: "Q4", title: "Potato Wedges Seasoned (Mccain) 2kg", code: "8229" },
      { id: "Q5", title: "Bacon Middle Rindless Gas Flushed (Caterers C) 2.5kg", code: "217452" },
    ]);
  });
});

describe("the invoice line in words", () => {
  it("turns shouting into readable words and keeps sizes", () => {
    expect(readableCase("JUICE ORANGE NAS 100% PET (GOLDEN CIR) 2lt")).toBe("Juice Orange Nas 100% Pet (Golden Cir) 2lt");
    expect(readableCase("CHIPS 10MM SUPA CRUNCH ULTRAFAST (EDGELL) 6x2kg")).toBe("Chips 10mm Supa Crunch Ultrafast (Edgell) 6x2kg");
    expect(readableCase("Kingfish fillets skin on")).toBe("Kingfish fillets skin on"); // already mixed case
    expect(readableCase("")).toBe("");
  });
  it("shows the code, quantity, unit and unit price ex GST", () => {
    expect(reviewLineText(bundle(4).line)).toEqual({ title: "Potato Wedges Seasoned (Mccain) 2kg", code: "8229", meta: "6 PKT @ $10.14 ex GST" });
    expect(reviewLineText(null).title).toContain("no longer on the invoice");
    expect(reviewLineText(bundle(1, { line: { item_code: null, qty: null, unit: null, unit_price_ex: null } }).line).meta).toBe("");
  });
});

describe("Add As New Ingredient starts from the line", () => {
  const f = (n: number, over: Partial<QLine> = {}) => newIngredientFields({ line: bundle(n, { line: over }).line!, costSupplierId: 7, sourceLabel: "Invoice I71910723.SUN · Bidfood · 25 Oct 2026" });
  it("reads the pack from the description and takes the unit price ex GST", () => {
    expect(f(4)).toMatchObject({ name: "Potato Wedges Seasoned", supplier_id: 7, supplier_code: "8229", pack_size: 2, pack_unit: "kg", pack_price: 10.14, price_inc_gst: false, gst_free: false, notes: null });
    expect(f(3)).toMatchObject({ name: "Chips Supa Crunch", pack_size: 12, pack_unit: "kg", pack_price: 51.7 }); // 6x2kg carton
    expect(f(8)).toMatchObject({ pack_size: 2, pack_unit: "L", pack_price: 6.09 });
    expect(f(1)).toMatchObject({ pack_size: 3.4, pack_unit: "kg", pack_price: 41.64 }); // 40 x 85g
  });
  it("a line sold by the kilo is one kilo at the unit price", () => {
    expect(f(5, { unit: "KG", description: "BACON MIDDLE" })).toMatchObject({ pack_size: 1, pack_unit: "kg", pack_price: 29.5 });
  });
  it("leaves the price blank when the pack size is not on the invoice, and says so", () => {
    const r = f(5, { description: "SPECIAL SAUCE", unit: "EA" });
    expect(r).toMatchObject({ pack_size: 1, pack_unit: "each", pack_price: 0 });
    expect(r.notes).toContain("Please check");
  });
  it("carries a GST free line and the invoice as the source of the price", () => {
    expect(f(2, { gst: "free" })).toMatchObject({ gst_free: true, source: "Invoice I71910723.SUN · Bidfood · 25 Oct 2026" });
  });
  it("creates nothing by itself: the helper is a pure function", () => {
    const src = readFileSync("lib/invoice-suggest.ts", "utf8") + readFileSync("lib/invoice-questions-view.ts", "utf8");
    expect(src).not.toMatch(/\.from\(|insertRow|insertIngredient/);
  });
});

describe("source rules for the new screens", () => {
  const files = ["components/invoices/match-screen.tsx", "components/invoices/match-row.tsx", "components/invoices/q-other-row.tsx", "components/invoices/q-picker.tsx", "components/invoices/q-new-ingredient.tsx", "lib/invoice-suggest.ts", "lib/invoice-suggest-ai.ts", "lib/invoice-answer.ts", "lib/invoice-questions.ts"];
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  it("has no em or en dashes in anything a person reads", () => {
    for (const f of files) expect(strip(readFileSync(f, "utf8")), f).not.toMatch(/[–—]/);
  });
  it("shows Title Case on every button a person presses", () => {
    const src = readFileSync("components/invoices/match-screen.tsx", "utf8") + readFileSync("components/invoices/match-row.tsx", "utf8") + readFileSync("components/invoices/todo-match.tsx", "utf8");
    for (const label of ["Accept All Suggestions", "Not In The App: All Remaining", "Use Suggestion", "Add As New Ingredient", "Match Items"]) expect(src).toContain(label);
  });
  it("every Save Matches write goes through the answer functions, and the screen files never write on their own", () => {
    for (const f of files.filter((x) => x.startsWith("components/"))) expect(strip(readFileSync(f, "utf8")), f).not.toMatch(/\.from\([^)]*\)\s*\.(insert|update|upsert|delete)\(/);
    expect(strip(readFileSync("components/invoices/match-screen.tsx", "utf8"))).toContain("answerItemGroups(");
  });
  it("sticks the bar above the phone tab bar and clear of the sidebar, like the other bottom bars", () => {
    const src = readFileSync("components/invoices/match-screen.tsx", "utf8");
    expect(src).toContain("bottom-[calc(50px+env(safe-area-inset-bottom))]");
    expect(src).toContain("lg:left-[248px]");
  });
});
