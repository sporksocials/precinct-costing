/**
 * Settings > Invoices: the pure rules. No React, no database.
 *
 *  - the three numbers (Auto-Apply Limit, Average Cost Window, the dollar rate) with their clamps and parsing
 *  - invoice suppliers (ABN, name variants, auto-apply gate) and charge rules (what a delivery or deposit line is)
 *  - the AI cost block: this month, last six months, in US dollars with an approximate Australian figure
 *
 * Rules are data: nothing here knows what a "delivery" is beyond the seeded default switch for each kind of charge.
 */
import { parseDecimal } from "./format";
import { DEFAULT_INVOICE_SETTINGS, INVOICE_SETTING_KEYS, type InvoiceChargeRuleRow, type InvoiceSettings, type LineClass } from "./invoice-types";

/* ---------------------------------------------------------------- the numbers */

export const AUTO_APPLY_MAX_PCT = 50;
export const AVERAGE_DAYS_MIN = 7;
export const AVERAGE_DAYS_MAX = 365;
export const RATE_MIN = 0.5;
export const RATE_MAX = 5;

export const LEARNING_HELP = "While on, every price waits for a tap. Turn it off once you trust a supplier, then switch Auto-Apply on for that supplier below.";
export const AUTO_APPLY_HELP = "A price that moves by less than this, up or down, can apply itself when the invoice adds up and the product is matched. Anything bigger waits for a tap.";

const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};

/** The invoice settings out of the raw cost_settings rows, with defaults for any key not there yet and the same clamps the fields use. */
export function invoiceSettingsFromRows(rows: readonly { key: string; value: number | string }[] | null | undefined): InvoiceSettings {
  const get = (key: string) => num(rows?.find((r) => r.key === key)?.value);
  const pct = get(INVOICE_SETTING_KEYS.autoApplyPct);
  const learning = get(INVOICE_SETTING_KEYS.learningMode);
  const days = get(INVOICE_SETTING_KEYS.averageDays);
  const rate = get(INVOICE_SETTING_KEYS.usdToAud);
  const d = DEFAULT_INVOICE_SETTINGS;
  return {
    autoApplyPct: pct == null ? d.autoApplyPct : Math.min(AUTO_APPLY_MAX_PCT / 100, Math.max(0, pct)),
    learningMode: learning == null ? d.learningMode : learning !== 0,
    averageDays: days == null || days <= 0 ? d.averageDays : Math.min(AVERAGE_DAYS_MAX, Math.max(AVERAGE_DAYS_MIN, Math.round(days))),
    usdToAud: rate == null || rate <= 0 ? d.usdToAud : rate,
  };
}

/** "5" for 0.05 (one decimal place at most). */
export function autoApplyDisplay(fraction: number): string {
  return String(Math.round(fraction * 1000) / 10);
}

/** What was typed in the Auto-Apply Limit field (percentage points) as the stored fraction, clamped to 0 to 50 points. Null when it is not a number. */
export function parseAutoApplyInput(text: string): { value: number; clamped: boolean } | null {
  const n = parseDecimal(text);
  if (n == null) return null;
  const clamped = n > AUTO_APPLY_MAX_PCT;
  const pts = Math.min(AUTO_APPLY_MAX_PCT, n);
  return { value: Math.round(pts * 10) / 1000, clamped };
}

/** Whole days for the Average Cost Window, clamped to 7 to 365. Null when it is not a number. */
export function parseDaysInput(text: string): { value: number; clamped: boolean } | null {
  const n = parseDecimal(text);
  if (n == null) return null;
  const whole = Math.round(n);
  const value = Math.min(AVERAGE_DAYS_MAX, Math.max(AVERAGE_DAYS_MIN, whole));
  return { value, clamped: value !== whole };
}

/** The US to Australian dollar rate, 0.5 to 5. Null when it is not a sensible rate. */
export function parseRateInput(text: string): number | null {
  const n = parseDecimal(text);
  if (n == null || n < RATE_MIN || n > RATE_MAX) return null;
  return Math.round(n * 10000) / 10000;
}

/* ---------------------------------------------------------------- suppliers */

/** Why a supplier's Auto-Apply switch cannot be used right now, in words; null when it can. */
export function autoApplyBlockedReason(learningMode: boolean): string | null {
  return learningMode ? "Learning mode is on, so every price waits for a tap. Turn learning mode off to use this." : null;
}

/** An ABN as digits only. */
export function cleanAbn(text: string): string {
  return text.replace(/\D/g, "");
}

/** Null when the ABN is fine (blank is allowed); otherwise the problem in words. */
export function abnProblem(text: string): string | null {
  const d = cleanAbn(text);
  if (d === "") return null;
  return d.length === 11 ? null : "An ABN has 11 digits.";
}

export const MAX_ALIASES = 20;

/** Name variants typed one per line or separated by commas, tidied: trimmed, spaces collapsed, no blanks, no repeats (any capitals). */
export function parseAliases(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/[\n,;]+/)) {
    const t = raw.replace(/\s+/g, " ").trim();
    if (!t) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
    if (out.length >= MAX_ALIASES) break;
  }
  return out;
}

export function aliasesText(aliases: readonly string[] | null | undefined): string {
  return (aliases ?? []).join("\n");
}

export const ALLOCATION_HELP = "How delivery and fees are shared over the products on an invoice: by what each line cost, or by how many units.";

/* ---------------------------------------------------------------- charge rules */

