import { readFileSync } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  abnProblem,
  aiCostSummary,
  aliasesText,
  AUTO_APPLY_MAX_PCT,
  autoApplyBlockedReason,
  autoApplyDisplay,
  brisbaneMonthKey,
  chargeKindLabel,
  cleanAbn,
  defaultSpread,
  formatAud,
  formatUsd,
  invoiceSettingsFromRows,
  lastSixMonthKeys,
  parseAliases,
  parseAutoApplyInput,
  parseDaysInput,
  parseRateInput,
  ruleProblem,
  tidyRuleText,
  type AiUsageLite,
} from "@/lib/invoice-settings-view";
import { DEFAULT_INVOICE_SETTINGS } from "@/lib/invoice-types";

describe("the settings numbers", () => {
  it("defaults when the keys are not there yet (migration not applied)", () => {
    expect(invoiceSettingsFromRows([])).toEqual(DEFAULT_INVOICE_SETTINGS);
    expect(invoiceSettingsFromRows(null)).toEqual(DEFAULT_INVOICE_SETTINGS);
  });
  it("reads stored values and clamps silly ones", () => {
    const s = invoiceSettingsFromRows([
      { key: "invoice_auto_apply_pct", value: 0.03 },
      { key: "invoice_learning_mode", value: 0 },
      { key: "invoice_average_days", value: 60 },
      { key: "ai_usd_to_aud", value: 1.6 },
    ]);
    expect(s).toEqual({ autoApplyPct: 0.03, learningMode: false, averageDays: 60, usdToAud: 1.6 });
    expect(invoiceSettingsFromRows([{ key: "invoice_auto_apply_pct", value: 9 }]).autoApplyPct).toBe(0.2);
    expect(invoiceSettingsFromRows([{ key: "invoice_auto_apply_pct", value: 0.3 }]).autoApplyPct).toBe(0.2);
    expect(invoiceSettingsFromRows([{ key: "invoice_auto_apply_pct", value: 0.2 }]).autoApplyPct).toBe(0.2);
    expect(invoiceSettingsFromRows([{ key: "invoice_average_days", value: 5000 }]).averageDays).toBe(365);
    expect(invoiceSettingsFromRows([{ key: "invoice_average_days", value: 0 }]).averageDays).toBe(90);
  });
  it("Auto-Apply Limit: typed percentage points become the stored fraction, 0 to 20", () => {
    expect(parseAutoApplyInput("5")).toEqual({ value: 0.05, clamped: false });
    expect(parseAutoApplyInput("5%")).toEqual({ value: 0.05, clamped: false });
    expect(parseAutoApplyInput("2.5")).toEqual({ value: 0.025, clamped: false });
    expect(parseAutoApplyInput("0")).toEqual({ value: 0, clamped: false });
    expect(parseAutoApplyInput("20")).toEqual({ value: 0.2, clamped: false });
    expect(parseAutoApplyInput("21")).toEqual({ value: 0.2, clamped: true });
    expect(parseAutoApplyInput("50")).toEqual({ value: 0.2, clamped: true });
    expect(parseAutoApplyInput("80")).toEqual({ value: 0.2, clamped: true });
    expect(AUTO_APPLY_MAX_PCT).toBe(20);
    expect(parseAutoApplyInput("abc")).toBeNull();
    expect(parseAutoApplyInput("-3")).toBeNull();
    expect(autoApplyDisplay(0.05)).toBe("5");
    expect(autoApplyDisplay(0.025)).toBe("2.5");
  });
  it("Average Cost Window: whole days, 7 to 365", () => {
    expect(parseDaysInput("90")).toEqual({ value: 90, clamped: false });
    expect(parseDaysInput("2")).toEqual({ value: 7, clamped: true });
    expect(parseDaysInput("1000")).toEqual({ value: 365, clamped: true });
    expect(parseDaysInput("x")).toBeNull();
  });
  it("the dollar rate must be a sensible rate", () => {
    expect(parseRateInput("1.55")).toBe(1.55);
    expect(parseRateInput("0")).toBeNull();
    expect(parseRateInput("50")).toBeNull();
    expect(parseRateInput("")).toBeNull();
  });
  it("a supplier's Auto-Apply is blocked, with the reason, while learning mode is on", () => {
    expect(autoApplyBlockedReason(true)).toMatch(/learning mode is on/i);
    expect(autoApplyBlockedReason(false)).toBeNull();
  });
});

describe("suppliers", () => {
  it("keeps an ABN as digits and wants eleven", () => {
    expect(cleanAbn("61 151 388 094")).toBe("61151388094");
    expect(abnProblem("61 151 388 094")).toBeNull();
    expect(abnProblem("")).toBeNull();
    expect(abnProblem("6115")).toBe("An ABN has 11 digits.");
  });
  it("tidies name variants and drops repeats", () => {
    expect(parseAliases("CD Australia Pty Ltd,  Diablo Co\ncd australia pty ltd\n\n")).toEqual(["CD Australia Pty Ltd", "Diablo Co"]);
    expect(aliasesText(["A", "B"])).toBe("A\nB");
    expect(parseAliases(Array.from({ length: 30 }, (_, i) => `n${i}`).join(","))).toHaveLength(20);
  });
});

