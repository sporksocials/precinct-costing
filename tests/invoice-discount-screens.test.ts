import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadDiscountGroups } from "@/lib/invoice-discount-data";

/**
 * Discounts We Found, the discount line on an invoice, and the ingredient page line. Two parts: the read layer against a fake client
 * (tables or columns that do not exist yet, copies of invoices, the venue and ingredient filters), and a scan of the screens' source
 * for the rules Troy set: read only, nothing writes a price, a recipe or a sell price, 44px controls, no dashes, no hidden controls.
 */

// ---------------------------------------------------------------- a tiny fake client
type Reply = { data?: unknown[] | null; error?: { message: string; code?: string } | null };
interface Q {
  table: string;
  filters: [string, string, unknown][];
}

function fake(tables: Record<string, Reply | ((q: Q) => Reply)>) {
  const calls: Q[] = [];
  const sb = {
    from(table: string) {
      const q: Q = { table, filters: [] };
      const run = (): Promise<Reply> => {
        calls.push({ ...q, filters: [...q.filters] });
        const r = tables[table];
        const reply = typeof r === "function" ? r(q) : (r ?? { data: null, error: { message: `relation "public.${table}" does not exist`, code: "42P01" } });
        return Promise.resolve({ data: reply.data ?? null, error: reply.error ?? null });
      };
      const b: Record<string, unknown> = {};
      for (const m of ["select", "order", "limit", "range"]) b[m] = () => b;
      for (const m of ["eq", "gt", "in"]) b[m] = (c: string, v: unknown) => (q.filters.push([m, c, v]), b);
      b.then = (res: (v: Reply) => unknown, rej: (e: unknown) => unknown) => run().then(res, rej);
      return b;
    },
  };
  return { sb: sb as unknown as SupabaseClient, calls };
}

const line = (over: Record<string, unknown>) => ({
  id: "l1", document_id: "d1", venue_id: 1, ingredient_id: "ing-barra", description: "Humpty Doo Barramundi fillets per kg", qty: 2.39, unit_price_ex: 41.54, base_qty: 2.39, base_unit: "kg",
  discount_pct: 0.166195, discount_per_base: 6.8828, state: "open", ...over,
});
const doc = (over: Record<string, unknown>) => ({ id: "d1", invoice_number: "51329", invoice_date: "2026-10-14", supplier_id: "s1", supplier_name_read: "Daniel Street Fish Market", status: "needs_review", ...over });

