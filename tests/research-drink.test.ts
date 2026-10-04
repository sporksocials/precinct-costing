import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  BODY_MAX,
  buildDrinkRequest,
  BUDGET_MS,
  collectVerified,
  DEFAULT_MODEL,
  houseRuleBreak,
  initialResearchStatus,
  MAX_NOTES,
  MAX_NOTES_PER_DRINK,
  MAX_SEARCHES,
  normUrl,
  parseRequest,
  prepareNotes,
  researchDrink,
  researchWhy,
  SYSTEM_PROMPT,
  titleCase,
  validateReply,
  buildUserPrompt,
  type DrinkRequest,
  type ResearchEnv,
  type ValidateContext,
} from "@/lib/research-drink";
import { requestResearch } from "@/lib/research-drink-client";
import { insertMenuItemRow, insertResearchNotes, researchColumnMissing } from "@/lib/store";
import type { MenuItem } from "@/lib/types";

const ROOT = path.resolve(__dirname, "..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");

const LIME = "00000000-0000-4000-8000-000000000002";
const TEQ = "00000000-0000-4000-8000-000000000001";
const SYRUP = "00000000-0000-4000-8000-000000000004";
const GOOD_REQ = {
  itemName: "Passionfruit Smash",
  category: "Cocktail",
  glass: "Rocks Glass",
  lines: [
    { id: TEQ, name: "Tequila Blanco", qty: 45, unit: "ml" },
    { id: LIME, name: "Lime Juice", qty: 30, unit: "ml" },
    { id: SYRUP, name: "Sugar Syrup", qty: 15, unit: "ml" },
    { name: "Passionfruit Mix", qty: 40, unit: "ml", prep: true },
  ],
  method: ["Chill the glass", "Shake with ice", "Strain into the glass"],
  garnish: ["Mint sprig"],
  existingTitles: [],
};
const INPUT = parseRequest(GOOD_REQ) as DrinkRequest;

// ------------------------------------------------------------------ the search tool's own results

const RESULTS = [
  { url: "https://iba-world.com/iba-cocktail/margarita/", title: "IBA: Margarita" },
  { url: "https://www.diffordsguide.com/cocktails/recipe/37/margarita", title: "Difford's Guide: Margarita" },
  { url: "https://www.liquor.com/recipes/classic-margarita/", title: "Liquor.com: Classic Margarita" },
];
const searchBlocks = (results = RESULTS) => [
  { type: "text", text: "I'll look this up." },
  { type: "server_tool_use", id: "srvtoolu_1", name: "web_search", input: { query: "passionfruit smash" } },
  { type: "web_search_tool_result", tool_use_id: "srvtoolu_1", content: results.map((r) => ({ type: "web_search_result", url: r.url, title: r.title, encrypted_content: "x", page_age: null })) },
];
const VERIFIED = collectVerified(searchBlocks());
const ctx = (over: Partial<ValidateContext> = {}): ValidateContext => ({ lines: INPUT.lines, method: INPUT.method, existingTitles: [], verified: VERIFIED, ...over });

const src = (n = 2) => RESULTS.slice(0, n).map((r) => ({ label: r.title, url: r.url }));
const note = (over: Record<string, unknown> = {}) => ({
  kind: "suggestion",
  title: "Lime Juice Amount",
  body: "The card has 30 ml lime juice. IBA and Difford's Guide both use 25 ml, so this may taste sharper than the classic.",
  changes: [{ ingredient_id: LIME, qty: -5, unit: "ml" }],
  method_step: null,
  method_replaces: null,
  sources: src(),
  ...over,
});
const reply = (notes: unknown[]) => JSON.stringify({ notes });

describe("parseRequest", () => {
  it("accepts a well-formed body and keeps prep lines without an id", () => {
    expect(INPUT).toMatchObject({ itemName: "Passionfruit Smash", category: "Cocktail", glass: "Rocks Glass", method: ["Chill the glass", "Shake with ice", "Strain into the glass"] });
    expect(INPUT.lines[0]).toMatchObject({ id: TEQ, name: "Tequila Blanco", qty: 45, unit: "ml" });
    expect(INPUT.lines[3]).toMatchObject({ prep: true, name: "Passionfruit Mix" });
    expect(INPUT.lines[3].id).toBeUndefined();
    expect(parseRequest({ ...GOOD_REQ, category: "Mocktail", garnish: undefined, existingTitles: undefined })).toMatchObject({ category: "Mocktail", garnish: [], existingTitles: [] });
  });
  it("only ever researches a Cocktail or a Mocktail", () => {
    for (const c of ["Cold Drink", "Food", "Wine", "Spirits", "Tap Beer", "RTD", "Gelato", "cocktail", "", undefined, 3]) expect(parseRequest({ ...GOOD_REQ, category: c })).toBeNull();
  });
  it("rejects bad shapes and oversized bodies", () => {
    const l = GOOD_REQ.lines[0];
    const bad: unknown[] = [
      null,
      "x",
      {},
      { ...GOOD_REQ, itemName: "  " },
      { ...GOOD_REQ, itemName: "x".repeat(121) },
      { ...GOOD_REQ, glass: 5 },
      { ...GOOD_REQ, lines: [] },
      { ...GOOD_REQ, lines: undefined },
      { ...GOOD_REQ, lines: Array(41).fill(l) },
      { ...GOOD_REQ, lines: [{ ...l, unit: "oz" }] },
      { ...GOOD_REQ, lines: [{ ...l, qty: -1 }] },
      { ...GOOD_REQ, lines: [{ ...l, qty: "lots" }] },
      { ...GOOD_REQ, lines: [{ name: "No Id", qty: 1, unit: "ml" }] },
      { ...GOOD_REQ, method: [1] },
      { ...GOOD_REQ, method: Array(41).fill("a") },
      { ...GOOD_REQ, method: ["x".repeat(301)] },
      { ...GOOD_REQ, garnish: Array(13).fill("a") },
      { ...GOOD_REQ, existingTitles: Array(61).fill("a") },
      { ...GOOD_REQ, existingTitles: [5] },
    ];
    for (const b of bad) expect(parseRequest(b)).toBeNull();
  });
});

