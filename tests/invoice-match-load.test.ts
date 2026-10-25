import { describe, expect, it } from "vitest";
import { loadQuestionBundles } from "../lib/invoice-data-extra";
import { createFakeSupabase } from "./helpers/fake-supabase";

describe("loading the open match questions", () => {
  it("reads past the 1000 row limit a page at a time, and only the two match kinds", async () => {
    const qs: Record<string, any>[] = [];
    for (let i = 0; i < 1100; i++) qs.push({ id: `q${String(i).padStart(4, "0")}`, venue_id: 1, document_id: "d1", line_id: `l${i}`, kind: "unmatched_line", status: "open", options: [], created_at: "2026-10-25T00:00:00Z" });
    qs.push({ id: "other", venue_id: 1, document_id: "d1", line_id: "lx", kind: "unit_unclear", status: "open", options: [], created_at: "2026-10-25T00:00:00Z" });
    const f = createFakeSupabase({ invoice_questions: qs, invoice_documents: [], invoice_lines: [], invoice_suppliers: [] });
    const r = await loadQuestionBundles(f.sb, { status: "open", kinds: ["unmatched_line", "ambiguous_match"], pageAll: true });
    expect(r.bundles).toHaveLength(1100);
    expect(r.bundles.some((b) => b.q.id === "other")).toBe(false);
    // without pageAll the database's own limit applies, which is why the match screens ask for every page
    const unpaged = await loadQuestionBundles(f.sb, { status: "open" });
    expect(unpaged.bundles.length).toBe(1000);
  });
});
