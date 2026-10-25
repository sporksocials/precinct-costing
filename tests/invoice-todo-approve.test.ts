import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  approveSequentially,
  approveSummary,
  biggestChange,
  buildApproveRow,
  defaultSelection,
  fractionChange,
  groupBySupplier,
  isPriceLine,
  isStaleIngredient,
  loadApproveCounts,
  loadApprovePrices,
  lookCloselyText,
  outcomeText,
  overLimit,
  priceDiffers,
  settleBigChange,
  type ApproveDoc,
  type ApproveRow,
} from "@/lib/invoice-todo-approve";
import { answerLabel, checkSentence, isCheckQuestion, isSupplierDoubt, loadCheckTasks, totalsReason } from "@/lib/invoice-todo-checks";
import type { InvoiceLineRow, InvoiceQuestionRow, QuestionOption } from "@/lib/invoice-types";

/**
 * Approve Prices and Check These. Real examples from the first scans (Daniel Street Fish Market, Diablo Co), a fake client for the
 * loaders, and a scan of the screens' source for the rules Troy set: one price at a time, nothing that lists a confirmation.
 */

// ---------------------------------------------------------------- fixtures
const doc = (over: Partial<ApproveDoc> = {}): ApproveDoc => ({
  id: "d1",
  venue_id: 1,
  supplier_id: "s-daniel",
  supplier_name_read: "Daniel Street Fish Market",
  invoice_number: "51329",
  invoice_date: "2026-10-14",
  page_pdf_path: "drift/51329.pdf",
  status: "needs_review",
  reconciled: true,
  ...over,
});

let n = 0;
const line = (over: Partial<InvoiceLineRow> = {}): InvoiceLineRow =>
  ({
    id: `l${++n}`,
    document_id: "d1",
    venue_id: 1,
    invoice_date: "2026-10-14",
    line_no: n,
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
    ingredient_id: "ing-kingfish",
    product_id: null,
    packs_per_unit: 1,
    base_qty: 1.85,
    base_unit: "kg",
    fee_share_ex: 0,
    landed_total_ex: null,
    landed_unit_ex: null,
    landed_base_ex: null,
    old_pack_price: 68.9,
    new_pack_price: 72.35,
    old_product_price: null,
    new_product_price: null,
    change_pct: null,
    decision: "needs_approval",
    decision_reason: null,
    state: "open",
    ...over,
  }) as InvoiceLineRow;

const question = (over: Partial<InvoiceQuestionRow> & { options?: QuestionOption[] } = {}): InvoiceQuestionRow => ({
  id: `q${++n}`,
  venue_id: 1,
  document_id: "d1",
  line_id: null,
  kind: "totals_mismatch",
  prompt: "Invoice 51329 from Daniel Street Fish Market does not add up. HUMPTY DOO BARRAMUNDI FILLETS: 2.39 x $41.50 is $99.19 but the line says $98.98. No prices change until it is checked.",
  options: [],
  status: "open",
  answer: null,
  answered_by: null,
  answered_at: null,
  emailed_at: null,
  created_at: "2026-10-24T00:00:00Z",
  ...over,
});

// ---------------------------------------------------------------- a tiny fake client
type Reply = { data?: unknown[] | null; error?: { message: string; code?: string } | null };
type Q = { table: string; filters: [string, unknown][]; patch?: Record<string, unknown> };
function fake(tables: Record<string, Reply | ((q: Q) => Reply)>) {
  const calls: Q[] = [];
  const sb = {
    from(table: string) {
      const q: Q = { table, filters: [] };
      const run = (): Promise<Reply> => {
        calls.push({ ...q, filters: [...q.filters] });
        const r = tables[table];
        const reply = typeof r === "function" ? r(q) : (r ?? { data: [], error: { message: `relation "public.${table}" does not exist`, code: "42P01" } });
        return Promise.resolve({ data: reply.data ?? null, error: reply.error ?? null });
      };
      const b: Record<string, unknown> = {};
      for (const m of ["select", "order", "range", "limit"]) b[m] = () => b;
      b.eq = (c: string, v: unknown) => (q.filters.push([c, v]), b);
      b.in = (c: string, v: unknown) => (q.filters.push([c, v]), b);
      b.update = (patch: Record<string, unknown>) => ((q.patch = patch), b);
      b.then = (res: (v: Reply) => unknown, rej: (e: unknown) => unknown) => run().then(res, rej);
      return b;
    },
  };
  return { sb: sb as unknown as SupabaseClient, calls };
}