describe("prompt", () => {
  it("states the standing cocktail rules", () => {
    const p = SYSTEM_PROMPT;
    for (const w of [
      "source of truth",
      "NOTE",
      "DELTAS",
      "Only use ids from the recipe lines",
      "sources disagree",
      "at least two sources",
      "Wet and rim the glass with",
      "never suggest how to wet a rim",
      "ordinary ice only",
      "large cube",
      "crushed ice",
      "freshly pulled espresso",
      "sell prices",
      "allergens",
      "sulphites",
      "Title Case",
      "under 400 characters",
      "Australian English",
      "No dashes",
      "no full stop",
      "1 to 3 sources",
      "Never write a URL you did not get from a search",
      "at most 6 notes",
      "Shake hard for 12 seconds",
      "ONLY JSON",
    ]) {
      expect(p.toLowerCase(), w).toContain(w.toLowerCase());
    }
  });
  it("lists the recipe lines with ids, marks preps as not changeable, and shows the method and existing titles", () => {
    const text = buildUserPrompt({ ...INPUT, existingTitles: ["Lime Juice Amount"] });
    expect(text).toContain(`id=${LIME} | Lime Juice: 30 ml`);
    expect(text).toContain("(prep, not changeable) Passionfruit Mix: 40 ml");
    expect(text).toContain("2. Shake with ice");
    expect(text).toContain('do not repeat them): "Lime Juice Amount"');
  });
});

describe("house rules on note text", () => {
  it("flags dashes, ranges, brand wording, prices, dietary talk, large ice, rim wetting", () => {
    const bad = [
      "Shake — hard",
      "Shake – hard",
      "Use 10-20 ml",
      "Shake - hard",
      "An AI wrote this",
      "The model says so",
      "Claude suggests it",
      "Raise the price to $22",
      "Lifts the sell price",
      "Contains gluten",
      "Suits vegan guests",
      "Low in sulphites",
      "Serve over one large ice cube",
      "Use big cubes of ice",
      "Crushed ice blends better",
      "Add freshly pulled espresso",
      "Moisten the rim with water",
      "Wet the rim with lime juice",
    ];
    for (const t of bad) expect(houseRuleBreak(t), t).not.toBeNull();
  });
  it("lets ordinary wording through, including the house rim sentence and a sugar cube", () => {
    for (const t of ["Shake hard for 12 seconds", "Wet and rim the glass with salt", "Use 10 to 20 ml of lime juice", "Add one cube of sugar", "Pre-mix the syrup", "Fine strain into the glass"]) expect(houseRuleBreak(t), t).toBeNull();
  });
  it("titleCase tidies a title and leaves acronyms alone", () => {
    expect(titleCase("lime juice amount.")).toBe("Lime Juice Amount");
    expect(titleCase("less rum and lime than the IBA classic")).toBe("Less Rum and Lime Than the IBA Classic");
  });
});

describe("source verification", () => {
  it("collects only URLs the tool returned, from results and from citations", () => {
    const v = collectVerified([...searchBlocks(), { type: "text", text: "x", citations: [{ type: "web_search_result_location", url: "https://punchdrink.com/recipes/a", title: "Punch" }] }, { type: "text", text: "https://typed-by-the-model.example/page" }]);
    expect([...v.keys()].sort()).toEqual(["diffordsguide.com/cocktails/recipe/37/margarita", "iba-world.com/iba-cocktail/margarita", "liquor.com/recipes/classic-margarita", "punchdrink.com/recipes/a"]);
  });
  it("treats the same page written two ways as one (www, trailing slash, fragment, tracking)", () => {
    expect(normUrl("https://www.iba-world.com/iba-cocktail/margarita/#top?x")).toBe(normUrl("https://iba-world.com/iba-cocktail/margarita"));
    expect(normUrl("https://iba-world.com/a?utm_source=x&id=2")).toBe(normUrl("https://iba-world.com/a?id=2"));
    expect(normUrl("https://iba-world.com/a?id=2")).not.toBe(normUrl("https://iba-world.com/a?id=3"));
    expect(normUrl("javascript:alert(1)")).toBeNull();
    expect(normUrl("not a url")).toBeNull();
  });
  it("keeps a URL the tool returned (with the tool's own spelling) and drops one it did not", () => {
    const r = validateReply(reply([note({ sources: [{ label: "IBA", url: "https://www.iba-world.com/iba-cocktail/margarita" }, { label: "Made Up", url: "https://invented.example.com/fake" }] })]), ctx()) as unknown as { notes: { sources: { url: string; label: string }[] }[] };
    expect(r.notes[0].sources).toEqual([{ label: "IBA", url: "https://iba-world.com/iba-cocktail/margarita/" }]);
  });
  it("drops a note whose only sources were not returned by the tool, and says why when nothing is left", () => {
    const r = validateReply(reply([note({ sources: [{ label: "Fake", url: "https://invented.example.com/fake" }] })]), ctx());
    expect(r).toEqual({ reason: "bad_reply_sources" });
    const mixed = validateReply(reply([note({ sources: [{ label: "Fake", url: "https://invented.example.com/fake" }] }), note({ title: "Second Note" })]), ctx()) as unknown as { notes: { title: string }[]; dropped: Record<string, number> };
    expect(mixed.notes.map((n) => n.title)).toEqual(["Second Note"]);
    expect(mixed.dropped.sources).toBe(1);
  });
  it("never accepts a non http(s) link or a source with no url", () => {
    expect(validateReply(reply([note({ sources: [{ label: "x", url: "javascript:alert(1)" }, { label: "y" }, "https://iba-world.com/iba-cocktail/margarita/"] })]), ctx())).toEqual({ reason: "bad_reply_sources" });
  });
  it("uses the search result's own title when the label is missing or breaks a rule, and keeps at most 3 sources", () => {
    const r = validateReply(reply([note({ sources: [{ label: "", url: RESULTS[0].url }, { label: "An AI blog", url: RESULTS[1].url }, { label: "L", url: RESULTS[2].url }, { label: "dup", url: RESULTS[2].url }] })]), ctx()) as unknown as { notes: { sources: { label: string }[] }[] };
    expect(r.notes[0].sources.map((s) => s.label)).toEqual(["IBA: Margarita", "Difford's Guide: Margarita", "L"]);
  });
});

