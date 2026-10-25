import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  acceptableItems,
  acceptItemSuggestions,
  buildItemAnswers,
  groupItems,
  groupsForSupplier,
  groupSuggestions,
  itemKey,
  itemMeta,
  itemsToMatch,
  matchCounts,
  onInvoices,
  progressText,
  screenOrder,
  seenOn,
  supplierCards,
  UNKNOWN_SUPPLIER_NAME,
  UNKNOWN_SUPPLIER_PARAM,
  type LocalSuggest,
} from "../lib/invoice-todo-match";
import { buildSuggester, PRESET_SCORE } from "../lib/invoice-suggest";
import type { Decision, QuestionBundle } from "../lib/invoice-questions-view";

let n = 0;
interface B {
  supplierId?: string | null;
  supplierName?: string | null;
  docId: string;
  number?: string;
  date?: string;
  venue?: number;
  code?: string | null;
  description?: string;
  unit?: string;
  price?: number | null;
  docStatus?: string;
  kind?: string;
  options?: any[];
  lineId?: string | null;
  created?: string;
}
function bundle(o: B): QuestionBundle {
  n++;
  const supplierId = o.supplierId === undefined ? "sup-bidfood" : o.supplierId;
  return {
    q: {
      id: `q${n}`, venue_id: o.venue ?? 1, document_id: o.docId, line_id: o.lineId === undefined ? `l${n}` : o.lineId, kind: (o.kind ?? "unmatched_line") as any, prompt: "x",
      options: o.options ?? [], status: "open", answer: null, answered_by: null, answered_at: null, emailed_at: null, created_at: o.created ?? `2026-10-25T0${n % 10}:00:00Z`,
    },
    doc: { id: o.docId, venue_id: o.venue ?? 1, supplier_id: supplierId, supplier_name_read: "BIDFOOD", invoice_number: o.number ?? o.docId, invoice_date: o.date ?? "2026-10-20", page_pdf_path: null, status: o.docStatus ?? "needs_review" },
    line: { id: `l${n}`, line_no: 1, page: 1, item_code: o.code === undefined ? "8229" : o.code, description: o.description ?? "POTATO WEDGES SEASONED (MCCAIN) 2kg", qty: 2, unit: o.unit ?? "PKT", unit_price_ex: o.price === undefined ? 10.14 : o.price, line_total_ex: 20, ingredient_id: null, product_id: null },
    supplierName: supplierId === null ? null : o.supplierName === undefined ? "Bidfood Sunshine Coast" : o.supplierName,
  } as QuestionBundle;
}

describe("itemKey", () => {
  it("is the supplier and the normalised code, so spacing and case do not split an item", () => {
    expect(itemKey("s1", { item_code: "ab 12", description: "x" })).toBe(itemKey("s1", { item_code: " AB12 ", description: "y" }));
  });
  it("falls back to the description key when there is no code, and keeps suppliers apart", () => {
    expect(itemKey("s1", { item_code: null, description: "Lychee Liqueur 700 ml" })).toBe(itemKey("s1", { item_code: "", description: "LYCHEE LIQUEUR 700ml" }));
    expect(itemKey("s1", { item_code: "9", description: "a" })).not.toBe(itemKey("s2", { item_code: "9", description: "a" }));
    expect(itemKey(null, { item_code: "9", description: "a" })).toContain(UNKNOWN_SUPPLIER_PARAM);
  });
});