const row = (l: InvoiceLineRow, d: ApproveDoc = doc(), supplier = "Daniel Street Fish Market", limit = 0.05): ApproveRow => {
  const r = buildApproveRow(l, d, supplier, limit);
  if (!r) throw new Error("expected a row");
  return r;
};

// ---------------------------------------------------------------- the rules
describe("which lines are a price waiting", () => {
  it("lists a changed price", () => {
    expect(isPriceLine(line())).toBe(true);
  });
  it("never lists a confirmation: a price that already matches", () => {
    expect(isPriceLine(line({ decision: "same", new_pack_price: 68.9 }))).toBe(false);
    expect(isPriceLine(line({ decision: "needs_approval", new_pack_price: 68.9 }))).toBe(false);
    // less than half a cent is the same price
    expect(isPriceLine(line({ new_pack_price: 68.9004 }))).toBe(false);
  });
  it("skips lines that are not open product lines", () => {
    expect(isPriceLine(line({ state: "applied" }))).toBe(false);
    expect(isPriceLine(line({ state: "approved_skip" }))).toBe(false);
    expect(isPriceLine(line({ line_class: "delivery" }))).toBe(false);
    expect(isPriceLine(line({ decision: "none" }))).toBe(false);
    expect(isPriceLine(line({ decision: "skip" }))).toBe(false);
  });
  it("needs a target: an ingredient or an ordering product with a changed price", () => {
    expect(isPriceLine(line({ ingredient_id: null, product_id: null }))).toBe(false);
    expect(isPriceLine(line({ ingredient_id: null, product_id: "p1", old_pack_price: null, new_pack_price: null, old_product_price: 62, new_product_price: 63 }))).toBe(true);
  });
  it("never lists a line on a duplicate, failed or set aside invoice", () => {
    for (const status of ["duplicate", "failed", "ignored"] as const) expect(buildApproveRow(line(), doc({ status }), "S", 0.05)).toBeNull();
    expect(buildApproveRow(line(), doc({ status: "partly_applied" }), "S", 0.05)).not.toBeNull();
  });
});

describe("price maths", () => {
  it("measures a change against the earlier price", () => {
    expect(fractionChange(68.9, 72.35)).toBeCloseTo(0.0501, 4);
    expect(fractionChange(null, 5)).toBeNull();
    expect(fractionChange(0, 5)).toBeNull();
    expect(priceDiffers(null, 5)).toBe(true);
    expect(priceDiffers(5, null)).toBe(false);
  });
  it("reads exactly the limit as over it (5.0% is 5%)", () => {
    expect(overLimit(0.05, 0.05)).toBe(true);
    expect(overLimit(0.04999999, 0.05)).toBe(true); // float noise on a true 5%
    expect(overLimit(0.0499, 0.05)).toBe(false);
    expect(overLimit(-0.07, 0.05)).toBe(true);
    expect(overLimit(null, 0.05)).toBe(false);
  });
});