describe("validateReply", () => {
  it("tolerates a code fence and a sentence around the JSON", () => {
    const r = validateReply("```json\n" + reply([note()]) + "\n```", ctx()) as unknown as { notes: unknown[] };
    expect(r.notes).toHaveLength(1);
    expect(((validateReply("Here you go: " + reply([note()]) + " Done.", ctx()) as unknown as { notes: unknown[] }).notes)).toHaveLength(1);
  });
  it("keeps a good note in the exact shape the notes table takes", () => {
    const r = validateReply(reply([note()]), ctx()) as unknown as { notes: Record<string, unknown>[] };
    expect(r.notes[0]).toEqual({
      kind: "suggestion",
      title: "Lime Juice Amount",
      body: expect.stringContaining("25 ml"),
      changes: [{ ingredient_id: LIME, qty: -5, unit: "ml" }],
      method_step: null,
      method_replaces: null,
      sources: [{ label: "IBA: Margarita", url: RESULTS[0].url }, { label: "Difford's Guide: Margarita", url: RESULTS[1].url }],
    });
  });
  it("is strict about the outer shape", () => {
    expect(validateReply("sorry, cannot", ctx())).toEqual({ reason: "bad_reply_json" });
    expect(validateReply(JSON.stringify({ items: [] }), ctx())).toEqual({ reason: "bad_reply_notes" });
    expect(validateReply(JSON.stringify({ notes: "none" }), ctx())).toEqual({ reason: "bad_reply_notes" });
    expect(validateReply(reply([]), ctx())).toEqual({ notes: [], dropped: {}, trimmed: 0 });
  });
  it("drops unknown kinds, dashes, over-long and too-short bodies, brand wording and links", () => {
    const bads = [
      note({ kind: "warning" }),
      note({ kind: undefined }),
      note({ title: "A — B Title" }),
      note({ title: "ab" }),
      note({ body: "The card has 30 ml lime — IBA uses 25 ml for this drink." }),
      note({ body: "x".repeat(BODY_MAX + 1) }),
      note({ body: "Too short." }),
      note({ body: "An AI model found that IBA uses 25 ml lime juice for this drink, which is less." }),
      note({ body: "IBA uses 25 ml lime juice for this drink, see https://iba-world.com/iba-cocktail/margarita for more." }),
      note({ body: "Sell this at $22 because IBA uses 25 ml lime juice for this drink and it costs more." }),
      note({ body: "IBA uses 25 ml lime juice for this drink and the gluten free guests prefer it too." }),
      "not an object",
      null,
    ];
    const r = validateReply(reply(bads), ctx());
    expect(r).toEqual({ reason: "bad_reply_notes" });
    for (const b of bads) expect(validateReply(reply([b, note({ title: "Survivor" })]), ctx()), JSON.stringify(b)).toMatchObject({ notes: [{ title: "Survivor" }] });
  });
  it("tidies a title into Title Case and drops a trailing full stop from a step", () => {
    const r = validateReply(reply([note({ title: "lime juice amount", changes: [], method_step: "shake hard for 12 seconds.", method_replaces: "Shake with ice" })]), ctx()) as unknown as { notes: { title: string; method_step: string }[] };
    expect(r.notes[0].title).toBe("Lime Juice Amount");
    expect(r.notes[0].method_step).toBe("Shake hard for 12 seconds");
  });
  it("checks changes: shape, ids that are not in the recipe, preps, units, size, and taking off more than the card has", () => {
    const ok = (changes: unknown) => validateReply(reply([note({ changes }), note({ title: "Second Note", changes: [] })]), ctx()) as unknown as { notes: { title: string; changes: unknown[] }[] };
    expect(ok([{ ingredient_id: LIME, qty: 10, unit: "ml" }]).notes[0].changes).toEqual([{ ingredient_id: LIME, qty: 10, unit: "ml" }]);
    expect(ok([{ ingredient_id: LIME, qty: 0.01, unit: "L" }]).notes[0].changes).toHaveLength(1); // same family, other unit
    const dropped = [
      [{ ingredient_id: "11111111-1111-1111-1111-111111111111", qty: 10, unit: "ml" }], // not a line of this drink
      [{ ingredient_id: LIME, qty: 10, unit: "g" }], // a different family from the line
      [{ ingredient_id: LIME, qty: 10, unit: "each" }],
      [{ ingredient_id: LIME, qty: 0, unit: "ml" }],
      [{ ingredient_id: LIME, qty: "10", unit: "ml" }],
      [{ ingredient_id: LIME, qty: 500, unit: "ml" }], // absurd for one drink
      [{ ingredient_id: LIME, qty: -31, unit: "ml" }], // more than the 30 ml on the card
      [{ ingredient_id: LIME, qty: 5, unit: "ml" }, { ingredient_id: LIME, qty: 5, unit: "ml" }],
      [{ ingredient_id: TEQ, qty: 5, unit: "ml" }, { ingredient_id: LIME, qty: 5, unit: "ml" }, { ingredient_id: SYRUP, qty: 5, unit: "ml" }, { ingredient_id: LIME, qty: 1, unit: "ml" }],
      [{ ingredient_id: LIME }],
      [null],
      "ten ml",
      { ingredient_id: LIME, qty: 5, unit: "ml" },
    ];
    for (const d of dropped) expect(ok(d).notes.map((n) => n.title), JSON.stringify(d)).toEqual(["Second Note"]);
  });
  it("only adds a method step when it is clearly agreed (two sites), words it in house style, and finds the step it replaces", () => {
    const step = (over: Record<string, unknown>) => validateReply(reply([note({ changes: [], method_step: "Shake hard for 12 seconds", method_replaces: null, ...over }), note({ title: "Second Note", changes: [] })]), ctx()) as unknown as { notes: { title: string; method_step: string | null; method_replaces: string | null }[] };
    expect(step({}).notes[0]).toMatchObject({ method_step: "Shake hard for 12 seconds", method_replaces: null });
    expect(step({ method_replaces: "shake with ice" }).notes[0].method_replaces).toBe("shake with ice");
    const one = [{ label: "IBA", url: RESULTS[0].url }];
    const sameSite = [{ label: "a", url: RESULTS[1].url }, { label: "b", url: "https://www.diffordsguide.com/cocktails/recipe/37/margarita" }];
    for (const bad of [{ sources: one }, { sources: sameSite }, { method_replaces: "A step that is not on the card" }, { method_step: "Shake — hard" }, { method_step: "Shake hard for ages with https://x.com" }, { method_step: "ab" }, { method_step: "Pour over a large ice cube" }, { method_step: "Dip the rim in salt" }, { method_step: 5 }, { method_step: null, method_replaces: "Shake with ice" }]) {
      expect(step(bad).notes.map((n) => n.title), JSON.stringify(bad)).toEqual(["Second Note"]);
    }
    expect(step({ method_step: "Wet and rim the glass with salt" }).notes[0].method_step).toBe("Wet and rim the glass with salt");
  });
  it("makes a note that would change the recipe a suggestion, never a difference", () => {
    const r = validateReply(reply([note({ kind: "difference" }), note({ kind: "difference", title: "Plain Difference", changes: [] })]), ctx()) as unknown as { notes: { kind: string }[] };
    expect(r.notes.map((n) => n.kind)).toEqual(["suggestion", "difference"]);
  });
  it("drops a title the drink already has, and a repeat inside the reply", () => {
    const r = validateReply(reply([note({ title: "Lime Juice Amount!" }), note({ title: "Second Note" }), note({ title: "second  note" })]), ctx({ existingTitles: ["lime juice amount"] })) as unknown as { notes: { title: string }[]; dropped: Record<string, number> };
    expect(r.notes.map((n) => n.title)).toEqual(["Second Note"]);
    expect(r.dropped.duplicate).toBe(2);
  });
  it("trims more than 6 notes to 6", () => {
    const r = validateReply(reply(Array.from({ length: 9 }, (_, i) => note({ title: `Note Number ${i + 1}`, changes: [] }))), ctx()) as unknown as { notes: { title: string }[]; trimmed: number };
    expect(r.notes).toHaveLength(MAX_NOTES);
    expect(r.notes[0].title).toBe("Note Number 1");
    expect(r.trimmed).toBe(3);
  });
});

