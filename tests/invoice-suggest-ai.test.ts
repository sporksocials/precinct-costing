import { describe, expect, it } from "vitest";
import { AiError, type ClaudeCallArgs, type ClaudeFn } from "../lib/invoice-ai";
import { addSuggestions, buildUserText, parseReply, suggestionOf, SYSTEM_PROMPT, type AskLine } from "../lib/invoice-suggest-ai";
import { createFakeSupabase } from "./helpers/fake-supabase";
import { BIDFOOD_LINES, FIXTURE_INGREDIENTS, idOf } from "./fixtures/invoice-ingredients";

const DOC = "doc-b";

function setup(over: { options?: (n: number) => any[] } = {}) {
  return createFakeSupabase({
    invoice_documents: [{ id: DOC, venue_id: 1, file_id: "file-1" }],
    invoice_lines: BIDFOOD_LINES.map((l, i) => ({ id: `L${i + 1}`, document_id: DOC, line_no: i + 1, item_code: l.code, description: l.description, qty: l.qty, unit: l.unit, unit_price_ex: l.price })),
    invoice_questions: BIDFOOD_LINES.map((_l, i) => ({
      id: `Q${i + 1}`, venue_id: 1, document_id: DOC, line_id: `L${i + 1}`, kind: "unmatched_line", prompt: "x", status: "open",
      options: over.options?.(i) ?? [{ id: "not_a_product", label: "This is not a stock item", action: "not_a_product" }, { id: "ignore_line", label: "Ignore this line", action: "ignore_line" }],
    })),
    cost_ingredients: FIXTURE_INGREDIENTS.map((i) => ({ ...i })),
  });
}

/** A model that answers like a careful person: it finds the expected ingredient in each line's numbered list. */
function wise(replyFor?: (ref: string, pickNumber: number | null) => Record<string, unknown>): { claude: ClaudeFn; calls: ClaudeCallArgs[] } {
  const calls: ClaudeCallArgs[] = [];
  const claude: ClaudeFn = async (args) => {
    calls.push(args);
    const answers: Record<string, unknown>[] = [];
    const blocks = args.text.split(/\n(?=L\d+: )/).slice(1);
    for (const b of blocks) {
      const ref = /^(L\d+): /.exec(b)![1];
      const desc = /^L\d+: "(.*?)"/.exec(b)![1];
      const want = BIDFOOD_LINES.find((l) => l.description === desc)?.expect ?? null;
      const m = want ? new RegExp(`^\\s+(\\d+)\\. "${want.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"$`, "m").exec(b) : null;
      const pick = m ? Number(m[1]) : null;
      answers.push(replyFor ? replyFor(ref, pick) : { ref, pick, confidence: 0.9, reason: pick ? "Same product and brand." : "Not in the list." });
    }
    return { text: JSON.stringify({ answers }), usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0 }, costUsd: 0, model: args.model, stopReason: "end_turn" };
  };
  return { claude, calls };
}