describe("groupItems", () => {
  it("collapses the same supplier item across invoices, weeks and venues into one group", () => {
    const g = groupItems([
      bundle({ docId: "d1", date: "2026-10-10", price: 9.9 }),
      bundle({ docId: "d2", date: "2026-10-17", price: 10.14 }),
      bundle({ docId: "d3", date: "2026-10-20", price: 10.5, venue: 2 }),
      bundle({ docId: "d3", date: "2026-10-20", price: 10.5, venue: 2 }), // the same invoice twice: one invoice, two questions
    ]);
    expect(g).toHaveLength(1);
    expect(g[0].questionIds).toHaveLength(4);
    expect(g[0].invoices.map((i) => i.docId)).toEqual(["d3", "d2", "d1"]);
    expect(g[0].lastPriceEx).toBe(10.5);
    expect(g[0].venueIds.sort()).toEqual([1, 2]);
    expect(g[0]).toMatchObject({ supplierName: "Bidfood Sunshine Coast", code: "8229", description: "Potato Wedges Seasoned (Mccain) 2kg" });
  });

  it("keeps different codes and different suppliers apart", () => {
    const g = groupItems([bundle({ docId: "d1" }), bundle({ docId: "d1", code: "7366", description: "CHEESE RICOTTA 500gr" }), bundle({ docId: "d2", supplierId: "sup-other", supplierName: "Markris" })]);
    expect(g).toHaveLength(3);
  });

  it("groups lines with no code by their description", () => {
    const g = groupItems([bundle({ docId: "d1", code: null, description: "Diablo Ginger Beer 50L Keg" }), bundle({ docId: "d2", code: null, description: "DIABLO GINGER BEER 50l KEG" })]);
    expect(g).toHaveLength(1);
    expect(g[0].code).toBeNull();
  });

  it("leaves out duplicate, failed and ignored invoices, lines that are gone, other kinds and answered questions", () => {
    const answered = bundle({ docId: "d1" });
    answered.q.status = "answered";
    const noLine = bundle({ docId: "d1" });
    noLine.line = null;
    const g = groupItems([
      bundle({ docId: "dup", docStatus: "duplicate" }),
      bundle({ docId: "bad", docStatus: "failed" }),
      bundle({ docId: "no", docStatus: "ignored" }),
      bundle({ docId: "u", kind: "unit_unclear" }),
      bundle({ docId: "p", kind: "price_change" }),
      bundle({ docId: "w", lineId: null }),
      answered,
      noLine,
    ]);
    expect(g).toEqual([]);
  });

  it("includes ambiguous matches and merges the options the engine offered", () => {
    const g = groupItems([
      bundle({ docId: "d1", kind: "ambiguous_match", options: [{ id: "pick:a", label: "Wedges", ingredient_id: "ing-a" }] }),
      bundle({ docId: "d2", options: [{ id: "pick:a", label: "Wedges", ingredient_id: "ing-a" }, { id: "pick:b", label: "Chips", ingredient_id: "ing-b" }] }),
    ]);
    expect(g[0].options.map((o) => o.id).sort()).toEqual(["pick:a", "pick:b"]);
  });

  it("puts lines with no supplier under Unknown Supplier", () => {
    const g = groupItems([bundle({ docId: "d1", supplierId: null })]);
    expect(g[0]).toMatchObject({ supplierId: null, supplierName: UNKNOWN_SUPPLIER_NAME });
    expect(groupsForSupplier(g, UNKNOWN_SUPPLIER_PARAM)).toHaveLength(1);
    expect(groupsForSupplier(g, "sup-bidfood")).toHaveLength(0);
  });

  it("runs the biggest item first (most invoices), then A to Z", () => {
    const g = groupItems([
      bundle({ docId: "d1", code: "A1", description: "AAA" }),
      bundle({ docId: "d1", code: "B1", description: "BBB" }),
      bundle({ docId: "d2", code: "B1", description: "BBB" }),
      bundle({ docId: "d1", code: "C1", description: "CCC" }),
    ]);
    expect(g.map((x) => x.code)).toEqual(["B1", "A1", "C1"]);
  });
});

describe("supplier cards and counts", () => {
  const bundles = [
    // Bidfood: 2 items on 3 invoices
    bundle({ docId: "d1", code: "A1", description: "Aaa" }),
    bundle({ docId: "d2", code: "A1", description: "Aaa" }),
    bundle({ docId: "d3", code: "B1", description: "Bbb", date: "2026-10-22" }),
    // Markris: 1 item on 1 invoice
    bundle({ docId: "d4", code: "Z9", description: "Zzz", supplierId: "sup-m", supplierName: "Markris Wholesale Foods" }),
    // no supplier
    bundle({ docId: "d5", code: "U1", description: "Uuu", supplierId: null }),
  ];
  const groups = groupItems(bundles);

  it("has one card per supplier, the biggest first, with distinct items and invoices", () => {
    const cards = supplierCards(groups);
    expect(cards.map((c) => [c.name, c.items, c.invoices, c.param])).toEqual([
      ["Bidfood Sunshine Coast", 2, 3, "sup-bidfood"],
      ["Markris Wholesale Foods", 1, 1, "sup-m"],
      [UNKNOWN_SUPPLIER_NAME, 1, 1, UNKNOWN_SUPPLIER_PARAM],
    ]);
    expect(cards[0].lastDate).toBe("2026-10-22");
  });

  it("counts distinct items and suppliers", () => {
    expect(matchCounts(groups)).toEqual({ items: 4, suppliers: 3 });
    expect(matchCounts([])).toEqual({ items: 0, suppliers: 0 });
  });

  it("says it in plain words", () => {
    expect(itemsToMatch(38)).toBe("38 items to match");
    expect(itemsToMatch(1)).toBe("1 item to match");
    expect(onInvoices(6)).toBe("on 6 invoices");
    expect(onInvoices(1)).toBe("on 1 invoice");
    expect(progressText(12, 38)).toBe("12 of 38 chosen");
    expect(seenOn({ invoices: [{ docId: "a", number: null, date: "2026-10-10" }, { docId: "b", number: null, date: "2026-10-19" }] }, "2026-10-25")).toBe("2 invoices, last 19 Oct");
    expect(seenOn({ invoices: [{ docId: "a", number: null, date: "2026-10-19" }] }, "2026-10-25")).toBe("1 invoice, 19 Oct");
    expect(seenOn({ invoices: [{ docId: "a", number: null, date: null }] })).toBe("1 invoice");
    expect(itemMeta({ code: "15026", unit: "kg" })).toBe("Code 15026 · KG");
    expect(itemMeta({ code: null, unit: null })).toBe("");
  });
});