// ------------------------------------------------------------------ idempotency and the note cap

describe("prepareNotes (a repeat run never doubles a note)", () => {
  const n = (title: string) => ({ title });
  it("skips a title the drink already has, open or closed, in any case or punctuation", () => {
    expect(prepareNotes([n("Lime Juice Amount"), n("Shake Time"), n("shake time!")], ["lime juice amount"]).map((x) => x.title)).toEqual(["Shake Time"]);
  });
  it("never lets a drink hold more than the cap", () => {
    const existing = Array.from({ length: MAX_NOTES_PER_DRINK - 2 }, (_, i) => `Old ${i}`);
    expect(prepareNotes([n("One"), n("Two"), n("Three")], existing)).toHaveLength(2);
    expect(prepareNotes([n("One")], Array.from({ length: MAX_NOTES_PER_DRINK }, (_, i) => `Old ${i}`))).toEqual([]);
    expect(prepareNotes(Array.from({ length: 10 }, (_, i) => n(`T ${i}`)), [])).toHaveLength(MAX_NOTES);
  });
});

type Row = Record<string, unknown>;
function fakeDb(opts: { error?: { code?: string; message: string } } = {}) {
  const inserted: { table: string; payload: Row[] }[] = [];
  const sb = {
    from(table: string) {
      return {
        insert(payload: Row | Row[]) {
          const rows = Array.isArray(payload) ? payload : [payload];
          inserted.push({ table, payload: rows });
          return { select: () => Promise.resolve(opts.error ? { data: null, error: opts.error } : { data: rows.map((r) => ({ ...r, prep_id: null, created_at: "2026-10-04T00:00:00Z", updated_at: "2026-10-04T00:00:00Z" })), error: null }) };
        },
      };
    },
  };
  return { sb: sb as unknown as SupabaseClient, inserted };
}

describe("insertResearchNotes (the store's database half)", () => {
  const notes = (validateReply(reply([note(), note({ title: "Shake Time", changes: [], method_step: "Shake hard for 12 seconds", method_replaces: "Shake with ice" })]), ctx()) as unknown as { notes: never[] }).notes;
  let id = 0;
  const makeId = () => `n${++id}`;
  it("files open notes on the drink through insertRows (null-free rows, the table's own columns)", async () => {
    const f = fakeDb();
    const saved = await insertResearchNotes(f.sb, "item-1", [], notes, makeId);
    expect(saved).toHaveLength(2);
    expect(f.inserted).toHaveLength(1);
    expect(f.inserted[0].table).toBe("cost_research_notes");
    for (const row of f.inserted[0].payload) {
      expect(Object.keys(row).sort()).toEqual(["body", "changes", "created_at", "id", "item_id", "kind", "method_replaces", "method_step", "sources", "status", "title"].filter((k) => row[k] !== undefined).sort());
      expect(row.status).toBe("open");
      expect(row.item_id).toBe("item-1");
      expect(Object.values(row).every((v) => v !== null && v !== undefined)).toBe(true);
    }
  });
  it("keeps the research's order: each note is stamped a millisecond after the one before", async () => {
    const f = fakeDb();
    await insertResearchNotes(f.sb, "item-1", [], notes, makeId);
    const stamps = f.inserted[0].payload.map((r) => String(r.created_at));
    expect(stamps[0] < stamps[1]).toBe(true);
  });
  it("writes nothing when every title is already there (run it twice, get one set)", async () => {
    const f = fakeDb();
    const first = await insertResearchNotes(f.sb, "item-1", [], notes, makeId);
    const again = await insertResearchNotes(f.sb, "item-1", first, notes, makeId);
    expect(again).toEqual([]);
    expect(f.inserted).toHaveLength(1);
  });
  it("throws the database's message when the insert fails", async () => {
    await expect(insertResearchNotes(fakeDb({ error: { message: "permission denied" } }).sb, "item-1", [], notes, makeId)).rejects.toThrow("permission denied");
  });
});

// ------------------------------------------------------------------ the call and its fallbacks

