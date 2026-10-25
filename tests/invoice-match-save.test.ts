import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ItemGroupAnswer, ItemGroupsResult } from "../lib/invoice-answer";
import { parseAnswerNote } from "../lib/invoice-questions-view";
import {
  buildDetails,
  buildItemAnswers,
  chosenRenames,
  groupItems,
  needsPackText,
  packsMap,
  rowSettled,
  type DetailContext,
  type ItemGroup,
} from "../lib/invoice-todo-match";
import {
  linkedCount,
  loadOtherSupplierCounts,
  onlyKeys,
  planBatchRenames,
  renameSummary,
  runMatchSave,
  undoRenames,
  type SaveDeps,
} from "../lib/invoice-match-save";
import type { Decision, IngredientLite, QuestionBundle } from "../lib/invoice-questions-view";

let n = 0;
function bundle(o: { code: string; description: string; unit: string; price: number | null; supplier?: string; docId?: string }): QuestionBundle {
  n++;
  return {
    q: {
      id: `q${n}`, venue_id: 1, document_id: o.docId ?? `d${n}`, line_id: `l${n}`, kind: "unmatched_line", prompt: "x", options: [], status: "open", answer: null,
      answered_by: null, answered_at: null, emailed_at: null, created_at: `2026-10-25T0${n % 10}:00:00Z`,
    },
    doc: { id: o.docId ?? `d${n}`, venue_id: 1, supplier_id: o.supplier ?? "sup-bidfood", supplier_name_read: "BIDFOOD", invoice_number: `I${n}`, invoice_date: "2026-10-19", page_pdf_path: null, status: "needs_review" },
    line: { id: `l${n}`, line_no: 1, page: 1, item_code: o.code, description: o.description, qty: 2, unit: o.unit, unit_price_ex: o.price, line_total_ex: 20, ingredient_id: null, product_id: null },
    supplierName: "Bidfood Sunshine Coast",
  } as unknown as QuestionBundle;
}

const ing = (id: string, name: string, o: Partial<IngredientLite> = {}): IngredientLite => ({
  id, name, supplier_id: null, supplier_code: null, active: true, pack_size: 1, pack_unit: "kg", pack_price: 11.8, price_inc_gst: false, gst_free: true, ...o,
});

const BACON_DESC = "BACON MIDDLE RINDLESS GAS FLUSHED (CATERERS C) 2.5kg";
const CHIPS_DESC = "CHIPS 10MM SUPA CRUNCH ULTRAFAST (EDGELL) 6x2kg";

const INGS = [
  ing("bacon", "Bacon"),
  ing("chips", "Chips", { pack_size: 12, pack_price: 58.19, gst_free: false }),
  ing("tomato", "Tomato Sauce", { pack_size: 4, pack_unit: "L", pack_price: 11.59, gst_free: false }),
];
const TAKEN = ing("taken", "Chips 10mm Supa Crunch Ultrafast (Edgell) (6 x 2kg)", { pack_size: 12, gst_free: false });

function setup() {
  const groups = groupItems([
    bundle({ code: "217452", description: BACON_DESC, unit: "PKT", price: 29.5 }),
    bundle({ code: "18627", description: CHIPS_DESC, unit: "CTN", price: 58.19 }),
    bundle({ code: "9999", description: "SOMETHING UNREADABLE", unit: "CTN", price: 10 }),
  ]);
  const by = (code: string) => groups.find((g) => g.code === code)!;
  return { groups, bacon: by("217452"), chips: by("18627"), mystery: by("9999") };
}

const ctx = (o: Partial<DetailContext> = {}): DetailContext => ({
  ingById: new Map(INGS.map((i) => [i.id, i])),
  ingredients: INGS.map(({ id, name }) => ({ id, name })),
  gstRate: 0.1,
  typedPacks: new Map(),
  nameEdits: new Map(),
  otherSuppliers: new Map(),
  ...o,
});

const pick = (id: string, name: string, via: "pick" | "suggestion" | "new" = "pick"): Decision => ({ t: "ingredient", ingredientId: id, name, via });