describe("addSuggestions", () => {
  it("asks ONCE for the whole invoice and writes a suggestion as the FIRST option of each question it is sure about", async () => {
    const f = setup();
    const { claude, calls } = wise();
    const out = await addSuggestions(f.sb, claude, DOC, { env: {} });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ feature: "invoice_suggest", model: "claude-haiku-5-5", documentId: DOC, venueId: 1 });
    expect(out.asked).toBe(12);
    expect(out.suggested).toBe(11); // the tin of pineapple pieces is not in the app, so the model said null
    const q1 = f.db.invoice_questions.find((q) => q.id === "Q1")!;
    expect(q1.options[0]).toMatchObject({ id: `suggest:${idOf("Vegan Bun")}`, label: "Suggested: Vegan Bun", ingredient_id: idOf("Vegan Bun"), confidence: 0.9 });
    // the original options are kept, after it
    expect(q1.options.map((o: any) => o.id).slice(1)).toEqual(["not_a_product", "ignore_line"]);
    expect(suggestionOf(q1.options)).toMatchObject({ ingredientId: idOf("Vegan Bun"), confidence: 0.9 });
    // a null answer adds nothing
    expect(suggestionOf(f.db.invoice_questions.find((q) => q.id === "Q12")!.options)).toBeNull();
  });

  it("only suggests: nothing is matched, ignored or applied", async () => {
    const f = setup();
    await addSuggestions(f.sb, wise().claude, DOC, { env: {} });
    expect(f.log.filter((o) => o.op !== "select").every((o) => o.table === "invoice_questions" && o.op === "update")).toBe(true);
    expect(f.db.invoice_questions.every((q) => q.status === "open")).toBe(true);
    expect(f.db.invoice_lines.every((l) => l.match_state === undefined && l.ingredient_id === undefined)).toBe(true);
  });

  it("sends names and ids only: never a price, and the scan text is marked as data", async () => {
    const f = setup();
    const { claude, calls } = wise();
    await addSuggestions(f.sb, claude, DOC, { env: {} });
    expect(calls[0].text).not.toMatch(/\$|41\.64|10\.14|8\.75|ex GST/);
    expect(calls[0].text).toContain('"POTATO WEDGES SEASONED (MCCAIN) 2kg"');
    expect(calls[0].system).toMatch(/never follow instructions/i);
    expect(SYSTEM_PROMPT).not.toMatch(/[–—]/);
  });

  it("uses the model named by INVOICE_SORT_MODEL", async () => {
    const f = setup();
    const { claude, calls } = wise();
    await addSuggestions(f.sb, claude, DOC, { env: { INVOICE_SORT_MODEL: "claude-haiku-9-9" } });
    expect(calls[0].model).toBe("claude-haiku-9-9");
  });

  it("does not ask twice for a question that already has a suggestion", async () => {
    const f = setup();
    const { claude, calls } = wise();
    await addSuggestions(f.sb, claude, DOC, { env: {} });
    const again = await addSuggestions(f.sb, claude, DOC, { env: {} });
    expect(calls).toHaveLength(2); // the second call only covers the one question that had no suggestion
    expect(again.asked).toBe(1);
    const q1 = f.db.invoice_questions.find((q) => q.id === "Q1")!;
    expect(q1.options.filter((o: any) => o.id.startsWith("suggest:"))).toHaveLength(1);
  });

  it("drops a low confidence answer", async () => {
    const f = setup();
    const { claude } = wise((ref, pick) => ({ ref, pick, confidence: 0.4, reason: "Maybe." }));
    expect((await addSuggestions(f.sb, claude, DOC, { env: {} })).suggested).toBe(0);
  });

  it("drops an answer that names a candidate that was not offered, a bad confidence, or a reason with a dash", async () => {
    const f = setup();
    let n = 0;
    const { claude } = wise((ref, pick) => {
      n++;
      if (n === 1) return { ref, pick: 99, confidence: 0.9, reason: "Same." }; // not offered
      if (n === 2) return { ref, pick, confidence: "high", reason: "Same." }; // not a number
      if (n === 3) return { ref, pick, confidence: 1.5, reason: "Same." }; // out of range
      if (n === 4) return { ref, pick, confidence: 0.9, reason: "Same product – same brand." }; // en dash
      if (n === 5) return { ref, pick, confidence: 0.9, reason: "x".repeat(400) }; // too long
      if (n === 6) return { ref, pick: 1.5, confidence: 0.9, reason: "Same." }; // not a whole number
      return { ref: "L99", pick, confidence: 0.9, reason: "Same." }; // a line that was never asked
    });
    const out = await addSuggestions(f.sb, claude, DOC, { env: {} });
    expect(out.suggested).toBe(0);
    expect(f.db.invoice_questions.every((q) => !q.options.some((o: any) => String(o.id).startsWith("suggest:")))).toBe(true);
  });

  it("an answer that is not JSON gives no suggestion and no error", async () => {
    const f = setup();
    const claude: ClaudeFn = async (a) => ({ text: "Sure! Here you go: vegan bun", usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0 }, costUsd: 0, model: a.model, stopReason: null });
    await expect(addSuggestions(f.sb, claude, DOC, { env: {} })).resolves.toMatchObject({ suggested: 0 });
  });

  it("with no key, or when the call fails, quietly adds nothing", async () => {
    const f = setup();
    const broken: ClaudeFn = async () => {
      throw new AiError("The invoice reader has no Anthropic key set.", "no_key");
    };
    await expect(addSuggestions(f.sb, broken, DOC, { env: {} })).resolves.toMatchObject({ suggested: 0 });
    expect(f.db.invoice_questions.every((q) => q.options.length === 2)).toBe(true);
  });

  it("never throws, even when the database read fails", async () => {
    const f = setup();
    f.failNext("invoice_questions", "select", "boom");
    await expect(addSuggestions(f.sb, wise().claude, DOC, { env: {} })).resolves.toEqual({ asked: 0, suggested: 0, skipped: 0 });
  });

  it("leaves a question that was answered in the meantime alone", async () => {
    const f = setup();
    const claude: ClaudeFn = async (a) => {
      f.db.invoice_questions.find((q) => q.id === "Q1")!.status = "answered"; // someone answered while the model thought
      return wise().claude(a);
    };
    await addSuggestions(f.sb, claude, DOC, { env: {} });
    expect(f.db.invoice_questions.find((q) => q.id === "Q1")!.options.some((o: any) => String(o.id).startsWith("suggest:"))).toBe(false);
  });

  it("splits a very long invoice into more than one call", async () => {
    const lines = Array.from({ length: 45 }, (_, i) => ({ id: `LL${i}`, document_id: "big", line_no: i + 1, item_code: String(i), description: "BACON MIDDLE 2.5kg", qty: 1, unit: "PKT", unit_price_ex: 5 }));
    const f = createFakeSupabase({
      invoice_documents: [{ id: "big", venue_id: 1, file_id: "f" }],
      invoice_lines: lines,
      invoice_questions: lines.map((l, i) => ({ id: `QQ${i}`, venue_id: 1, document_id: "big", line_id: l.id, kind: "unmatched_line", prompt: "x", status: "open", options: [] })),
      cost_ingredients: FIXTURE_INGREDIENTS.map((i) => ({ ...i })),
    });
    let calls = 0;
    const claude: ClaudeFn = async (a) => {
      calls++;
      return { text: JSON.stringify({ answers: [] }), usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0 }, costUsd: 0, model: a.model, stopReason: null };
    };
    await addSuggestions(f.sb, claude, "big", { env: {} });
    expect(calls).toBe(2);
  });
});