describe("charge rules", () => {
  const existing = [
    { id: "r1", match_text: "Delivery", supplier_id: null },
    { id: "r2", match_text: "fuel levy", supplier_id: "s1" },
  ];
  it("starts each kind with the switch Troy described: delivery spread, deposit left out", () => {
    expect(defaultSpread("delivery")).toBe(true);
    expect(defaultSpread("fee")).toBe(true);
    expect(defaultSpread("discount")).toBe(true);
    expect(defaultSpread("deposit")).toBe(false);
    expect(chargeKindLabel("deposit")).toBe("Deposit");
  });
  it("refuses blank, over-long and duplicate words", () => {
    expect(ruleProblem("  ", null, existing)).toMatch(/Type the words/);
    expect(ruleProblem("x".repeat(61), null, existing)).toMatch(/under 60/);
    expect(ruleProblem("DELIVERY", null, existing)).toMatch(/already a rule/);
    expect(ruleProblem("delivery", "s1", existing)).toBeNull(); // same words for one supplier is a different rule
    expect(ruleProblem("fuel  levy", "s1", existing)).toMatch(/already a rule/);
    expect(ruleProblem("Delivery", null, existing, "r1")).toBeNull(); // editing itself is fine
    expect(ruleProblem("keg return", null, existing)).toBeNull();
    expect(tidyRuleText("  fuel   levy ")).toBe("fuel levy");
  });
});

describe("AI cost", () => {
  const NOW = "2026-10-24T05:00:00Z"; // 3pm Brisbane
  const row = (at: string, cost: number, over: Partial<AiUsageLite> = {}): AiUsageLite => ({ at, feature: "invoice_read", cost_usd: cost, document_id: null, file_id: null, ok: true, ...over });
  it("lists the last six months across a year change", () => {
    expect(lastSixMonthKeys("2026-02")).toEqual(["2026-02", "2026-01", "2025-12", "2025-11", "2025-10", "2025-09"]);
  });
  it("puts a call in its Brisbane month, not its UTC month", () => {
    expect(brisbaneMonthKey("2026-09-30T15:00:00Z")).toBe("2026-10"); // 1am on 1 Oct in Brisbane
    expect(brisbaneMonthKey("2026-10-31T13:59:00Z")).toBe("2026-10");
    expect(brisbaneMonthKey("2026-10-31T14:00:00Z")).toBe("2026-11");
    expect(brisbaneMonthKey("junk")).toBe("");
  });
  it("totals this month, counts invoices read and averages per invoice", () => {
    const rows = [
      row("2026-10-20T01:00:00Z", 0.05, { feature: "invoice_sort", document_id: null, file_id: "f1" }),
      row("2026-10-20T01:01:00Z", 0.2, { document_id: "d1" }),
      row("2026-10-20T01:02:00Z", 0.2, { document_id: "d1" }), // a retry of the same document counts once
      row("2026-10-21T01:00:00Z", 0.15, { document_id: "d2" }),
      row("2026-10-21T02:00:00Z", 0.4, { document_id: "d3", ok: false }), // a failed read costs money but is not an invoice read
      row("2026-09-15T01:00:00Z", 1.5),
    ];
    const s = aiCostSummary(rows, NOW, 1.5);
    expect(s.month.key).toBe("2026-10");
    expect(s.month.usd).toBeCloseTo(1.0, 6);
    expect(s.month.aud).toBeCloseTo(1.5, 6);
    expect(s.month.calls).toBe(5);
    expect(s.month.invoices).toBe(2);
    expect(s.month.avgUsd).toBeCloseTo(0.5, 6);
    expect(s.month.avgAud).toBeCloseTo(0.75, 6);
    expect(s.months).toHaveLength(6);
    expect(s.months[0].label).toBe("Oct 2026");
    expect(s.months[1]).toMatchObject({ key: "2026-09", calls: 1, usd: 1.5 });
    expect(s.months[5].calls).toBe(0);
  });
  it("has no average before anything was read, and ignores rows older than six months", () => {
    const s = aiCostSummary([row("2025-01-01T00:00:00Z", 9)], NOW, 1.55);
    expect(s.month.invoices).toBe(0);
    expect(s.month.avgUsd).toBeNull();
    expect(s.months.reduce((a, m) => a + m.usd, 0)).toBe(0);
  });
  it("formats small amounts to a tenth of a cent", () => {
    expect(formatUsd(12.3456)).toBe("US$12.35");
    expect(formatUsd(0.043)).toBe("US$0.043");
    expect(formatUsd(0)).toBe("US$0.00");
    expect(formatAud(0.0667)).toBe("A$0.067");
  });
});