describe("buildDetails: the conversion and the new name per chosen row", () => {
  it("Bacon: 2.5 packs, per kg matches, the app name becomes the invoice name without a size", () => {
    const { groups, bacon } = setup();
    const d = buildDetails(groups, new Map([[bacon.key, pick("bacon", "Bacon")]]), ctx());
    const det = d.get(bacon.key)!;
    expect(det.conversion.packs).toBe(2.5);
    expect(det.conversion.comparison?.state).toBe("match");
    expect(det.name.newName).toBe("Bacon Middle Rindless Gas Flushed");
    expect(det.name.keep).toBe(false);
    expect(rowSettled(pick("bacon", "Bacon"), det)).toBe(true);
  });
  it("Chips: one pack of 12 kg (6 x 2kg), the size goes in the name", () => {
    const { groups, chips } = setup();
    const det = buildDetails(groups, new Map([[chips.key, pick("chips", "Chips")]]), ctx()).get(chips.key)!;
    expect(det.conversion.packs).toBe(1);
    expect(det.conversion.comparison?.state).toBe("match");
    expect(det.name.newName).toBe("Chips 10mm Supa Crunch Ultrafast (Edgell) (6 x 2kg)");
  });
  it("a name another ingredient already has: plain clash message, defaults to Keep Current Name, no rename", () => {
    const { groups, chips } = setup();
    const det = buildDetails(groups, new Map([[chips.key, pick("chips", "Chips")]]), ctx({ ingredients: [...INGS, TAKEN].map(({ id, name }) => ({ id, name })) })).get(chips.key)!;
    expect(det.name.kind).toBe("clash");
    expect(det.name.keep).toBe(true);
    expect(det.name.newName).toBeNull();
    expect(det.name.note).toBe("Another ingredient is already called Chips 10mm Supa Crunch Ultrafast (Edgell) (6 x 2kg). Pick a different name.");
  });
  it("turning rename on over a clash keeps the problem on the row and the name unchanged", () => {
    const { groups, chips } = setup();
    const edits = new Map([[chips.key, { keep: false }]]);
    const det = buildDetails(groups, new Map([[chips.key, pick("chips", "Chips")]]), ctx({ nameEdits: edits, ingredients: [...INGS, TAKEN].map(({ id, name }) => ({ id, name })) })).get(chips.key)!;
    expect(det.name.problem).toMatch(/already called/);
    expect(det.name.newName).toBeNull();
  });
  it("an unknown conversion leaves the row unsettled and out of the answers", () => {
    const { groups, mystery } = setup();
    const dec = new Map([[mystery.key, pick("chips", "Chips")]]);
    const det = buildDetails(groups, dec, ctx());
    expect(det.get(mystery.key)!.conversion.packs).toBeNull();
    expect(rowSettled(dec.get(mystery.key), det.get(mystery.key))).toBe(false);
    expect(buildItemAnswers(groups, dec, packsMap(det))).toEqual([]);
    expect(needsPackText(1)).toBe("1 item needs a pack size before it can be saved.");
    expect(needsPackText(3)).toBe("3 items need a pack size before they can be saved.");
    expect(needsPackText(0)).toBeNull();
    // typing the kg in one unit settles it (6 kg against the 12 kg pack is half a pack) and it goes out in the note
    const typed = buildDetails(groups, dec, ctx({ typedPacks: new Map([[mystery.key, "6"]]) }));
    expect(rowSettled(dec.get(mystery.key), typed.get(mystery.key))).toBe(true);
    const built = buildItemAnswers(groups, dec, packsMap(typed));
    expect(parseAnswerNote(built[0].answer.note)).toEqual({ ingredient_id: "chips", packs_per_unit: 0.5 });
  });
  it("two rows for one ingredient: only the first renames it", () => {
    const groups = groupItems([
      bundle({ code: "1", description: "BACON STREAKY 1kg", unit: "PKT", price: 11.8 }),
      bundle({ code: "2", description: "BACON SHORTCUT 1kg", unit: "PKT", price: 11.8 }),
    ]);
    const dec = new Map<string, Decision>(groups.map((g) => [g.key, pick("bacon", "Bacon")]));
    const d = buildDetails(groups, dec, ctx());
    const renamed = groups.filter((g) => d.get(g.key)!.name.newName);
    expect(renamed).toHaveLength(1);
    expect(groups.filter((g) => d.get(g.key)!.name.keep)).toHaveLength(1);
  });
  it("another supplier already matched to a name that carries an invoice name: starts on Keep Current Name", () => {
    const { groups, bacon } = setup();
    const named = { ...INGS[0], name: "Bacon Middle Rindless Rashers" };
    const c = ctx({ ingById: new Map([["bacon", named]]), ingredients: [{ id: "bacon", name: named.name }], otherSuppliers: new Map([["bacon", 1]]) });
    const det = buildDetails(groups, new Map([[bacon.key, pick("bacon", named.name)]]), c).get(bacon.key)!;
    expect(det.name.keep).toBe(true);
    expect(det.name.newName).toBeNull();
  });
  it("a just-added ingredient has neither a conversion nor a rename", () => {
    const { groups, bacon } = setup();
    const d = buildDetails(groups, new Map([[bacon.key, pick("bacon", "Bacon", "new")]]), ctx());
    expect(d.size).toBe(0);
    expect(rowSettled(pick("bacon", "Bacon", "new"), undefined)).toBe(true);
  });
  it("a typed name is tidied and checked", () => {
    const { groups, bacon } = setup();
    const det = buildDetails(groups, new Map([[bacon.key, pick("bacon", "Bacon")]]), ctx({ nameEdits: new Map([[bacon.key, { text: "  bacon  middle rindless " }]]) })).get(bacon.key)!;
    expect(det.name.newName).toBe("Bacon Middle Rindless");
  });
});