const KEY = "sk-test-SECRET-KEY-0123456789";
const env = { ANTHROPIC_API_KEY: KEY, ANTHROPIC_BASE_URL: "http://localhost:9999/" };
const ok = (content: unknown[], extra: Record<string, unknown> = {}) => ({ ok: true, status: 200, json: async () => ({ id: "msg", stop_reason: "end_turn", content, usage: { server_tool_use: { web_search_requests: 3 } }, ...extra }) }) as unknown as Response;
const goodAnswer = (notes: unknown[] = [note()]) => ok([...searchBlocks(), { type: "text", text: reply(notes) }]);
const why = async (f: unknown, e: ResearchEnv = env) => {
  const r = await researchDrink(INPUT, e, f as never);
  return r.ok ? "ok" : r.reason;
};

describe("researchDrink", () => {
  it("returns the validated notes with the number of searches, and posts the web search tool with a cap", async () => {
    const f = vi.fn().mockResolvedValue(goodAnswer());
    const r = await researchDrink(INPUT, env, f as never);
    expect(r).toMatchObject({ ok: true, searches: 3, notes: [{ title: "Lime Juice Amount" }] });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("http://localhost:9999/v1/messages");
    const body = JSON.parse(init.body);
    expect(body.tools).toEqual([{ type: "web_search_20250305", name: "web_search", max_uses: MAX_SEARCHES }]);
    expect(MAX_SEARCHES).toBe(4);
    expect(body.model).toBe(DEFAULT_MODEL);
    expect(DEFAULT_MODEL).toBe("claude-sonnet-5-5");
    expect(body.system).toBe(SYSTEM_PROMPT);
    expect(init.headers["x-api-key"]).toBe(KEY);
    expect(init.headers["anthropic-beta"]).toBeUndefined();
    expect(body.thinking).toEqual({ type: "between_tools" });
    expect(body.output_config).toEqual({ effort: "medium" });
    expect(body.max_tokens).toBeLessThanOrEqual(4096);
  });
  it("reads the model from RESEARCH_DRINK_MODEL and sends no thinking settings to another model", async () => {
    const f = vi.fn().mockResolvedValue(goodAnswer());
    await researchDrink(INPUT, { ...env, RESEARCH_DRINK_MODEL: " claude-opus-5-5 " }, f as never);
    const body = JSON.parse(f.mock.calls[0][1].body);
    expect(body.model).toBe("claude-opus-5-5");
    expect(body.thinking).toBeUndefined();
    expect(body.output_config).toBeUndefined();
  });
  it("joins an answer split over several text blocks (cited text) and ignores narration before the last search", async () => {
    const text = reply([note()]);
    const r = await researchDrink(INPUT, env, vi.fn().mockResolvedValue(ok([...searchBlocks(), { type: "text", text: text.slice(0, 40) }, { type: "text", text: text.slice(40), citations: [{ type: "web_search_result_location", url: RESULTS[0].url, title: "t" }] }])) as never);
    expect(r.ok).toBe(true);
  });
  it("continues a paused turn with the same tools and keeps the sources from the first part", async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(ok(searchBlocks(), { stop_reason: "pause_turn" }))
      .mockResolvedValueOnce(ok([{ type: "text", text: reply([note()]) }]));
    const r = await researchDrink(INPUT, env, f as never);
    expect(r.ok).toBe(true);
    expect(f).toHaveBeenCalledTimes(2);
    const second = JSON.parse(f.mock.calls[1][1].body);
    expect(second.messages).toHaveLength(2);
    expect(second.messages[1].role).toBe("assistant");
    expect(second.tools[0].type).toBe("web_search_20250305");
  });
  it("stops continuing after two pauses", async () => {
    const f = vi.fn().mockResolvedValue(ok(searchBlocks(), { stop_reason: "pause_turn" }));
    expect(await why(f)).toBe("timeout");
    expect(f).toHaveBeenCalledTimes(3);
  });
  it("gives up with timeout when the 50 second budget is spent", async () => {
    let t = 0;
    const f = vi.fn().mockImplementation(async () => {
      t += BUDGET_MS - 1000; // the first part takes almost the whole budget
      return ok(searchBlocks(), { stop_reason: "pause_turn" });
    });
    const r = await researchDrink(INPUT, env, f as never, () => t);
    expect(r).toMatchObject({ ok: false, reason: "timeout" });
    expect(f).toHaveBeenCalledTimes(1);
    expect(BUDGET_MS).toBe(50_000);
  });
  it("hands each request the time that is left, never more than the budget", async () => {
    const spy = vi.spyOn(AbortSignal, "timeout");
    await researchDrink(INPUT, env, vi.fn().mockResolvedValue(goodAnswer()) as never);
    expect(spy.mock.calls[0][0]).toBeLessThanOrEqual(BUDGET_MS);
    spy.mockRestore();
  });

  it("says why it did not answer", async () => {
    const http = (status: number, message = "x") => vi.fn().mockResolvedValue({ ok: false, status, json: async () => ({ error: { message } }) });
    expect(await why(vi.fn(), {})).toBe("no_key");
    expect(await why(vi.fn(), { ANTHROPIC_API_KEY: "   " })).toBe("no_key");
    expect(await why(http(401))).toBe("http_401");
    expect(await why(http(403))).toBe("http_403");
    expect(await why(http(429))).toBe("http_429");
    expect(await why(http(500))).toBe("http_500");
    expect(await why(http(400, "Your credit balance is too low to access the API"))).toBe("credits");
    expect(await why(http(400, "Web search is not enabled for your organization"))).toBe("search_unavailable");
    expect(await why(vi.fn().mockRejectedValue(new DOMException("t", "TimeoutError")))).toBe("timeout");
    expect(await why(vi.fn().mockRejectedValue(new DOMException("t", "AbortError")))).toBe("timeout");
    expect(await why(vi.fn().mockRejectedValue(new Error("offline")))).toBe("network");
    expect(await why(vi.fn().mockResolvedValue(ok([...searchBlocks(), { type: "text", text: "Sorry, no." }])))).toBe("bad_reply_json");
    expect(await why(vi.fn().mockResolvedValue(ok([...searchBlocks(), { type: "text", text: JSON.stringify({ x: 1 }) }])))).toBe("bad_reply_notes");
    expect(await why(vi.fn().mockResolvedValue(ok([...searchBlocks(), { type: "text", text: reply([note({ sources: [{ label: "x", url: "https://invented.example.com/x" }] })]) }])))).toBe("bad_reply_sources");
    expect(await why(vi.fn().mockResolvedValue(ok([...searchBlocks().slice(1), { type: "text", text: "  " }])))).toBe("bad_reply_empty");
    expect(await why(vi.fn().mockResolvedValue(ok([{ type: "text", text: reply([note()]) }])))).toBe("no_search"); // the model never searched
    expect(await why(vi.fn().mockResolvedValue(ok([{ type: "server_tool_use", id: "s", name: "web_search", input: {} }, { type: "web_search_tool_result", tool_use_id: "s", content: { type: "web_search_tool_result_error", error_code: "unavailable" } }, { type: "text", text: reply([]) }])))).toBe("search_unavailable");
    expect(await why(vi.fn().mockResolvedValue(ok([{ type: "text", text: "x" }], { stop_reason: "refusal" })))).toBe("bad_reply_refusal");
    expect(await why(vi.fn().mockResolvedValue(ok(searchBlocks(), { stop_reason: "max_tokens" })))).toBe("bad_reply_cut");
  });
  it("an empty list of notes is a success (nothing worth flagging)", async () => {
    expect(await researchDrink(INPUT, env, vi.fn().mockResolvedValue(goodAnswer([])) as never)).toMatchObject({ ok: true, notes: [] });
  });
  it("never puts the key in the answer, even when the failure or the reply mentions it", async () => {
    const cases = [
      vi.fn().mockRejectedValue(new Error(`boom ${KEY}`)),
      vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: { message: `bad key ${KEY}` } }) }),
      vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => { throw new Error(KEY); } }),
      vi.fn().mockResolvedValue(ok([...searchBlocks(), { type: "text", text: `${KEY} not json` }])),
    ];
    for (const f of cases) {
      const r = await researchDrink(INPUT, env, f as never);
      expect(JSON.stringify(r)).not.toContain(KEY);
      if (!r.ok) expect(JSON.stringify(researchWhy(r.reason))).not.toContain(KEY);
    }
  });
});