describe("suggestions and answers", () => {
  const wedgeIng = { id: "ing-wedge", name: "Wedges", supplier_code: null, pack_size: 2, pack_unit: "kg", pack_price: 10.14, price_inc_gst: false, active: true };
  const baconIng = { id: "ing-bacon", name: "Bacon", supplier_code: null, pack_size: 2.5, pack_unit: "kg", pack_price: 29.5, price_inc_gst: false, active: true };
  const suggester = buildSuggester([wedgeIng, baconIng]);
  const suggest: LocalSuggest = (l, k) => suggester.suggest(l, k);

  const groups = groupItems([
    bundle({ docId: "d1", code: "8229", description: "POTATO WEDGES SEASONED (MCCAIN) 2kg" }),
    bundle({ docId: "d2", code: "8229", description: "POTATO WEDGES SEASONED (MCCAIN) 2kg" }),
    bundle({ docId: "d1", code: "5555", description: "MYSTERY SAUCE", price: 3 }),
    bundle({ docId: "d1", code: "6666", description: "SOMETHING ELSE", price: 3, options: [{ id: "suggest:ing-bacon", label: "Bacon", ingredient_id: "ing-bacon", confidence: 0.8, reason: "Same product" }] }),
  ]);
  const byCode = (c: string) => groups.find((g) => g.code === c)!;

  it("pre-sets a strong local match, takes the AI pick when there is one, and leaves a weak item without one", () => {
    const s = groupSuggestions(groups, suggest, PRESET_SCORE);
    expect(s.get(byCode("8229").key)!.suggestion).toMatchObject({ ingredientId: "ing-wedge", source: "local" });
    expect(s.get(byCode("6666").key)!.suggestion).toMatchObject({ ingredientId: "ing-bacon", source: "ai", reason: "Same product" });
    expect(s.get(byCode("5555").key)!.suggestion).toBeNull();
    expect(s.get(byCode("6666").key)!.candidateIds[0]).toBe("ing-bacon");
  });

  it("opens with the items that have a suggestion first", () => {
    const s = groupSuggestions(groups, suggest, PRESET_SCORE);
    const order = screenOrder(groups, (k) => !!s.get(k)?.suggestion).map((g) => g.code);
    expect(order.slice(0, 2).sort()).toEqual(["6666", "8229"]);
    expect(order[2]).toBe("5555");
    expect(order[0]).toBe("8229"); // more invoices
  });

  it("Accept All Suggestions fills only the items with a suggestion that are not chosen yet", () => {
    const s = groupSuggestions(groups, suggest, PRESET_SCORE);
    const names: Record<string, string> = { "ing-wedge": "Wedges", "ing-bacon": "Bacon" };
    const chosen = new Map<string, Decision>([[byCode("6666").key, { t: "none" }]]);
    expect(acceptableItems(groups, s, chosen, (id) => names[id])).toBe(1);
    const next = acceptItemSuggestions(groups, s, chosen, (id) => names[id]);
    expect(next.get(byCode("8229").key)).toMatchObject({ t: "ingredient", ingredientId: "ing-wedge", via: "suggestion" });
    expect(next.get(byCode("6666").key)).toEqual({ t: "none" });
    expect(next.has(byCode("5555").key)).toBe(false);
    // an ingredient that is gone from the app is never taken
    expect(acceptableItems(groups, s, new Map(), () => undefined)).toBe(0);
  });

  it("builds ONE answer per chosen item that covers every question about it", () => {
    const decisions = new Map<string, Decision>([
      [byCode("8229").key, { t: "ingredient", ingredientId: "ing-wedge", name: "Wedges", via: "pick" }],
      [byCode("5555").key, { t: "none" }],
    ]);
    const built = buildItemAnswers(groups, decisions);
    expect(built).toHaveLength(2);
    const wedge = built.find((b) => b.key === byCode("8229").key)!.answer;
    expect(wedge.questionIds).toEqual(byCode("8229").questionIds);
    expect(wedge.questionIds).toHaveLength(2);
    expect(wedge.optionId).toBe("custom:ing-wedge");
    expect(JSON.parse(wedge.note!)).toEqual({ ingredient_id: "ing-wedge" });
    expect(built.find((b) => b.key === byCode("5555").key)!.answer).toEqual({ questionIds: byCode("5555").questionIds, optionId: "not_a_product" });
  });
});