describe("answers carry the conversion", () => {
  it("the note holds packs_per_unit for a chosen ingredient and the optionId names the ingredient", () => {
    const { groups, bacon, chips } = setup();
    const dec = new Map<string, Decision>([[bacon.key, pick("bacon", "Bacon")], [chips.key, pick("chips", "Chips")]]);
    const built = buildItemAnswers(groups, dec, packsMap(buildDetails(groups, dec, ctx())));
    const b = built.find((x) => x.key === bacon.key)!;
    expect(b.answer.optionId).toBe("custom:bacon");
    expect(parseAnswerNote(b.answer.note)).toEqual({ ingredient_id: "bacon", packs_per_unit: 2.5 });
    expect(parseAnswerNote(built.find((x) => x.key === chips.key)!.answer.note)).toEqual({ ingredient_id: "chips", packs_per_unit: 1 });
  });
  it("without a packs map the answer is what it always was", () => {
    const { groups, bacon } = setup();
    const built = buildItemAnswers(groups, new Map([[bacon.key, pick("bacon", "Bacon")]]));
    expect(JSON.parse(built[0].answer.note!)).toEqual({ ingredient_id: "bacon" });
  });
});

/* ---------------------------------------------------------------- the save flow with a fake store */

function fakeDeps(opts: { failMatch?: (g: ItemGroupAnswer, i: number) => boolean; failRename?: (id: string) => boolean } = {}) {
  const log: string[] = [];
  const names = new Map<string, string>();
  const deps: SaveDeps = {
    async answer(groups) {
      log.push(`answer:${groups.length}`);
      const res: ItemGroupsResult = {
        ok: true,
        message: "Saved matches.",
        groups: groups.map((g, index) => {
          const bad = opts.failMatch?.(g, index) ?? false;
          return { index, status: bad ? "failed" : "saved", saved: bad ? 0 : g.questionIds.length, already: 0, failed: bad ? g.questionIds.length : 0, message: bad ? "Could not remember the match" : "" };
        }),
        results: [],
        applied: [],
      };
      res.ok = res.groups.every((g) => g.status === "saved");
      return res;
    },
    async renameIngredient(id, name) {
      if (opts.failRename?.(id)) throw new Error("offline");
      log.push(`ing:${id}:${name}`);
      names.set(`ing:${id}`, name);
    },
    async renameDish(id, name) {
      log.push(`dish:${id}:${name}`);
      names.set(`dish:${id}`, name);
    },
    async renameProduct(id, patch) {
      log.push(`prod:${id}:${patch.name}:${patch.ingredient_id === undefined ? "-" : patch.ingredient_id}`);
      names.set(`prod:${id}`, patch.name);
    },
  };
  return { deps, log, names };
}

