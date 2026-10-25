import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadInvoiceDetail, loadInvoiceHome, loadInvoiceList, readDoc, readLine, skipLine, unskipLine } from "@/lib/invoice-data";

/**
 * The Home card, the Invoices list and the invoice page (agent E1). Two parts: the data layer against a fake Supabase client
 * (tables that do not exist yet, errors, empty tables), and a scan of the screens' source for the rules Troy set: nothing here
 * deletes, nothing writes a price or a sell price, and every price change goes through lib/invoice-apply.
 */

// ---------------------------------------------------------------- a tiny fake client
type Reply = { data?: unknown[] | null; error?: { message: string; code?: string } | null; count?: number | null };
type Tables = Record<string, Reply | ((q: Q) => Reply)>;
interface Q {
  table: string;
  filters: [string, unknown][];
  patch?: Record<string, unknown>;
}

function fake(tables: Tables, opts: { signed?: string | null | "throw" } = {}) {
  const calls: Q[] = [];
  const sb = {
    from(table: string) {
      const q: Q = { table, filters: [] };
      const run = (): Promise<Reply> => {
        calls.push({ ...q, filters: [...q.filters] });
        const r = tables[table];
        const reply = typeof r === "function" ? r(q) : (r ?? { data: [], error: { message: `relation "public.${table}" does not exist`, code: "42P01" } });
        return Promise.resolve({ data: reply.data ?? null, error: reply.error ?? null, count: reply.count ?? null });
      };
      const b: Record<string, unknown> = {};
      for (const m of ["select", "order", "range", "limit", "gte"]) b[m] = () => b;
      b.eq = (c: string, v: unknown) => (q.filters.push([c, v]), b);
      b.in = (c: string, v: unknown) => (q.filters.push([c, v]), b);
      b.update = (patch: Record<string, unknown>) => ((q.patch = patch), b);
      b.then = (res: (v: Reply) => unknown, rej: (e: unknown) => unknown) => run().then(res, rej);
      return b;
    },
    storage: {
      from: () => ({
        createSignedUrl: async () => {
          if (opts.signed === "throw") throw new Error("storage down");
          return opts.signed ? { data: { signedUrl: opts.signed }, error: null } : { data: null, error: { message: "not found" } };
        },
      }),
    },
  };
  return { sb: sb as unknown as SupabaseClient, calls };
}

const missing = { data: null, error: { message: 'relation "public.x" does not exist', code: "42P01" } };

describe("Home data", () => {
  it("hides the card (null) when the invoice tables are not in the database yet", async () => {
    const { sb } = fake({});
    expect(await loadInvoiceHome(sb, "2026-10-24")).toBeNull();
  });
  it("hides the card on any other failure too: no network, no permission", async () => {
    const { sb } = fake({ invoice_documents: { data: null, error: { message: "Failed to fetch" } }, invoice_price_changes: { data: [] }, invoice_questions: { data: [] }, invoice_lines: { data: [] } });
    expect(await loadInvoiceHome(sb, "2026-10-24")).toBeNull();
    const boom = { from: () => { throw new Error("offline"); } } as unknown as SupabaseClient;
    expect(await loadInvoiceHome(boom, "2026-10-24")).toBeNull();
  });
  it("empty tables mean no data yet, not an error", () => {
    return (async () => {
      const { sb } = fake({ invoice_documents: { data: [], count: 0 }, invoice_price_changes: { data: [] } });
      const d = await loadInvoiceHome(sb, "2026-10-24");
      expect(d).toEqual({ docs: [], changes: [], totalDocs: 0 });
    })();
  });
  it("does not read what waits on a person: the card uses the same count hooks as the page", async () => {
    const { sb, calls } = fake({ invoice_documents: { data: [{ id: "d1", status: "needs_review", created_at: "2026-10-21T01:00:00Z" }], count: 4 }, invoice_price_changes: { data: [] } });
    const d = await loadInvoiceHome(sb, "2026-10-24");
    expect(d?.totalDocs).toBe(4);
    expect(calls.map((c) => c.table).sort()).toEqual(["invoice_documents", "invoice_documents", "invoice_price_changes"]);
  });
});