describe("the discount read layer", () => {
  it("before the migration (no tables) it is simply not available, never an error", async () => {
    expect(await loadDiscountGroups(fake({}).sb)).toEqual({ groups: [], available: false });
  });

  it("before the new columns exist it is not available either", async () => {
    const { sb } = fake({ invoice_lines: { error: { message: "column invoice_lines.discount_pct does not exist", code: "42703" } } });
    expect(await loadDiscountGroups(sb)).toEqual({ groups: [], available: false });
  });

  it("a client that throws is not available", async () => {
    const boom = { from: () => { throw new Error("offline"); } } as unknown as SupabaseClient;
    expect((await loadDiscountGroups(boom)).available).toBe(false);
  });

  it("no discounted lines is available and empty", async () => {
    expect(await loadDiscountGroups(fake({ invoice_lines: { data: [] } }).sb)).toEqual({ groups: [], available: true });
  });

  it("groups the lines of two invoices by supplier and ingredient, with the ingredient's name from the store", async () => {
    const { sb } = fake({
      invoice_lines: { data: [line({}), line({ id: "l2", document_id: "d2", qty: 4.57, base_qty: 4.57, unit_price_ex: 41.5, discount_pct: 0.166193, discount_per_base: 6.8972 })] },
      invoice_documents: { data: [doc({}), doc({ id: "d2", invoice_number: "9764204", invoice_date: "2026-10-17" })] },
      invoice_suppliers: { data: [{ id: "s1", name: "Daniel Street Fish Market" }] },
    });
    const r = await loadDiscountGroups(sb, { ingredientName: (id) => (id === "ing-barra" ? "Barramundi Fillets (1kg)" : null) });
    expect(r.available).toBe(true);
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0]).toMatchObject({ supplier: "Daniel Street Fish Market", item: "Barramundi Fillets (1kg)", invoiceCount: 2, status: "standing", baseUnit: "kg" });
  });

  it("leaves out lines on a copy of an invoice, a set-aside one or a failed one, and lines a person ignored", async () => {
    const { sb } = fake({
      invoice_lines: { data: [line({ id: "a", document_id: "dup" }), line({ id: "b", document_id: "ign" }), line({ id: "c", document_id: "bad" }), line({ id: "e", document_id: "ok", state: "ignored" }), line({ id: "f", document_id: "good" })] },
      invoice_documents: { data: [doc({ id: "dup", status: "duplicate" }), doc({ id: "ign", status: "ignored" }), doc({ id: "bad", status: "failed" }), doc({ id: "ok" }), doc({ id: "good", invoice_number: "9" })] },
      invoice_suppliers: { data: [{ id: "s1", name: "Daniel Street Fish Market" }] },
    });
    const r = await loadDiscountGroups(sb);
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0].invoices.map((i) => i.documentId)).toEqual(["good"]);
  });

  it("asks only for product lines with a discount, and narrows by venue and ingredient when told to", async () => {
    const { sb, calls } = fake({ invoice_lines: { data: [] } });
    await loadDiscountGroups(sb, { venueId: 2, ingredientId: "ing-barra" });
    expect(calls[0].filters).toEqual([["eq", "line_class", "product"], ["gt", "discount_pct", 0], ["eq", "venue_id", 2], ["eq", "ingredient_id", "ing-barra"]]);
  });

  it("a discount line whose invoice cannot be read is skipped, not shown without a supplier", async () => {
    const { sb } = fake({ invoice_lines: { data: [line({})] }, invoice_documents: { data: [] }, invoice_suppliers: { data: [] } });
    expect(await loadDiscountGroups(sb)).toEqual({ groups: [], available: true });
  });
});

// ---------------------------------------------------------------- source scan
const FILES = [
  "lib/invoice-discounts.ts",
  "lib/invoice-discount-data.ts",
  "components/invoices/inv-discounts.tsx",
  "components/invoices/use-discounts.ts",
  "components/invoices/ing-invoice-costs.tsx",
  "components/invoices/inv-list.tsx",
  "components/invoices/inv-line.tsx",
  "components/invoices/inv-detail.tsx",
];
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
const src = (f: string) => strip(readFileSync(f, "utf8"));