describe("runMatchSave: matches first, renames after, per-item failures", () => {
  const world = {
    ingredients: [{ id: "gin", name: "Bombay Sapphire London Dry Gin (700ml)" }, { id: "bacon", name: "Bacon" }],
    items: [
      { id: "nip", name: "Bombay Sapphire London Dry Gin - 30ml Nip", venue_id: 1 },
      { id: "martini", name: "Bombay Sapphire London Dry Gin Martini", venue_id: 1 },
    ],
    lines: [
      { parent_type: "item", parent_id: "nip", component_type: "ingredient", component_id: "gin" },
      { parent_type: "item", parent_id: "martini", component_type: "ingredient", component_id: "gin" },
    ],
    products: [
      { id: "p1", venue_id: 1, category_id: "c1", name: "Bombay Sapphire London Dry Gin", ingredient_id: "gin" },
      { id: "p2", venue_id: 1, category_id: "c1", name: "Bacon", ingredient_id: null },
    ],
  };
  const renames = [
    { key: "k-gin", ingredientId: "gin", from: "Bombay Sapphire London Dry Gin (700ml)", to: "Bombay Sapphire Gin (700ml)" },
    { key: "k-bacon", ingredientId: "bacon", from: "Bacon", to: "Bacon Middle Rindless Gas Flushed" },
  ];
  const answers = (keys: string[]) => keys.map((key, i) => ({ key, answer: { questionIds: [`q${i}`], optionId: "custom:x" } }));

  it("plans the names that follow, like a single rename: dishes that use it, linked and bare-name products; never the martini", () => {
    const plan = planBatchRenames({ renames, ...world });
    expect(plan.ingredients).toHaveLength(2);
    expect(plan.dishes.map((d) => d.to)).toEqual(["Bombay Sapphire Gin - 30ml Nip"]);
    expect(plan.products.map((p) => [p.id, p.to, p.link])).toEqual([["p1", "Bombay Sapphire Gin", false], ["p2", "Bacon Middle Rindless Gas Flushed", true]]);
    expect(linkedCount(plan)).toBe(3);
  });

  it("saves the matches first, then the ingredient, then the dishes, then the products (linking a bare-name product)", async () => {
    const { deps, log } = fakeDeps();
    const plan = planBatchRenames({ renames, ...world });
    const out = await runMatchSave(deps, { answers: answers(["k-gin", "k-bacon"]), plan });
    expect(log).toEqual([
      "answer:2",
      "ing:gin:Bombay Sapphire Gin (700ml)",
      "ing:bacon:Bacon Middle Rindless Gas Flushed",
      "dish:nip:Bombay Sapphire Gin - 30ml Nip",
      "prod:p1:Bombay Sapphire Gin:-",
      "prod:p2:Bacon Middle Rindless Gas Flushed:bacon",
    ]);
    expect(out.renamedIngredients).toBe(2);
    expect(out.renamedLinked).toBe(3);
    expect(renameSummary(out)).toBe("Renamed 2 items and 3 linked names.");
  });

  it("Only Save The Matches (no plan) changes no name", async () => {
    const { deps, log } = fakeDeps();
    const out = await runMatchSave(deps, { answers: answers(["k-gin"]), plan: null });
    expect(log).toEqual(["answer:1"]);
    expect(out.applied).toEqual({ ingredients: [], dishes: [], products: [] });
    expect(renameSummary(out)).toBeNull();
  });

  it("an item whose match did not save is not renamed, nor are its linked names; the others carry on", async () => {
    const { deps, log } = fakeDeps({ failMatch: (g) => g.questionIds[0] === "q0" });
    const out = await runMatchSave(deps, { answers: answers(["k-gin", "k-bacon"]), plan: planBatchRenames({ renames, ...world }) });
    expect([...out.failedKeys.keys()]).toEqual(["k-gin"]);
    expect(out.failedKeys.get("k-gin")).toBe("Could not remember the match");
    expect([...out.savedKeys]).toEqual(["k-bacon"]);
    expect(log.filter((l) => l.startsWith("ing:"))).toEqual(["ing:bacon:Bacon Middle Rindless Gas Flushed"]);
    expect(log.some((l) => l.startsWith("dish:"))).toBe(false);
  });

  it("a rename failure is reported by name, never undoes the matches, and skips the names that follow it", async () => {
    const { deps, log } = fakeDeps({ failRename: (id) => id === "gin" });
    const out = await runMatchSave(deps, { answers: answers(["k-gin", "k-bacon"]), plan: planBatchRenames({ renames, ...world }) });
    expect(out.result.ok).toBe(true);
    expect(out.savedKeys.size).toBe(2);
    expect(out.renameFailures).toEqual([{ what: "Bombay Sapphire London Dry Gin (700ml)", message: "offline" }]);
    expect(log.some((l) => l.startsWith("dish:nip"))).toBe(false);
    expect(log.some((l) => l.startsWith("prod:p1"))).toBe(false);
    expect(out.renamedIngredients).toBe(1);
  });

  it("Undo Renames puts every name back, and unlinks a product it linked", async () => {
    const { deps, log, names } = fakeDeps();
    const out = await runMatchSave(deps, { answers: answers(["k-gin", "k-bacon"]), plan: planBatchRenames({ renames, ...world }) });
    log.length = 0;
    const undone = await undoRenames(deps, out.applied);
    expect(undone.restored).toBe(5);
    expect(undone.failed).toEqual([]);
    expect(names.get("ing:gin")).toBe("Bombay Sapphire London Dry Gin (700ml)");
    expect(names.get("ing:bacon")).toBe("Bacon");
    expect(names.get("dish:nip")).toBe("Bombay Sapphire London Dry Gin - 30ml Nip");
    expect(names.get("prod:p1")).toBe("Bombay Sapphire London Dry Gin");
    expect(names.get("prod:p2")).toBe("Bacon");
    expect(log).toContain("prod:p2:Bacon:null");
  });

  it("Undo reports what it could not put back", async () => {
    const { deps } = fakeDeps();
    const out = await runMatchSave(deps, { answers: answers(["k-bacon"]), plan: planBatchRenames({ renames, ...world }) });
    const broken: SaveDeps = { ...deps, renameIngredient: async () => { throw new Error("offline"); } };
    const r = await undoRenames(broken, out.applied);
    expect(r.failed.map((f) => f.what)).toEqual(["Bacon"]);
  });

  it("onlyKeys cuts a plan to the saved rows", () => {
    const plan = planBatchRenames({ renames, ...world });
    const cut = onlyKeys(plan, new Set(["k-bacon"]));
    expect(cut.ingredients.map((r) => r.key)).toEqual(["k-bacon"]);
    expect(cut.dishes).toEqual([]);
    expect(cut.products.map((p) => p.id)).toEqual(["p2"]);
  });

  it("chosenRenames lists only settled rows that will really rename", () => {
    const { groups, bacon, chips, mystery } = setup();
    const dec = new Map<string, Decision>([[bacon.key, pick("bacon", "Bacon")], [chips.key, pick("chips", "Chips")], [mystery.key, pick("tomato", "Tomato Sauce")]]);
    const det = buildDetails(groups, dec, ctx({ ingredients: [...INGS, TAKEN].map(({ id, name }) => ({ id, name })) }));
    const list = chosenRenames(groups, dec, det);
    // chips clashes with an ingredient of that name, the mystery row has no pack number yet
    expect(list.map((r) => [r.ingredientId, r.to])).toEqual([["bacon", "Bacon Middle Rindless Gas Flushed"]]);
  });
});