describe("rows and what needs a closer look", () => {
  it("flags a change of 5% or more as Big Change, up or down", () => {
    expect(row(line()).flag).toBe("big"); // 68.90 to 72.35
    expect(row(line({ new_pack_price: 64.5 })).flag).toBe("big"); // down 6.4%
  });
  it("leaves a small change unflagged and ticked", () => {
    const r = row(line({ old_pack_price: 10, new_pack_price: 10.3 }));
    expect(r.flag).toBeNull();
    expect(r.pct).toBeCloseTo(0.03);
    expect(r.dollars).toBe(0.3);
  });
  it("flags a line with no earlier price, and a line on an invoice that does not add up", () => {
    expect(row(line({ old_pack_price: null, new_pack_price: 9 })).flag).toBe("no_price");
    expect(row(line({ old_pack_price: 10, new_pack_price: 10.2 }), doc({ reconciled: false })).flag).toBe("unbalanced");
  });
  it("tests the limit against the larger of the ingredient and ordering moves", () => {
    const l = line({ old_pack_price: 10, new_pack_price: 10.1, product_id: "p1", old_product_price: 62, new_product_price: 70 });
    const r = row(l);
    expect(r.flag).toBe("big");
    expect(r.target).toBe("ingredient");
    expect(r.other?.newPrice).toBe(70);
  });
  it("shows the ordering price when only it changes", () => {
    const r = row(line({ old_pack_price: 5, new_pack_price: 5, product_id: "p1", old_product_price: 62, new_product_price: 63 }));
    expect(r.target).toBe("product");
    expect(r.newPrice).toBe(63);
  });
  it("sorts the big ones first, biggest first, then the rest A to Z", () => {
    const a = row(line({ description: "Zucchini", old_pack_price: 10, new_pack_price: 10.1 }));
    const b = row(line({ description: "Apple", old_pack_price: 10, new_pack_price: 10.2 }));
    const c = row(line({ description: "Lychee Liqueur 700ml", old_pack_price: 36, new_pack_price: 38.62 }));
    const d = row(line({ description: "Kingfish", old_pack_price: 68.9, new_pack_price: 80 }));
    const [g] = groupBySupplier([a, b, c, d]);
    expect(g.rows.map((r) => r.line.description)).toEqual(["Kingfish", "Lychee Liqueur 700ml", "Apple", "Zucchini"]);
    expect(g.flagged).toBe(2);
    expect(g.easy.map((r) => r.line.description)).toEqual(["Apple", "Zucchini"]);
  });
  it("puts suppliers with something to look at first", () => {
    const quiet = row(line({ old_pack_price: 10, new_pack_price: 10.1 }), doc({ supplier_id: "s-a" }), "Alpha Foods");
    const loud = row(line(), doc({ supplier_id: "s-z" }), "Zeta Fish");
    expect(groupBySupplier([quiet, loud]).map((g) => g.name)).toEqual(["Zeta Fish", "Alpha Foods"]);
  });
  it("ticks everything ordinary and nothing that needs a look (or that the app has moved on from)", () => {
    const small = row(line({ old_pack_price: 10, new_pack_price: 10.1 }));
    const big = row(line());
    expect(defaultSelection([small, big])).toEqual(new Set([small.line.id]));
    expect(defaultSelection([small, big], (r) => r === small).size).toBe(0);
  });
  it("sees a moved app price as stale", () => {
    const r = row(line());
    expect(isStaleIngredient(r, 68.9)).toBe(false);
    expect(isStaleIngredient(r, 70)).toBe(true);
    expect(isStaleIngredient(r, undefined)).toBe(false);
  });
  it("finds the biggest change for the confirm sheet", () => {
    const rows = [row(line({ old_pack_price: 10, new_pack_price: 10.1 })), row(line({ old_pack_price: 36, new_pack_price: 38.62 })), row(line({ old_pack_price: 5, new_pack_price: 4.9 }))];
    expect(biggestChange(rows)?.newPrice).toBe(38.62);
  });
});

describe("words", () => {
  const small = () => row(line({ old_pack_price: 10, new_pack_price: 10.1 }));
  const big = () => row(line());
  it("summarises in one plain sentence", () => {
    const rows = [...Array.from({ length: 41 }, small), ...Array.from({ length: 5 }, big)];
    expect(approveSummary(rows, 0.05)).toBe("46 prices changed since the last invoices. 41 are under 5%.");
    expect(approveSummary([small()], 0.05)).toBe("1 price changed since the last invoices. It is under 5%.");
    expect(approveSummary([small(), small()], 0.05)).toBe("2 prices changed since the last invoices. All are under 5%.");
    expect(approveSummary([big(), big()], 0.05)).toBe("2 prices changed since the last invoices. All are 5% or more.");
    expect(approveSummary([], 0.05)).toBe("No prices are waiting.");
  });
  it("warns about the big ones in plain words", () => {
    expect(lookCloselyText([...Array.from({ length: 5 }, big), small()], 0.05)).toBe("These 5 changed by 5% or more. Check them before approving.");
    expect(lookCloselyText([big()], 0.05)).toBe("This 1 price changed by 5% or more. Check it before approving.");
    expect(lookCloselyText([small()], 0.05)).toBeNull();
  });
  it("reports what happened", () => {
    const ok = Array.from({ length: 41 }, small);
    expect(outcomeText({ done: ok, failed: [] }, 5)).toBe("Updated 41 prices. 5 left to check. Undo is on each item's price history.");
    expect(outcomeText({ done: [], failed: [{ row: small(), message: "x" }] }, 0)).toBe("No prices were updated. 1 price could not be updated.");
  });
  it("has no dashes in the words a person reads", () => {
    const words = [approveSummary([small(), big()], 0.05), lookCloselyText([big()], 0.05) ?? "", outcomeText({ done: [small()], failed: [] }, 2)];
    for (const w of words) expect(w).not.toMatch(/[–—]/);
  });
});