describe("source rules", () => {
  const files = [
    "lib/invoice-todo-match.ts",
    "components/invoices/todo-match.tsx",
    "components/invoices/match-screen.tsx",
    "components/invoices/match-row.tsx",
    "components/invoices/q-picker.tsx",
    "components/invoices/q-new-ingredient.tsx",
    "app/(app)/invoices/match/[supplier]/page.tsx",
    "app/(app)/invoices/match/doc/[id]/page.tsx",
    "app/(app)/invoices/questions/page.tsx",
  ];
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const read = (f: string) => readFileSync(f, "utf8");

  it("has no em or en dashes in anything a person reads", () => {
    for (const f of files) expect(strip(read(f)), f).not.toMatch(/[–—]/);
  });

  it("shrinks no tap target below 44px at a breakpoint", () => {
    for (const f of files) {
      for (const m of read(f).matchAll(/\b(?:sm|md|lg|xl):(?:min-)?h-(?:\[(\d+)px\]|(\d+(?:\.\d+)?))(?![\d\w%/])/g)) {
        const px = m[1] != null ? Number(m[1]) : Number(m[2]) * 4;
        expect(px, `${f}: ${m[0]}`).toBeGreaterThanOrEqual(44);
      }
    }
  });

  it("never writes by itself: the only write is the answer, and it goes through answerItemGroups", () => {
    for (const f of files.filter((x) => x.startsWith("components/") || x.startsWith("app/"))) expect(strip(read(f)), f).not.toMatch(/\.from\([^)]*\)\s*\.(insert|update|upsert|delete)\(/);
    expect(strip(read("components/invoices/match-screen.tsx"))).toContain("answerItemGroups(");
  });

  it("keeps the button words and none of the old jargon on screen", () => {
    const screen = strip(read("components/invoices/match-screen.tsx") + read("components/invoices/match-row.tsx") + read("components/invoices/todo-match.tsx"));
    for (const label of ["Accept All Suggestions", "Not In The App: All Remaining", "Save Matches", "Use Suggestion", "Add As New Ingredient", "Match Items"]) expect(screen).toContain(label);
    // what a person reads: text between tags and plain-language strings (not class names)
    const jsx = [...screen.matchAll(/>\s*([A-Za-z][^<>{}\n]*[A-Za-z.])\s*(?=<|\n)/g)].map((m) => m[1]);
    const strings = [...screen.matchAll(/"([^"\n]{4,})"/g)].map((m) => m[1]).filter((t) => t.includes(" ") && !/\b(?:px|rounded|text|flex|grid|bg|min|max|gap|items|justify)-/.test(t) && !/^[a-z-]+( [a-z-]+)*$/.test(t));
    const text = [...jsx, ...strings].join("\n");
    expect(text.length).toBeGreaterThan(100);
    for (const bad of [/\bquestions?\b/i, /\blearning\b/i, /\bdecision\b/i, /\bambiguous\b/i, /\breconcile/i]) expect(text, String(bad)).not.toMatch(bad);
  });

  it("sticks the bar above the phone tab bar and clear of the sidebar, like the other bottom bars", () => {
    const src = read("components/invoices/match-screen.tsx");
    expect(src).toContain("bottom-[calc(50px+env(safe-area-inset-bottom))]");
    expect(src).toContain("lg:left-[248px]");
  });

  it("redirects the old address to the To Do, keeping the venue, and an invoice to its own items", () => {
    const src = read("app/(app)/invoices/questions/page.tsx");
    expect(src).toContain("tab: \"todo\"");
    expect(src).toContain("/invoices/match/doc/");
    expect(src).toContain("venue");
  });
});