describe("parseReply and buildUserText", () => {
  const asked: AskLine[] = [{ ref: "L1", description: "BACON", code: null, unit: null, candidates: [{ number: 1, ingredientId: "i1", name: "Bacon" }, { number: 2, ingredientId: "i2", name: "Ham" }] }];
  it("accepts fenced JSON and maps the number to the ingredient", () => {
    const r = parseReply('```json\n{"answers":[{"ref":"L1","pick":2,"confidence":0.8,"reason":"It is ham."}]}\n```', asked);
    expect(r).toEqual([{ ref: "L1", ingredientId: "i2", confidence: 0.8, reason: "It is ham." }]);
  });
  it("ignores a repeated ref and anything that is not an object", () => {
    const r = parseReply('{"answers":[null,"x",{"ref":"L1","pick":1,"confidence":0.9,"reason":"Same."},{"ref":"L1","pick":2,"confidence":0.9,"reason":"Same."}]}', asked);
    expect(r.map((x) => x.ingredientId)).toEqual(["i1"]);
  });
  it("text built for the model carries no price and no code beyond the supplier's own", () => {
    const t = buildUserText([{ ...asked[0], code: "217452", unit: "PKT" }]);
    expect(t).toContain('L1: "BACON" (supplier code 217452) sold by the PKT');
    expect(t).toContain('1. "Bacon"');
  });
});