// ---------------------------------------------------------------- approving
describe("approveSequentially", () => {
  it("applies ONE line at a time, in order, and reports progress", async () => {
    const rows = [row(line()), row(line()), row(line())];
    let running = 0;
    let peak = 0;
    const order: string[] = [];
    const apply = vi.fn(async (_sb: unknown, a: { lineId: string; actor: string; mode: string }) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 5));
      order.push(a.lineId);
      running--;
      return { lineId: a.lineId, ok: true, message: "", changeIds: ["c"] };
    });
    const progress: number[] = [];
    const settle = vi.fn(async () => undefined);
    const out = await approveSequentially({} as SupabaseClient, rows, "troy@x.com", { apply: apply as never, settle, onProgress: (d) => progress.push(d) });
    expect(peak).toBe(1);
    expect(order).toEqual(rows.map((r) => r.line.id));
    expect(progress).toEqual([1, 2, 3]);
    expect(out.done).toHaveLength(3);
    expect(apply.mock.calls.every((c) => c[1].mode === "approved" && c[1].actor === "troy@x.com")).toBe(true);
    expect(settle).toHaveBeenCalledTimes(3);
  });
  it("keeps going after a failure and lists it with its plain message", async () => {
    const rows = [row(line()), row(line()), row(line())];
    const apply = vi.fn(async (_sb: unknown, a: { lineId: string }) =>
      a.lineId === rows[1].line.id ? { lineId: a.lineId, ok: false, message: "The price of Kingfish changed since this invoice was read.", changeIds: [] } : { lineId: a.lineId, ok: true, message: "", changeIds: ["c"] },
    );
    const settle = vi.fn(async () => undefined);
    const out = await approveSequentially({} as SupabaseClient, rows, "a", { apply: apply as never, settle });
    expect(out.done.map((r) => r.line.id)).toEqual([rows[0].line.id, rows[2].line.id]);
    expect(out.failed).toHaveLength(1);
    expect(out.failed[0].message).toContain("changed since this invoice was read");
    expect(settle).toHaveBeenCalledTimes(2); // a failed line does not settle its question
  });
  it("turns a thrown error into a failure instead of stopping", async () => {
    const rows = [row(line()), row(line())];
    const apply = vi.fn(async (_sb: unknown, a: { lineId: string }) => {
      if (a.lineId === rows[0].line.id) throw new Error("network down");
      return { lineId: a.lineId, ok: true, message: "", changeIds: ["c"] };
    });
    const out = await approveSequentially({} as SupabaseClient, rows, "a", { apply: apply as never, settle: async () => undefined });
    expect(out.failed[0].message).toBe("network down");
    expect(out.done).toHaveLength(1);
  });
});