describe("the data layer (in-memory database)", () => {
  let sb: SupabaseClient;
  beforeAll(async () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("fetch", async () => ({ ok: true, json: async () => ({}) }));
    const { createDemoClient } = await import("@/lib/supabase/demo-client");
    sb = createDemoClient();
  });
  it("adds a rule through insertRow (blank note and scope are left out) and switches it off, never deleting", async () => {
    const { insertChargeRule, updateChargeRule, loadChargeRules } = await import("@/lib/invoice-data-extra");
    const row = await insertChargeRule(sb, { match_text: "fuel levy", line_class: "fee", spread: true, note: null, supplier_id: null });
    expect(row.active).toBe(true);
    expect("note" in row).toBe(false);
    expect("supplier_id" in row).toBe(false);
    const off = await updateChargeRule(sb, row.id, { active: false });
    expect(off.active).toBe(false);
    expect((await loadChargeRules(sb)).rows.find((r) => r.id === row.id)?.active).toBe(false);
  });
  it("a rule update that touches no row is a failure", async () => {
    const { updateChargeRule } = await import("@/lib/invoice-data-extra");
    await expect(updateChargeRule(sb, "nope", { active: false })).rejects.toThrow(/did not save/);
  });
  it("saves a numeric setting by key (insert then replace)", async () => {
    const { saveNumericSetting } = await import("@/lib/invoice-data-extra");
    await saveNumericSetting(sb, "invoice_auto_apply_pct", 0.03);
    await saveNumericSetting(sb, "invoice_auto_apply_pct", 0.04);
    const { data } = await sb.from("cost_settings").select("*").eq("key", "invoice_auto_apply_pct");
    expect(data).toHaveLength(1);
    expect((data as { value: number }[])[0].value).toBe(0.04);
  });
  it("the AI cost is visible to a person with rows or a viewers entry, hidden otherwise", async () => {
    const { loadAiUsage } = await import("@/lib/invoice-data-extra");
    expect(await loadAiUsage(sb, "2026-05-01T00:00:00Z")).toEqual({ visible: false, rows: [] });
    await sb.from("ai_cost_viewers").insert([{ email: "demo@precinct.local" }]);
    expect(await loadAiUsage(sb, "2026-05-01T00:00:00Z")).toEqual({ visible: true, rows: [] });
    await sb.from("ai_usage_log").insert([{ id: 1, at: "2026-10-20T01:00:00Z", feature: "invoice_read", cost_usd: "0.12", document_id: "d1", file_id: null, ok: true }]);
    const r = await loadAiUsage(sb, "2026-05-01T00:00:00Z");
    expect(r.visible).toBe(true);
    expect(r.rows[0].cost_usd).toBe(0.12);
  });
  it("missing tables read as unavailable, not as an error", async () => {
    const failing = { from: () => ({ select: () => ({ order: async () => ({ data: null, error: { code: "42P01", message: 'relation "invoice_suppliers" does not exist' } }) }) }) } as unknown as SupabaseClient;
    const { loadInvoiceSuppliers } = await import("@/lib/invoice-data-extra");
    expect(await loadInvoiceSuppliers(failing)).toEqual({ rows: [], available: false });
  });
  it("a failing usage query hides the block", async () => {
    const { loadAiUsage } = await import("@/lib/invoice-data-extra");
    const boom = { from: () => { throw new Error("offline"); } } as unknown as SupabaseClient;
    expect(await loadAiUsage(boom, "2026-05-01T00:00:00Z")).toEqual({ visible: false, rows: [] });
  });
});

describe("source rules for the settings section", () => {
  const files = ["components/settings/invoice-settings.tsx", "components/settings/invoice-suppliers.tsx", "components/settings/invoice-rules.tsx", "components/settings/invoice-save.ts", "components/invoices/ai-cost.tsx"];
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  it("has no bare delete, no raw insert, and rules are deactivate-only", () => {
    for (const f of [...files, "lib/invoice-data-extra.ts"]) {
      const src = strip(readFileSync(f, "utf8"));
      expect(src, f).not.toMatch(/\.delete\(/);
      expect(src, f).not.toMatch(/\.insert\(/);
      expect(src, f).not.toContain("DeleteRecordSheet");
    }
    expect(strip(readFileSync("lib/invoice-data-extra.ts", "utf8"))).toContain("insertRow(");
  });
  it("has no em or en dashes in anything a person reads", () => {
    for (const f of [...files, "lib/invoice-settings-view.ts", "lib/invoice-data-extra.ts"]) expect(strip(readFileSync(f, "utf8")), f).not.toMatch(/[–—]/);
  });
  it("has no tap target shrunk below 44px at a breakpoint", () => {
    for (const f of files) {
      for (const m of readFileSync(f, "utf8").matchAll(/\b(?:sm|md|lg|xl):(?:min-)?h-(?:\[(\d+)px\]|(\d+(?:\.\d+)?))(?![\d\w%/])/g)) {
        const px = m[1] != null ? Number(m[1]) : Number(m[2]) * 4;
        expect(px, `${f}: ${m[0]}`).toBeGreaterThanOrEqual(44);
      }
    }
  });
  it("is plugged into Settings once, and the AI block sits inside the section", () => {
    const page = readFileSync("app/(app)/settings/page.tsx", "utf8");
    expect((page.match(/<InvoiceSettings \/>/g) ?? []).length).toBe(1);
    expect(readFileSync("components/settings/invoice-settings.tsx", "utf8")).toContain("<AiCostBlock");
  });
});