describe("loadOtherSupplierCounts", () => {
  function fakeSb(tables: Record<string, { data?: unknown; error?: unknown }>) {
    return {
      from(t: string) {
        const r = tables[t] ?? { data: null, error: { message: "missing" } };
        const b: Record<string, unknown> = {};
        b.select = () => b;
        b.eq = () => b;
        b.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: r.data ?? null, error: r.error ?? null }).then(res);
        return b;
      },
    } as never;
  }
  it("counts distinct other active suppliers per ingredient", async () => {
    const sb = fakeSb({
      invoice_suppliers: { data: [{ id: "s1", active: true }, { id: "s2", active: true }, { id: "s3", active: false }] },
      invoice_item_map: {
        data: [
          { ingredient_id: "bacon", supplier_id: "s2", rejected: false },
          { ingredient_id: "bacon", supplier_id: "s2", rejected: false },
          { ingredient_id: "bacon", supplier_id: "s3", rejected: false },
          { ingredient_id: "bacon", supplier_id: "s1", rejected: false },
          { ingredient_id: null, supplier_id: "s2", rejected: false },
        ],
      },
    });
    expect([...(await loadOtherSupplierCounts(sb, "s1"))]).toEqual([["bacon", 1]]);
  });
  it("gives an empty map when the tables are missing", async () => {
    expect((await loadOtherSupplierCounts(fakeSb({}), "s1")).size).toBe(0);
  });
});