describe("List and detail data", () => {
  it("the list says missing instead of throwing before the migration", async () => {
    const { sb } = fake({});
    const l = await loadInvoiceList(sb);
    expect(l.missing).toBe(true);
    expect(l.documents).toEqual([]);
  });
  it("the list carries the slim line columns and open question kinds the outcome words need", async () => {
    const { sb, calls } = fake({
      invoice_documents: { data: [{ id: "d1", venue_id: 1, total_inc: "216.5" }] },
      invoice_suppliers: { data: [{ id: "s1", name: "Daniel Street Fish Market" }] },
      invoice_lines: { data: [{ document_id: "d1", line_class: "product", match_state: "unmatched", decision: "none", state: "open" }] },
      invoice_questions: { data: [{ id: "q1", document_id: "d1", kind: "totals_mismatch" }] },
      invoice_price_changes: { data: [] },
    });
    const l = await loadInvoiceList(sb);
    expect(l.lines).toHaveLength(1);
    expect(l.questions).toEqual([{ id: "q1", document_id: "d1", kind: "totals_mismatch" }]);
    expect(calls.find((c) => c.table === "invoice_questions")?.filters).toContainEqual(["status", "open"]);
  });
  it("the list rethrows a real failure so the screen can say so", async () => {
    const { sb } = fake({ invoice_documents: { data: null, error: { message: "permission denied for table invoice_documents", code: "42501" } }, invoice_suppliers: { data: [] }, invoice_questions: { data: [] }, invoice_lines: { data: [] }, invoice_price_changes: { data: [] } });
    await expect(loadInvoiceList(sb)).rejects.toThrow(/permission denied/);
  });
  it("reads numbers that arrive as text", () => {
    const d = readDoc({ id: "d", total_inc: "216.50", fee_pool_ex: "5.9100", subtotal_ex: null, recon_notes: null, pages: null });
    expect(d.total_inc).toBe(216.5);
    expect(d.fee_pool_ex).toBe(5.91);
    expect(d.subtotal_ex).toBeNull();
    expect(d.recon_notes).toEqual([]);
    expect(d.pages).toEqual([]);
    const l = readLine({ id: "l", landed_unit_ex: "70.8432", fee_share_ex: null, change_pct: "0.0284" });
    expect(l.landed_unit_ex).toBe(70.8432);
    expect(l.fee_share_ex).toBe(0);
    expect(l.change_pct).toBe(0.0284);
  });
  it("an unknown invoice id is not found, not an error", async () => {
    const { sb } = fake({ invoice_documents: { data: [] } });
    const d = await loadInvoiceDetail(sb, "nope");
    expect(d.doc).toBeNull();
    expect(d.missing).toBe(false);
  });
  it("loads the document with its lines, and a failed PDF link just means no PDF", async () => {
    const tables: Tables = {
      invoice_documents: { data: [{ id: "d1", venue_id: 1, supplier_id: "s1", page_pdf_path: "f/d1.pdf", total_inc: "216.5", fee_pool_ex: 5.91, recon_notes: [], pages: [1] }] },
      invoice_lines: { data: [{ id: "l1", document_id: "d1", line_no: 1, line_class: "product", product_id: null }] },
      invoice_price_changes: { data: [] },
      invoice_questions: { data: [] },
      invoice_charge_rules: { data: [] },
      invoice_suppliers: { data: [{ id: "s1", name: "Daniel Street Fish Market" }] },
      ordering_products: { data: [] },
    };
    const ok = await loadInvoiceDetail(fake(tables, { signed: "https://signed.example/d1.pdf" }).sb, "d1");
    expect(ok.supplierName).toBe("Daniel Street Fish Market");
    expect(ok.lines).toHaveLength(1);
    expect(ok.pdfUrl).toBe("https://signed.example/d1.pdf");
    expect((await loadInvoiceDetail(fake(tables, { signed: null }).sb, "d1")).pdfUrl).toBeNull();
    expect((await loadInvoiceDetail(fake(tables, { signed: "throw" }).sb, "d1")).pdfUrl).toBeNull();
  });
  it("the detail asks for the signed link with the invoice-pdfs bucket", () => {
    expect(readFileSync("lib/invoice-data.ts", "utf8")).toMatch(/storage\.from\("invoice-pdfs"\)\.createSignedUrl\(path, 600\)/);
  });
});