describe("settleBigChange", () => {
  it("answers the line's open big_change question and nothing else", async () => {
    const { sb, calls } = fake({ invoice_questions: { data: [] } });
    await settleBigChange(sb, "line-1", "approve_change", "troy@x.com");
    const c = calls[0];
    expect(c.table).toBe("invoice_questions");
    expect(c.patch).toMatchObject({ status: "answered", answer: { option_id: "approve_change" }, answered_by: "troy@x.com" });
    expect(c.filters).toEqual([["line_id", "line-1"], ["kind", "big_change"], ["status", "open"]]);
  });
  it("never throws", async () => {
    const sb = { from: () => { throw new Error("boom"); } } as unknown as SupabaseClient;
    await expect(settleBigChange(sb, "l", "reject_change", "a")).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------- the loaders and the counts
const SETTINGS = { cost_settings: { data: [{ key: "invoice_auto_apply_pct", value: "0.05" }] } };
function world() {
  n = 0;
  const lines = [
    line({ id: "kingfish", description: "Kingfish fillets", old_pack_price: 68.9, new_pack_price: 72.35 }), // big
    line({ id: "barra", description: "Barramundi", old_pack_price: 41.54, new_pack_price: 41.54 }), // same: not listed
    line({ id: "lychee", document_id: "d2", description: "Lychee Liqueur 700ml", old_pack_price: 36, new_pack_price: 36.6 }), // 1.7%
    line({ id: "dupe", document_id: "d3", description: "On a duplicate" }), // duplicate doc
    line({ id: "conf", decision: "same", old_pack_price: 5, new_pack_price: 5 }),
    line({ id: "applied", state: "applied" }),
  ];
  const docs = [
    doc({ id: "d1" }),
    doc({ id: "d2", supplier_id: "s-diablo", supplier_name_read: "CD Australia Pty Ltd trading as Diablo Co", invoice_number: "ENV-34730" }),
    doc({ id: "d3", status: "duplicate" }),
    doc({ id: "d4", status: "needs_review" }),
    doc({ id: "d5", status: "ignored" }),
  ];
  const questions = [
    question({ id: "q-totals", document_id: "d1", kind: "totals_mismatch", options: [{ id: "reread", label: "Read the invoice again", action: "reread" }, { id: "ignore_document", label: "Ignore this invoice", action: "ignore_document" }] }),
    question({ id: "q-unit", document_id: "d2", line_id: "lychee", kind: "unit_unclear", prompt: "Diablo sells 'Lychee Liqueur 700ml' by the bottle. How many of Lychee Liqueur are in one bottle?", options: [{ id: "packs:1", label: "1 per bottle", packs_per_unit: 1 }, { id: "ignore_line", label: "Ignore this line", action: "ignore_line" }] }),
    question({ id: "q-big", document_id: "d1", line_id: "kingfish", kind: "big_change", options: [{ id: "approve_change", label: "Yes", action: "approve_change" }] }),
    question({ id: "q-venue", document_id: "d1", kind: "venue_mismatch" }),
    question({ id: "q-match", document_id: "d1", line_id: "barra", kind: "unmatched_line" }),
    question({ id: "q-legacy", document_id: "d1", kind: "new_supplier", options: [{ id: "add_supplier", label: "Yes, add them as a new supplier" }, { id: "ignore_document", label: "Ignore" }] }),
    question({ id: "q-abn", document_id: "d2", kind: "new_supplier", prompt: "The invoice says Diablo Co with ABN 1, but we have that supplier with ABN 2. Is it the same supplier?", options: [{ id: "same_supplier", label: "Yes" }, { id: "add_supplier", label: "No" }] }),
    question({ id: "q-dup", document_id: "d3", kind: "totals_mismatch" }),
    question({ id: "q-ign", document_id: "d5", kind: "other", prompt: "x" }),
  ];
  const tables = {
    invoice_lines: (q: Q) => {
      const ids = q.filters.find(([c]) => c === "id")?.[1] as string[] | undefined;
      return { data: ids ? lines.filter((l) => ids.includes(l.id)) : lines };
    },
    invoice_documents: (q: Q) => {
      const ids = (q.filters.find(([c]) => c === "id")?.[1] as string[] | undefined) ?? [];
      return { data: docs.filter((d) => ids.includes(d.id)) };
    },
    invoice_suppliers: (q: Q) => {
      const ids = (q.filters.find(([c]) => c === "id")?.[1] as string[] | undefined) ?? [];
      return { data: [{ id: "s-daniel", name: "Daniel Street Fish Market" }, { id: "s-diablo", name: "Diablo Co" }].filter((s) => ids.includes(s.id)) };
    },
    invoice_questions: { data: questions },
    ...SETTINGS,
  };
  return { tables, lines, docs, questions };
}

describe("loadApprovePrices", () => {
  it("lists only real changes on live invoices and reads the limit", async () => {
    const { tables } = world();
    const { sb } = fake(tables);
    const load = await loadApprovePrices(sb, null);
    expect(load.missing).toBe(false);
    expect(load.limit).toBe(0.05);
    expect(load.rows.map((r) => r.line.id).sort()).toEqual(["kingfish", "lychee"]);
    expect(load.rows.find((r) => r.line.id === "lychee")?.supplierName).toBe("Diablo Co");
  });
  it("asks for one venue only when told to", async () => {
    const { tables } = world();
    const { sb, calls } = fake(tables);
    await loadApprovePrices(sb, 2);
    expect(calls.find((c) => c.table === "invoice_lines")?.filters).toContainEqual(["venue_id", 2]);
    const second = fake(tables);
    await loadApprovePrices(second.sb, null);
    expect(second.calls.find((c) => c.table === "invoice_lines")?.filters.some(([c]) => c === "venue_id")).toBe(false);
  });
  it("says missing when the tables are not there, and throws on a real failure", async () => {
    const { sb } = fake({});
    expect((await loadApprovePrices(sb, null)).missing).toBe(true);
    const bad = fake({ invoice_lines: { error: { message: "permission denied" } } });
    await expect(loadApprovePrices(bad.sb, null)).rejects.toThrow("permission denied");
  });
  it("falls back to the default limit when the setting is missing", async () => {
    const { tables } = world();
    const { sb } = fake({ ...tables, cost_settings: { data: [] } });
    expect((await loadApprovePrices(sb, null)).limit).toBe(0.05);
  });
});

describe("loadCheckTasks", () => {
  it("keeps the odd ones and drops matching, big changes, venue, the old new-supplier question, and dead invoices", async () => {
    const { tables } = world();
    const { sb } = fake(tables);
    const load = await loadCheckTasks(sb, null);
    expect(load.tasks.map((t) => t.q.id).sort()).toEqual(["q-abn", "q-totals", "q-unit"]);
  });
  it("gives each a plain sentence", async () => {
    const { tables } = world();
    const { sb } = fake(tables);
    const byId = new Map((await loadCheckTasks(sb, null)).tasks.map((t) => [t.q.id, t]));
    expect(byId.get("q-totals")?.sentence).toBe("The totals do not add up.");
    expect(byId.get("q-totals")?.detail).toContain("HUMPTY DOO BARRAMUNDI FILLETS");
    expect(byId.get("q-totals")?.detail).not.toContain("No prices change");
    expect(byId.get("q-unit")?.sentence).toBe("Pack size is unclear for Lychee Liqueur 700ml.");
    expect(byId.get("q-abn")?.sentence).toBe("The supplier's ABN does not match the one we have.");
  });
  it("is missing when the table is not there", async () => {
    const { sb } = fake({});
    expect((await loadCheckTasks(sb, null)).missing).toBe(true);
  });
});

describe("the counts equal the lists", () => {
  it("prices equals the rows of Approve Prices and checks equals the tasks of Check These", async () => {
    const { tables } = world();
    const { sb } = fake(tables);
    const counts = await loadApproveCounts(sb, null);
    const prices = await loadApprovePrices(fake(tables).sb, null);
    const checks = await loadCheckTasks(fake(tables).sb, null);
    expect(counts).toEqual({ prices: prices.rows.length, checks: checks.tasks.length });
    expect(counts).toEqual({ prices: 2, checks: 3 });
  });
  it("is null (never a throw) when the tables are missing or a read fails", async () => {
    expect(await loadApproveCounts(fake({}).sb, null)).toBeNull();
    expect(await loadApproveCounts(fake({ invoice_lines: { error: { message: "down" } }, invoice_questions: { data: [] } }).sb, null)).toBeNull();
  });
  it("a booked-in approval takes a price off the count", async () => {
    const { tables, lines } = world();
    expect((await loadApproveCounts(fake(tables).sb, null))?.prices).toBe(2);
    lines.find((l) => l.id === "kingfish")!.state = "applied";
    expect((await loadApproveCounts(fake(tables).sb, null))?.prices).toBe(1);
  });
});

// ---------------------------------------------------------------- the check wording
describe("Check These rules", () => {
  it("shows a supplier question only when there is a real doubt", () => {
    expect(isSupplierDoubt({ kind: "new_supplier", options: [{ id: "add_supplier", label: "Yes" }, { id: "ignore_document", label: "x" }] })).toBe(false);
    expect(isSupplierDoubt({ kind: "new_supplier", options: [{ id: "supplier:abc", label: "Bidfood" }, { id: "add_supplier", label: "x" }] })).toBe(true);
    expect(isSupplierDoubt({ kind: "new_supplier", options: [{ id: "reread", label: "x" }] })).toBe(true);
  });
  it("keeps big_change, venue_mismatch and matching out", () => {
    for (const kind of ["big_change", "venue_mismatch", "unmatched_line", "ambiguous_match"] as const) expect(isCheckQuestion({ kind, options: [], status: "open" })).toBe(false);
    for (const kind of ["unit_unclear", "totals_mismatch", "credit_unclear", "other"] as const) expect(isCheckQuestion({ kind, options: [], status: "open" })).toBe(true);
    expect(isCheckQuestion({ kind: "totals_mismatch", options: [], status: "answered" })).toBe(false);
  });
  it("cuts the reason out of a totals question", () => {
    expect(totalsReason("Invoice 1 from X does not add up. Carrot Grated Kg: no price or total could be read. No prices change until it is checked.")).toBe("Carrot Grated Kg: no price or total could be read.");
    expect(totalsReason("Invoice 1 from X does not add up. No prices change until it is checked.")).toBeNull();
  });
  it("words the sentences for the other kinds", () => {
    expect(checkSentence({ kind: "credit_unclear", prompt: "The Barramundi line was credited $16.45. How many kilos were credited?", options: [] }, null).sentence).toBe("A credit on this invoice needs a look.");
    expect(checkSentence({ kind: "other", prompt: "Daniel Street charged $6.50 for 'Delivery'. Should that be spread?", options: [] }, null)).toEqual({ sentence: "Daniel Street charged $6.50 for 'Delivery'. Should that be spread?", detail: null });
    expect(checkSentence({ kind: "unit_unclear", prompt: "p", options: [] }, { description: "KINGFISH FILLETS PER KG" }).sentence).toBe("Pack size is unclear for Kingfish Fillets.");
  });
  it("gives the engine's buttons plain Title Case labels", () => {
    expect(answerLabel({ id: "reread", label: "Read the invoice again" })).toBe("Read It Again");
    expect(answerLabel({ id: "ignore_document", label: "Ignore this invoice" })).toBe("Set This Invoice Aside");
    expect(answerLabel({ id: "supplier:1", label: "Bidfood Sunshine Coast" })).toBe("Bidfood Sunshine Coast");
    for (const l of ["Read It Again", "Set This Invoice Aside", "Leave It", "Spread It Over The Products"]) expect(l).not.toMatch(/[–—]/);
  });
});

// ---------------------------------------------------------------- source rules
const src = (p: string) => readFileSync(path.join(process.cwd(), p), "utf8");
describe("source rules", () => {
  const files = ["components/invoices/approve-screen.tsx", "components/invoices/approve-row.tsx", "components/invoices/approve-confirm.tsx", "components/invoices/check-card.tsx", "components/invoices/check-screen.tsx", "components/invoices/todo-approve.tsx", "components/invoices/todo-checks.tsx", "lib/invoice-todo-approve.ts", "lib/invoice-todo-checks.ts"];
  it("never approves all at once, never writes a price, never inserts", () => {
    const all = files.map(src).join("\n");
    expect(all).not.toMatch(/Promise\.all\(\s*[^)]*applyLine/);
    expect(all).not.toMatch(/\.insert\(/);
    expect(all).not.toMatch(/pack_price\s*:/);
    expect(src("lib/invoice-todo-approve.ts")).toContain("applyLine");
    expect(src("components/invoices/approve-screen.tsx")).toContain("approveSequentially");
  });
  it("uses no em or en dashes in the words on screen", () => {
    for (const f of files) {
      const text = src(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      expect(text, f).not.toMatch(/[–—]/);
    }
  });
  it("keeps every tap target at 44px or more at every width", () => {
    for (const f of files.filter((x) => x.endsWith(".tsx"))) expect(src(f), f).not.toMatch(/\b(?:sm|md|lg|xl):(?:min-)?h-\[?(?:[0-3]?\d)(?:px|\b)\]?/);
  });
});