describe("source rules for the new files", () => {
  const files = [
    "lib/invoice-conversion.ts",
    "lib/invoice-match-names.ts",
    "lib/invoice-match-save.ts",
    "lib/invoice-todo-match.ts",
    "components/invoices/match-screen.tsx",
    "components/invoices/match-row.tsx",
    "components/invoices/match-detail.tsx",
    "components/invoices/match-rename-sheet.tsx",
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
  it("each row can be saved on its own, with its own rename question", () => {
    const row = read("components/invoices/match-row.tsx");
    const screen = read("components/invoices/match-screen.tsx");
    expect(row).toContain("Save This Item");
    expect(screen).toContain("onSaveClick(new Set([g.key]))");
    expect(screen).toContain("only.has(a.key)");
  });
  it("makes every control at least 44px: the inputs, the switch, the quick buttons", () => {
    const d = read("components/invoices/match-detail.tsx");
    expect(d.match(/min-h-\[44px\]/g)!.length).toBeGreaterThanOrEqual(3);
    expect(d).toContain('role="switch"');
    expect(d).toContain("Keep Current Name");
    expect(d).toContain("App name will become");
    expect(d).toContain("Work It Out From Packs");
  });
  it("writes only through the store, the ordering data layer and answerItemGroups, never a raw insert or update", () => {
    for (const f of files) expect(strip(read(f)), f).not.toMatch(/\.(insert|upsert)\(|\.from\([^)]*\)\s*\.(update|delete)\(/);
    const screen = strip(read("components/invoices/match-screen.tsx"));
    expect(screen).toContain("store.updateIngredient(");
    expect(screen).toContain("store.updateItem(");
    expect(screen).toContain("updateProduct(");
    expect(screen).toContain("answerItemGroups(");
    expect(strip(read("lib/invoice-match-save.ts"))).not.toMatch(/\.update\(/);
  });
  it("asks before renaming anything, with the three buttons Troy named", () => {
    const sheet = read("components/invoices/match-rename-sheet.tsx");
    expect(sheet).toContain("Rename All");
    expect(sheet).toContain("Only Save The Matches");
    expect(sheet).toContain("Rename ${n}");
    const screen = read("components/invoices/match-screen.tsx");
    expect(screen).toContain("Undo Renames");
    expect(screen).toContain("planBatchRenames(");
    // Save And Leave never renames: it saves the matches only
    expect(screen).toMatch(/const save = useCallback\(\(\) => runSave\(null\)/);
  });
  it("keeps the plain words: no jargon on screen", () => {
    const text = [read("components/invoices/match-detail.tsx"), read("components/invoices/match-rename-sheet.tsx")].join("\n");
    for (const bad of [/\bquestions?\b/i, /\blearning\b/i, /\bdecision\b/i, /\bambiguous\b/i, /\breconcile/i]) expect(text.replace(/\/\*[\s\S]*?\*\//g, ""), String(bad)).not.toMatch(bad);
  });
});