describe("the discount screens obey Troy's rules", () => {
  it("only read: no writes of any kind in the discount files", () => {
    for (const f of ["lib/invoice-discounts.ts", "lib/invoice-discount-data.ts", "components/invoices/inv-discounts.tsx", "components/invoices/use-discounts.ts"]) {
      expect(src(f), f).not.toMatch(/\.(insert|upsert|update|delete)\(/);
    }
  });

  it("never touches a recipe, a sell price, an ingredient price or a deal", () => {
    for (const f of ["lib/invoice-discounts.ts", "lib/invoice-discount-data.ts", "components/invoices/inv-discounts.tsx", "components/invoices/use-discounts.ts", "components/invoices/ing-invoice-costs.tsx"]) {
      const s = src(f);
      expect(s, f).not.toMatch(/sell_price|cost_sell|happy_hour|cost_menu_items|cost_recipe|cost_beer|cost_gelato|cost_preps/);
      expect(s, f).not.toMatch(/updateIngredient|updateItem|saveLines|addDeal|updateDeal|insertRow|store\.update/);
      expect(s, f).not.toMatch(/pack_price\s*[:=]/);
    }
  });

  it("the Add Deal form is filled in from the address and never saved by it", () => {
    const s = src("components/deal-editor.tsx");
    const start = s.indexOf("suggestedFromParams((k)");
    expect(start).toBeGreaterThan(0);
    const effect = s.slice(s.lastIndexOf("useEffect(", start), s.indexOf("const res = resolveDeals", start));
    expect(effect).toContain("setPrefill(fromAddress)");
    expect(effect).toContain("onAddingChange(true)");
    expect(effect).not.toMatch(/addDeal|updateDeal|insertRow|save\(/);
    // the form still shows the effect on the dishes and saves only from its own Save buttons
    expect(s).toContain("ingredientChangeImpact(ing.id, {}, { ...store, lines: store.allLines, dealsAfter: [...store.deals, deferredDraft] })");
    expect(s.match(/store\.addDeal\(/g)).toHaveLength(1);
  });

  it("is one of the four segments of the Invoices control, with its own address", () => {
    const s = src("components/invoices/inv-list.tsx");
    expect(s).toContain('{ value: "discounts", label: "Discounts" }');
    expect(s).toContain('tab === "discounts"');
    expect(s).toContain("<DiscountsView");
    // the discounts view has no sidebar or More entry of its own
    const nav = readFileSync("lib/nav.ts", "utf8");
    expect(nav).not.toMatch(/discounts/i);
  });

  it("the list rows show both the percentage and the dollars, the count, the status as icon plus word, and the steadier hint", () => {
    const s = src("components/invoices/inv-discounts.tsx");
    expect(s).toContain("groupSizeText(g)");
    expect(s).toContain("seenText(g.invoiceCount)");
    expect(s).toContain("<DiscountStatusLabel");
    expect(s).toContain("steadierText(g)");
    expect(s).toContain("netText(g.netPerBase, g.baseUnit)");
    expect(s).toMatch(/const STATUS_ICON/);
    // only "varies" uses an amber word; nothing uses green or red
    expect(s).toMatch(/status === "varies" \? "text-warn" : "text-label-2"/);
    expect(s).not.toMatch(/text-good|bg-good|text-danger|bg-danger/);
  });

  it("has the calm empty states", () => {
    const s = src("components/invoices/inv-discounts.tsx");
    expect(s).toContain("No Discounts Found Yet");
    expect(s).toContain("They appear when an invoice has a negative line against a product.");
    expect(s).toContain("Discounts Are Not Set Up Yet");
  });

  it("Add As Standing Discount is a 44px button on a standing group only, and not when a Percent Off deal is already there", () => {
    const s = src("components/invoices/inv-discounts.tsx");
    expect(s).toContain("Add As Standing Discount");
    expect(s).toContain('g.status === "standing" && !!g.ingredientId');
    expect(s).toContain('d.kind === "percent_off" && d.active');
    expect(s).toContain("<TouchLink");
    const ing = src("components/invoices/ing-invoice-costs.tsx");
    expect(ing).toContain("Add As Standing Discount");
    expect(ing).toContain('g.status === "standing" && !hasPercentDeal');
  });

  it("the ingredient page says it in a sentence, with the net cost, inside Cost From Invoices", () => {
    const s = src("components/invoices/ing-invoice-costs.tsx");
    expect(s).toContain("ingredientDiscountText(g)");
    expect(s).toContain("netText(g.netPerBase, g.baseUnit)");
    expect(s).toContain("Cost From Invoices");
  });

  it("the invoice line shows the discount beside the landed cost, and the discount line says where it went", () => {
    const line = src("components/invoices/inv-line.tsx");
    expect(line).toContain("lineDiscountText(line)");
    expect(line).toContain("lineNetPerBase(line)");
    expect(line).toContain("Taken off the price of");
    expect(src("components/invoices/inv-detail.tsx")).toContain("productDiscountTargets(");
  });

  it("no control shrinks below 44px at any breakpoint", () => {
    const bad: string[] = [];
    for (const f of FILES.filter((x) => x.endsWith(".tsx"))) {
      for (const m of readFileSync(f, "utf8").matchAll(/\b(?:sm|md|lg|xl):(?:min-)?h-(?:\[(\d+)px\]|(\d+(?:\.\d+)?))(?![\d\w%/])/g)) {
        const px = m[1] != null ? Number(m[1]) : Number(m[2]) * 4;
        if (px < 44) bad.push(`${f}: ${m[0]}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("uses the shared 44px primitives, not the shrinking .btn classes", () => {
    for (const f of ["components/invoices/inv-discounts.tsx", "components/invoices/ing-invoice-costs.tsx"]) expect(readFileSync(f, "utf8"), f).not.toMatch(/className="[^"]*\bbtn(-plain|-tinted|-text)?\b/);
  });

  it("no em or en dash in anything a person reads", () => {
    for (const f of FILES) expect(readFileSync(f, "utf8"), f).not.toMatch(/[–—]/);
  });
});