describe("researchWhy (plain words)", () => {
  it("never mentions the vendor, the model or AI, and always says something", () => {
    const reasons = ["no_key", "not_signed_in", "credits", "http_401", "http_403", "http_429", "http_500", "search_unavailable", "no_search", "timeout", "network", "unreachable", "bad_reply_json", "bad_reply_sources", "bad_reply_refusal", "bad_reply_cut", "bad_reply_empty", "bad_request", "server", "", undefined];
    for (const r of reasons) {
      const t = researchWhy(r);
      expect(t.length, String(r)).toBeGreaterThan(10);
      expect(t, String(r)).not.toMatch(/claude|anthropic|\bAI\b|\bmodel\b|openai/i);
      expect(t).not.toMatch(/[—–]/);
    }
  });
});

// ------------------------------------------------------------------ the browser half

describe("requestResearch", () => {
  const answer = (status: number, body: unknown) => vi.fn().mockResolvedValue({ ok: status >= 200 && status < 300, status, json: async () => body });
  const good = validateReply(reply([note()]), ctx()) as unknown as { notes: never[] };
  it("returns the notes, checked again", async () => {
    const r = await requestResearch(INPUT, undefined, answer(200, { notes: [...good.notes, { kind: "x" }, null], searches: 3 }) as never);
    expect(r).toMatchObject({ ok: true, searches: 3, notes: [{ title: "Lime Juice Amount" }] });
    expect((r as { notes: unknown[] }).notes).toHaveLength(1);
  });
  it("does not file a note the drink already has", async () => {
    const r = await requestResearch({ ...INPUT, existingTitles: ["lime juice amount"] }, undefined, answer(200, { notes: good.notes }) as never);
    expect(r).toMatchObject({ ok: true, notes: [] });
  });
  it("turns every failure into plain words", async () => {
    const msg = async (f: unknown) => {
      const r = await requestResearch(INPUT, undefined, f as never);
      return r.ok ? "ok" : r.reason;
    };
    expect(await msg(answer(401, { error: "Not signed in" }))).toBe("not_signed_in");
    expect(await msg(answer(400, { error: "Bad request" }))).toBe("bad_request");
    expect(await msg(answer(504, null))).toBe("timeout");
    expect(await msg(answer(503, { reason: "no_key" }))).toBe("no_key");
    expect(await msg(answer(502, { reason: "credits" }))).toBe("credits");
    expect(await msg(answer(502, { reason: "bad_reply_sources" }))).toBe("bad_reply_sources");
    expect(await msg(vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => { throw new Error("html"); } }))).toBe("http_500");
    expect(await msg(vi.fn().mockRejectedValue(new TypeError("offline")))).toBe("unreachable");
    expect(await msg(answer(200, { notes: "x" }))).toBe("bad_reply_notes");
  });
  it("reports cancelled when Cancel was tapped, and timeout when the browser gave up", async () => {
    const hang = (signalOut: { s?: AbortSignal }) => vi.fn().mockImplementation((_u: string, init: RequestInit) => new Promise((_res, rej) => { signalOut.s = init.signal as AbortSignal; init.signal!.addEventListener("abort", () => rej(new DOMException("a", "AbortError"))); }));
    const ctl = new AbortController();
    const p = requestResearch(INPUT, ctl.signal, hang({}) as never);
    ctl.abort();
    expect(await p).toMatchObject({ ok: false, reason: "cancelled" });
    expect(await requestResearch(INPUT, undefined, hang({}) as never, 20)).toMatchObject({ ok: false, reason: "timeout" });
  });
});