describe("Skip is a plain, guarded state update", () => {
  it("skips an open line and says so", async () => {
    const { sb, calls } = fake({ invoice_lines: { data: [{ id: "l1" }] } });
    const r = await skipLine(sb, "l1");
    expect(r.ok).toBe(true);
    expect(calls[0].patch).toEqual({ state: "approved_skip" });
    expect(calls[0].filters).toEqual([["id", "l1"], ["state", "open"]]);
  });
  it("does nothing when someone else got there first", async () => {
    const { sb } = fake({ invoice_lines: { data: [] } });
    const r = await skipLine(sb, "l1");
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/already/);
  });
  it("reports a failed save in plain words", async () => {
    const { sb } = fake({ invoice_lines: { data: null, error: { message: "boom" } } });
    const r = await skipLine(sb, "l1");
    expect(r.ok).toBe(false);
    expect(r.message).not.toContain("boom");
  });
  it("Undo Skip puts a skipped line back to open", async () => {
    const { sb, calls } = fake({ invoice_lines: { data: [{ id: "l1" }] } });
    expect((await unskipLine(sb, "l1")).ok).toBe(true);
    expect(calls[0].patch).toEqual({ state: "open" });
    expect(calls[0].filters).toContainEqual(["state", "approved_skip"]);
  });
});

// ---------------------------------------------------------------- source scan
const MY_FILES = [
  "lib/invoice-data.ts",
  "lib/invoice-view.ts",
  path.join("app", "(app)", "invoices", "page.tsx"),
  path.join("app", "(app)", "invoices", "[id]", "page.tsx"),
  ...readdirSync("components/invoices")
    .filter((f) => /^(inv-.*|home-card)\.tsx$/.test(f))
    .map((f) => path.join("components/invoices", f)),
];
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
const src = (f: string) => strip(readFileSync(f, "utf8"));