export interface ChargeKind {
  value: Extract<LineClass, "delivery" | "fee" | "deposit" | "discount" | "credit" | "other">;
  label: string;
  /** the switch a new rule of this kind starts with; the person can change it */
  spread: boolean;
}
export const CHARGE_KINDS: readonly ChargeKind[] = [
  { value: "delivery", label: "Delivery", spread: true },
  { value: "fee", label: "Fee", spread: true },
  { value: "deposit", label: "Deposit", spread: false },
  { value: "discount", label: "Discount", spread: true },
  { value: "credit", label: "Credit", spread: false },
  { value: "other", label: "Other", spread: false },
];

export function chargeKindLabel(kind: LineClass): string {
  return CHARGE_KINDS.find((k) => k.value === kind)?.label ?? (kind === "product" ? "Product" : kind);
}

export function defaultSpread(kind: LineClass): boolean {
  return CHARGE_KINDS.find((k) => k.value === kind)?.spread ?? false;
}

export const SPREAD_LABEL = "Spread Over The Products";
export function spreadSub(spread: boolean): string {
  return spread ? "Added to the cost of the products on the invoice (landed cost)." : "Left out of cost.";
}

export const RULE_TEXT_MAX = 60;

/**
 * Null when the match text is fine to save; otherwise why not. Text matches the description or item code anywhere, ignoring
 * capitals. The same text for the same supplier (or both for every supplier) is refused, so two rules cannot disagree.
 */
export function ruleProblem(text: string, supplierId: string | null, existing: readonly Pick<InvoiceChargeRuleRow, "id" | "match_text" | "supplier_id">[], editingId?: string): string | null {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return "Type the words to look for on an invoice line, such as fuel levy.";
  if (t.length > RULE_TEXT_MAX) return `Keep it under ${RULE_TEXT_MAX} letters.`;
  const k = t.toLowerCase();
  if (existing.some((r) => r.id !== editingId && (r.supplier_id ?? null) === (supplierId ?? null) && r.match_text.trim().toLowerCase() === k)) {
    return "There is already a rule for those words.";
  }
  return null;
}

export function tidyRuleText(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, RULE_TEXT_MAX);
}

/* ---------------------------------------------------------------- AI cost */

export interface AiUsageLite {
  at: string;
  feature: string;
  cost_usd: number;
  document_id: string | null;
  file_id: string | null;
  ok: boolean;
}

export interface MonthCost {
  key: string; // yyyy-mm, Brisbane
  label: string; // "Oct 2026"
  calls: number;
  usd: number;
}

export interface AiCostSummary {
  month: MonthCost & { aud: number; invoices: number; avgUsd: number | null; avgAud: number | null };
  /** the last six months including this one, newest first */
  months: MonthCost[];
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The Brisbane calendar month (fixed +10:00) an instant falls in, as "2026-10". Empty for text that is not a date. */
export function brisbaneMonthKey(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const d = new Date(t + 10 * 3_600_000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function monthLabel(key: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(key);
  return m ? `${MONTH_NAMES[Number(m[2]) - 1] ?? key} ${m[1]}` : key;
}

/** The month keys for the six months ending at `nowKey`, newest first. */
export function lastSixMonthKeys(nowKey: string): string[] {
  const m = /^(\d{4})-(\d{2})$/.exec(nowKey);
  if (!m) return [];
  let y = Number(m[1]);
  let mo = Number(m[2]);
  const out: string[] = [];
  for (let i = 0; i < 6; i++) {
    out.push(`${y}-${String(mo).padStart(2, "0")}`);
    mo -= 1;
    if (mo === 0) {
      mo = 12;
      y -= 1;
    }
  }
  return out;
}

const cents = (n: number) => Math.round(n * 1_000_000) / 1_000_000;

/**
 * This month and the last six, from the usage log. "Invoices read" counts the successful invoice reading calls, one per document
 * (a retried call for the same document counts once); the average divides the whole month's AI cost by that count.
 */
export function aiCostSummary(rows: readonly AiUsageLite[], nowIso: string, usdToAud: number): AiCostSummary {
  const nowKey = brisbaneMonthKey(nowIso);
  const keys = lastSixMonthKeys(nowKey);
  const byMonth = new Map<string, MonthCost>(keys.map((k) => [k, { key: k, label: monthLabel(k), calls: 0, usd: 0 }]));
  const readDocs = new Set<string>();
  let reads = 0;
  for (const r of rows) {
    const k = brisbaneMonthKey(r.at);
    const m = byMonth.get(k);
    if (!m) continue;
    m.calls += 1;
    m.usd = cents(m.usd + (Number(r.cost_usd) || 0));
    if (k === nowKey && r.ok && r.feature.startsWith("invoice_read")) {
      if (r.document_id) readDocs.add(r.document_id);
      else reads += 1;
    }
  }
  const invoices = readDocs.size + reads;
  const cur = byMonth.get(nowKey) ?? { key: nowKey, label: monthLabel(nowKey), calls: 0, usd: 0 };
  const avgUsd = invoices > 0 ? cents(cur.usd / invoices) : null;
  return {
    month: { ...cur, aud: cents(cur.usd * usdToAud), invoices, avgUsd, avgAud: avgUsd == null ? null : cents(avgUsd * usdToAud) },
    months: keys.map((k) => byMonth.get(k)!),
  };
}

/** US dollars: cents for amounts of a dollar or more, a tenth of a cent below that ("US$0.043"). */
export function formatUsd(n: number): string {
  const v = Math.abs(n) >= 1 || n === 0 ? n.toFixed(2) : n.toFixed(3);
  return `US$${v}`;
}

/** Australian dollars, the same way. Always shown beside the word approximate. */
export function formatAud(n: number): string {
  const v = Math.abs(n) >= 1 || n === 0 ? n.toFixed(2) : n.toFixed(3);
  return `A$${v}`;
}