describe("buildDrinkRequest", () => {
  const names = { ingredients: new Map([[TEQ, { name: "Tequila Blanco" }], [LIME, { name: "Lime Juice" }]]), preps: new Map([["p1", { name: "Passionfruit Mix" }]]) };
  const line = (id: string, type: "ingredient" | "prep", qty: number, unit: "ml" | "g" = "ml") => ({ id: `l-${id}`, parent_type: "item" as const, parent_id: "i", component_type: type, component_id: id, qty, unit, note: null, sort: 1 });
  const item = { name: "Passionfruit Smash", category: "Cocktail", glass: "Rocks Glass", method: ["Shake"], garnish: ["Mint"] };
  it("reads the saved lines: ingredient ids kept, preps flagged, empty or unknown lines left out", () => {
    const r = buildDrinkRequest(item, [line(TEQ, "ingredient", 45), line("p1", "prep", 40), line(LIME, "ingredient", 0), line("gone", "ingredient", 5), { ...line(LIME, "ingredient", 5), component_id: "" }], names, ["A Title"]);
    expect(r?.lines).toEqual([{ id: TEQ, name: "Tequila Blanco", qty: 45, unit: "ml" }, { name: "Passionfruit Mix", qty: 40, unit: "ml", prep: true }]);
    expect(r).toMatchObject({ itemName: "Passionfruit Smash", glass: "Rocks Glass", method: ["Shake"], garnish: ["Mint"], existingTitles: ["A Title"] });
    expect(parseRequest(r)).not.toBeNull();
  });
  it("is null for a drink with no usable line and for anything but a Cocktail or Mocktail", () => {
    expect(buildDrinkRequest(item, [], names, [])).toBeNull();
    expect(buildDrinkRequest({ ...item, category: "Wine" }, [line(TEQ, "ingredient", 45)], names, [])).toBeNull();
    expect(buildDrinkRequest({ ...item, category: "Food" }, [line(TEQ, "ingredient", 45)], names, [])).toBeNull();
  });
});

// ------------------------------------------------------------------ route

const auth = { user: { id: "u1" } as { id: string } | null, allowed: true as boolean | null, rpcError: false };
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServer: () => ({
    auth: { getUser: async () => ({ data: { user: auth.user } }) },
    rpc: async () => (auth.rpcError ? { data: null, error: { message: "x" } } : { data: auth.allowed, error: null }),
  }),
}));

describe("POST /api/research-drink", () => {
  const post = async (body: unknown, raw = false) => {
    const { POST } = await import("@/app/api/research-drink/route");
    return POST(new Request("http://localhost/api/research-drink", { method: "POST", body: raw ? (body as string) : JSON.stringify(body) }));
  };
  const saved = { ...process.env };
  beforeEach(() => {
    auth.user = { id: "u1" };
    auth.allowed = true;
    auth.rpcError = false;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_BASE_URL;
    delete process.env.RESEARCH_DRINK_MODEL;
    delete process.env.NEXT_PUBLIC_DEMO;
  });
  afterEach(() => {
    process.env = { ...saved };
    vi.unstubAllGlobals();
  });

  it("refuses anyone who is not signed in, or not on the allow-list (and fails closed), without calling the model", async () => {
    process.env.ANTHROPIC_API_KEY = KEY;
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    auth.user = null;
    expect((await post(GOOD_REQ)).status).toBe(401);
    auth.user = { id: "u1" };
    auth.allowed = false;
    expect((await post(GOOD_REQ)).status).toBe(401);
    auth.allowed = true;
    auth.rpcError = true;
    expect((await post(GOOD_REQ)).status).toBe(401);
    expect(f).not.toHaveBeenCalled();
  });
  it("answers 400 for a body that is not JSON or not a usable request, without calling the model", async () => {
    process.env.ANTHROPIC_API_KEY = KEY;
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    expect((await post("{not json", true)).status).toBe(400);
    expect((await post({})).status).toBe(400);
    expect((await post({ ...GOOD_REQ, category: "Wine" })).status).toBe(400);
    expect(f).not.toHaveBeenCalled();
  });
  it("answers 200 with the notes when the research passes the checks", async () => {
    process.env.ANTHROPIC_API_KEY = KEY;
    process.env.ANTHROPIC_BASE_URL = "http://localhost:9/";
    const f = vi.fn().mockResolvedValue(goodAnswer());
    vi.stubGlobal("fetch", f);
    const r = await post(GOOD_REQ);
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(await r.json()).toMatchObject({ notes: [{ title: "Lime Juice Amount", sources: [{ url: RESULTS[0].url }, { url: RESULTS[1].url }] }], searches: 3 });
    expect(f.mock.calls[0][0]).toBe("http://localhost:9/v1/messages");
  });
  it("skips sign-in in demo mode (local visual QA)", async () => {
    process.env.NEXT_PUBLIC_DEMO = "1";
    auth.user = null;
    process.env.ANTHROPIC_API_KEY = KEY;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(goodAnswer()));
    expect((await post(GOOD_REQ)).status).toBe(200);
  });
  it("reports a failure in plain words with a status that says what kind, and never leaks the key", async () => {
    const run = async (f: unknown, withKey = true) => {
      if (withKey) process.env.ANTHROPIC_API_KEY = KEY;
      else delete process.env.ANTHROPIC_API_KEY;
      vi.stubGlobal("fetch", f);
      const r = await post(GOOD_REQ);
      const text = JSON.stringify(await r.clone().json());
      expect(text).not.toContain(KEY);
      return { status: r.status, body: (await r.json()) as { error: string; reason: string } };
    };
    expect(await run(vi.fn(), false)).toMatchObject({ status: 503, body: { reason: "no_key", error: expect.stringContaining("not switched on") } });
    expect(await run(vi.fn().mockRejectedValue(new DOMException("t", "TimeoutError")))).toMatchObject({ status: 504, body: { reason: "timeout" } });
    expect(await run(vi.fn().mockRejectedValue(new Error(`boom ${KEY}`)))).toMatchObject({ status: 502, body: { reason: "network" } });
    expect(await run(vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: { message: "credit balance is too low" } }) }))).toMatchObject({ status: 502, body: { reason: "credits", error: expect.stringContaining("no credit") } });
    expect(await run(vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: { message: "Web search is not enabled" } }) }))).toMatchObject({ status: 502, body: { reason: "search_unavailable" } });
  });
  it("declares a 60 second limit", async () => {
    const mod = await import("@/app/api/research-drink/route");
    expect(mod.maxDuration).toBe(60);
    expect(BUDGET_MS).toBeLessThan(60_000);
  });
});

// ------------------------------------------------------------------ only new cocktails and mocktails are offered