describe("the invoice screens obey Troy's rules", () => {
  it("covers the files it should", () => {
    expect(MY_FILES.length).toBeGreaterThanOrEqual(11);
    for (const f of ["inv-list.tsx", "inv-all.tsx", "inv-changes.tsx", "inv-detail.tsx", "inv-line.tsx", "inv-undo.tsx", "home-card.tsx"]) expect(MY_FILES.some((x) => x.endsWith(f)), f).toBe(true);
    expect(MY_FILES.some((x) => x.endsWith("inv-tabs.tsx"))).toBe(false);
  });
  it("never deletes anything", () => {
    for (const f of MY_FILES) expect(src(f), f).not.toMatch(/\.delete\(/);
  });
  it("never touches a sell price or writes to ingredients, products or the price logs", () => {
    for (const f of MY_FILES) {
      const s = src(f);
      expect(s, f).not.toMatch(/sell_price|cost_sell|happy_hour|cost_menu_items|cost_beer|cost_gelato/);
      expect(s, f).not.toMatch(/from\("(cost_ingredients|ordering_products|cost_price_log|ordering_price_log|invoice_price_changes)"\)\s*\.\s*(update|insert|upsert)/);
      expect(s, f).not.toMatch(/\.(insert|upsert)\(/);
    }
  });
  it("the only write the screens make themselves is the line state, in the data layer", () => {
    for (const f of MY_FILES) {
      const hits = [...src(f).matchAll(/\.update\(/g)].length;
      if (f.endsWith("invoice-data.ts")) expect(hits).toBe(1);
      else expect(hits, f).toBe(0);
    }
    expect(src("lib/invoice-data.ts")).toMatch(/from\("invoice_lines"\)\.update\(\{ state: to \}\)/);
  });
  it("prices change only through applyLine, undoChange and undoDocument", () => {
    expect(src("components/invoices/inv-detail.tsx")).toMatch(/import \{ applyLine \} from "@\/lib\/invoice-apply"/);
    expect(src("components/invoices/inv-detail.tsx")).toMatch(/applyLine\(getSupabaseBrowser\(\), \{ lineId: line\.id, actor: userEmail \?\? "unknown", mode: "approved" \}\)/);
    expect(src("components/invoices/inv-undo.tsx")).toMatch(/import \{ undoChange, undoDocument \} from "@\/lib\/invoice-apply"/);
    expect(src("components/invoices/inv-undo.tsx")).toMatch(/undoChange\(getSupabaseBrowser\(\)/);
    expect(src("components/invoices/inv-undo.tsx")).toMatch(/undoDocument\(getSupabaseBrowser\(\)/);
    // Approve is never an automatic mode from a screen
    for (const f of MY_FILES) expect(src(f), f).not.toMatch(/mode: "auto"/);
  });
  it("the approve sheet says why the person is being asked, and warns when the invoice does not add up", () => {
    const s = src("components/invoices/inv-detail.tsx");
    expect(s).toMatch(/reconciled=\{doc\.reconciled\}/);
    expect(s).toContain("{decisionText(line)}");
    expect(s).toContain("Why you are being asked: ");
    expect(s).toContain("This invoice does not add up. Check the invoice before you approve.");
    // the warning has an icon and a word (not colour alone) and shows only for an unreconciled document
    expect(s).toMatch(/\{reconciled \? null : \(\s*<p[^>]*bg-warn-soft[^>]*>\s*<AlertTriangle/);
    // the reason is not shown for a "confirm the same price" sheet
    expect(s).toMatch(/\{confirmOnly \? null : \(\s*<p[^>]*>\s*<span[^>]*>Why you are being asked/);
    expect(s).not.toMatch(/[—–]/);
  });
  it("undo asks to force only after the plain warning", () => {
    const s = src("components/invoices/inv-undo.tsx");
    expect(s).toContain("needsForce");
    expect(s).toContain("Set It Back Anyway");
    expect(s).toContain("force: forced");
  });
  it("the Home card hides itself when the data cannot be read", () => {
    const s = src("components/invoices/home-card.tsx");
    expect(s).toMatch(/if \(!data \|\| !counts\) return null/);
    expect(s).toContain("FIRST_RUN_TEXT");
    expect(s).toContain('"/invoices?tab=todo"');
    expect(s).toContain("All Caught Up");
    // what waits comes from the same two hooks as the page
    expect(s).toContain("useMatchCounts");
    expect(s).toContain("useApproveCounts");
    expect(s).not.toMatch(/text-good|bg-good/); // green is never used on this card
    expect(s).toMatch(/Target/);
  });
  it("Home inserts the card once, above Needs Attention and below the Venues card", () => {
    const dash = readFileSync("components/dashboard.tsx", "utf8");
    expect(dash.match(/<InvoicesHomeCard \/>/g)).toHaveLength(1);
    expect(dash.indexOf('aria-labelledby="home-venues"')).toBeLessThan(dash.indexOf("<InvoicesHomeCard />"));
    expect(dash.indexOf("<InvoicesHomeCard />")).toBeLessThan(dash.indexOf('aria-labelledby="needs-attention"'));
  });
  it("the tab pair is gone from both pages", () => {
    expect(readFileSync(path.join("app", "(app)", "portal-prices", "page.tsx"), "utf8")).not.toMatch(/InvoiceTabs|inv-tabs/);
    for (const f of MY_FILES) expect(readFileSync(f, "utf8"), f).not.toMatch(/InvoiceTabs|inv-tabs/);
  });
  it("the Invoices page is the title, one sentence, one four-way control, venue chips and the body: nothing else", () => {
    const s = src("components/invoices/inv-list.tsx");
    expect(s).toContain('<PageHeader title="Invoices" />');
    for (const label of ['"Changes"', '"Discounts"', '"All Invoices"', "todoLabel(todoN)"]) expect(s).toContain(label);
    expect(s).toContain('useUrlState("tab", "todo")');
    expect(s).toContain("<VenueChips");
    // the removed controls
    expect(s).not.toMatch(/PERIOD|STATUS_FILTERS|TouchChips|VenueFilter|subtitle/);
    // the three jobs, in order
    const order = ["<MatchItemsSection", "<ApprovePricesSection", "<ChecksSection"].map((x) => s.indexOf(x));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((x, y) => x - y)).toEqual(order);
    expect(s).toContain("All Caught Up");
    expect(s).toContain("Nothing needs you. New invoices appear here when they arrive.");
  });
  it("the list keeps duplicates and unread documents out of sight and never shows a dash for a total", () => {
    const s = src("components/invoices/inv-all.tsx");
    expect(s).toContain("hiddenKind");
    expect(s).toContain("hiddenSentence");
    expect(s).toMatch(/hasTotal\(d\) \? /);
    expect(s).toContain("Search supplier or invoice number");
  });
  it("the invoice page keeps its technical wording under one collapsed Details and out of sight", () => {
    const s = src("components/invoices/inv-detail.tsx");
    expect(s).toContain('<Disclosure title="Details"');
    expect(s.indexOf('<Disclosure title="Details"')).toBeGreaterThan(s.indexOf('aria-labelledby="inv-lines"'));
    for (const f of MY_FILES.filter((x) => x.endsWith(".tsx") && !x.includes("inv-undo"))) {
      const visible = [...(src(f).match(/>[^<>{}=]*[A-Za-z][^<>{}=]*</g) ?? []), ...(src(f).match(/"[^"\n]* [^"\n]*"/g) ?? [])];
      for (const t of visible) expect(t, `${f}: ${t}`).not.toMatch(/\b(decision|guard|reconciled)\b/i);
    }
    // a line that needs matching goes to its supplier's Match Items screen
    expect(s).toContain("/invoices/match/");
  });
  it("no control shrinks below 44px at any breakpoint", () => {
    const bad: string[] = [];
    for (const f of MY_FILES) {
      for (const m of readFileSync(f, "utf8").matchAll(/\b(?:sm|md|lg|xl):(?:min-)?h-(?:\[(\d+)px\]|(\d+(?:\.\d+)?))(?![\d\w%/])/g)) {
        const px = m[1] != null ? Number(m[1]) : Number(m[2]) * 4;
        if (px < 44) bad.push(`${f}: ${m[0]}`);
      }
    }
    expect(bad).toEqual([]);
  });
  it("uses the shared 44px primitives, not the shrinking .btn classes", () => {
    for (const f of MY_FILES.filter((x) => x.endsWith(".tsx"))) expect(readFileSync(f, "utf8"), f).not.toMatch(/className="[^"]*\bbtn(-plain|-tinted|-text)?\b/);
  });
  it("no em or en dash in anything a person reads", () => {
    for (const f of MY_FILES) expect(readFileSync(f, "utf8"), f).not.toMatch(/[–—]/);
  });
  it("has no Claude reference a client or venue could see", () => {
    for (const f of MY_FILES) expect(strip(readFileSync(f, "utf8")), f).not.toMatch(/claude\.ai|Claude/i);
  });
  it("Invoices is its own area in the navigation", () => {
    const nav = readFileSync("lib/nav.ts", "utf8");
    expect(nav).toContain("inInvoices");
    expect(nav).toContain('href === "/invoices"');
    expect(nav).not.toMatch(/href === "\/portal-prices"\) return .*inInvoices/);
  });
});