describe("who is offered Research This Drink", () => {
  it("only a new Cocktail or Mocktail starts 'offered'; everything else starts never offered", () => {
    expect(initialResearchStatus("Cocktail")).toBe("offered");
    expect(initialResearchStatus("Mocktail")).toBe("offered");
    for (const c of ["Cold Drink", "Food", "Wine", "Spirits", "Tap Beer", "Packaged Beer & Cider", "RTD", "Gelato", "", null, undefined]) expect(initialResearchStatus(c)).toBeNull();
  });
  it("the New Recipe flow sets it; Duplicate and Save As New Dish start never offered", () => {
    expect(read("components/new-recipe.tsx")).toContain("research_status: initialResearchStatus(category)");
    expect(read("components/editor/recipe-editor.tsx")).toMatch(/source: "duplicate", research_status: null/);
    expect(read("components/editor/what-if.tsx")).toMatch(/source: "what-if", research_status: null/);
  });
  it("the card only shows for an offered Cocktail or Mocktail, and research_status never goes through the editor draft", () => {
    const card = read("components/editor/research-drink.tsx");
    expect(card).toContain('item.research_status !== "offered" || !isResearchCategory(item.category)');
    expect(card).toContain("setResearchOffer");
    expect(card).toContain("addResearchNotes");
    expect(card).not.toMatch(/setDraft/);
    expect(read("lib/draft-changes.ts")).not.toContain("research_status"); // a stale draft value can never become a save
  });
  it("nothing a person can read mentions Claude, Anthropic or AI", () => {
    for (const f of ["components/editor/research-drink.tsx", "lib/research-drink-client.ts"]) expect(read(f), f).not.toMatch(/claude|anthropic|\bAI\b/i);
    const shown = [...read("components/editor/research-drink.tsx").matchAll(/>\s*([^<>{}\n]{12,})\s*</g)].map((m) => m[1]);
    for (const t of shown) expect(t).not.toMatch(/claude|anthropic|\bAI\b|\bmodel\b/i);
  });
  it("a missing research_status column is recognised (an item is still saved without it)", () => {
    expect(researchColumnMissing({ code: "PGRST204", message: "Could not find the 'research_status' column of 'cost_menu_items' in the schema cache" })).toBe(true);
    expect(researchColumnMissing({ code: "42703", message: 'column "research_status" of relation "cost_menu_items" does not exist' })).toBe(true);
    expect(researchColumnMissing({ code: "42703", message: 'column "other" does not exist' })).toBe(false);
    expect(researchColumnMissing({ code: "23505", message: "research_status duplicate" })).toBe(false);
    expect(researchColumnMissing(null)).toBe(false);
  });
});

describe("insertMenuItemRow (creating an item works before and after the migration)", () => {
  const item = { id: "i1", name: "Sunset Fizz", venue_id: 1, category: "Cocktail", section: null, portions: 1, sell_price_inc: null, target_override: null, hh_price_inc: null, active: true, source: "app", notes: null, research_status: "offered" } as MenuItem;
  /** a database that rejects any insert carrying research_status, like one without the column */
  const db = (missing: boolean, other?: { code?: string; message: string }) => {
    const calls: Record<string, unknown>[] = [];
    const sb = {
      from: () => ({
        insert: (payload: Record<string, unknown>) => {
          calls.push(payload);
          if (other) return Promise.resolve({ error: other });
          if (missing && "research_status" in payload) return Promise.resolve({ error: { code: "PGRST204", message: "Could not find the 'research_status' column of 'cost_menu_items' in the schema cache" } });
          return Promise.resolve({ error: null });
        },
      }),
    };
    return { sb: sb as unknown as SupabaseClient, calls };
  };
  it("sends research_status when it is set (after the migration)", async () => {
    const f = db(false);
    expect(await insertMenuItemRow(f.sb, item)).toBe(item);
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0].research_status).toBe("offered");
  });
  it("never sends the field for an item that was never offered (a null is stripped, like every null)", async () => {
    const f = db(true);
    const row = await insertMenuItemRow(f.sb, { ...item, research_status: null });
    expect(f.calls).toHaveLength(1);
    expect("research_status" in f.calls[0]).toBe(false);
    expect(row.research_status).toBeNull();
  });
  it("before the migration the drink is still saved, without the field, and is not offered the card", async () => {
    const f = db(true);
    const row = await insertMenuItemRow(f.sb, item);
    expect(f.calls).toHaveLength(2);
    expect("research_status" in f.calls[1]).toBe(false);
    expect(row.research_status).toBeUndefined();
    expect(row.name).toBe("Sunset Fizz");
  });
  it("any other error still fails the save", async () => {
    await expect(insertMenuItemRow(db(false, { code: "42501", message: "permission denied" }).sb, item)).rejects.toThrow("permission denied");
    expect(db(false, { code: "42501", message: "x" }).calls).toHaveLength(0);
  });
});

// ------------------------------------------------------------------ migration and guards

describe("migration, schema mirror and insert safety", () => {
  const migration = read("supabase/migrations/20261004200000_research_status.sql");
  it("adds a nullable research_status with the three allowed values and no default", () => {
    expect(migration).toMatch(/alter table public\.cost_menu_items\s+add column if not exists research_status text/);
    expect(migration).toContain("check (research_status in ('offered', 'done', 'skipped'))");
    expect(migration).not.toMatch(/research_status text[^;]*(not null|default)/i);
  });
  it("is mirrored in supabase/schema.sql", () => {
    const schema = read("supabase/schema.sql");
    const stmt = migration.slice(migration.indexOf("alter table"), migration.indexOf("comment on column"));
    expect(schema).toContain(stmt.trim());
    expect(schema).toContain("20261004200000_research_status.sql");
    expect(schema).toContain("comment on column public.cost_menu_items.research_status");
  });
  it("research_status is on the MenuItem type", () => {
    expect(read("lib/types.ts")).toMatch(/research_status\?: ResearchOffer \| null/);
  });
  it("no raw .insert( in the new files; every note insert goes through insertRows", () => {
    for (const f of ["lib/research-drink.ts", "lib/research-drink-client.ts", "components/editor/research-drink.tsx", "components/new-recipe.tsx", "app/api/research-drink/route.ts"]) expect(read(f), f).not.toMatch(/\.insert\(/);
    const store = read("lib/store.tsx");
    expect(store).toContain('insertRows(sb, "cost_research_notes", rows)');
    // the only calls are the insertRow / insertRows helpers (the other two matches are comments), exactly as before
    expect(store.split("\n").filter((l) => /\.insert\(/.test(l) && !/^\s*(\/\/|\*)/.test(l)).map((l) => l.trim())).toEqual(["return sb.from(table).insert(withoutNulls(row));", "return sb.from(table).insert(rows.map(withoutNulls));"]);
  });
});
