/**
 * Invoices: the pure helpers the Home card, the Invoices list and the invoice page share (Troy, 24 Oct 2026). No React, no database,
 * no clock (today is always passed in). Period maths is in Brisbane time (fixed +10:00, no daylight saving), weeks run Monday to Sunday.
 * Wording lives here so every screen words a status, a decision and a price move the same way. No em or en dashes in anything read.
 */
import { money, num } from "./format";
import type { DocStatus, InvoiceChargeRuleRow, InvoiceDocumentRow, InvoiceLineRow, InvoicePriceChangeRow, LineClass, ReconNote } from "./invoice-types";

// ---------------------------------------------------------------- dates (Brisbane)

/** yyyy-mm-dd in Brisbane for an ISO timestamp (UTC+10 all year). "" when unreadable. */
export function brisbaneDate(iso: string | null | undefined): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return "";
  return new Date(t + 10 * 3600 * 1000).toISOString().slice(0, 10);
}

function dayNo(date: string): number {
  const [y, m, d] = date.slice(0, 10).split("-").map(Number);
  return Math.floor(Date.UTC(y, (m || 1) - 1, d || 1) / 86_400_000);
}
function fromDayNo(n: number): string {
  return new Date(n * 86_400_000).toISOString().slice(0, 10);
}
export function addDays(date: string, n: number): string {
  return fromDayNo(dayNo(date) + n);
}
/** 0 = Monday ... 6 = Sunday. */
export function weekdayMon0(date: string): number {
  return (new Date(dayNo(date) * 86_400_000).getUTCDay() + 6) % 7;
}

export interface DateRange {
  /** inclusive, yyyy-mm-dd; null = no lower bound */
  from: string | null;
  to: string | null;
}

/** Monday to Sunday containing `today`, or `weeksBack` weeks earlier. */
export function weekRange(today: string, weeksBack = 0): DateRange {
  const monday = addDays(today, -weekdayMon0(today) - 7 * weeksBack);
  return { from: monday, to: addDays(monday, 6) };
}
export function monthRange(today: string): DateRange {
  const [y, m] = today.split("-").map(Number);
  const first = `${y}-${String(m).padStart(2, "0")}-01`;
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  return { from: first, to: addDays(next, -1) };
}
/** The last 30 days including today. */
export function last30Range(today: string): DateRange {
  return { from: addDays(today, -29), to: today };
}

export type PeriodId = "week" | "last_week" | "month" | "all";
export const PERIOD_OPTIONS: { value: PeriodId; label: string }[] = [
  { value: "week", label: "This Week" },
  { value: "last_week", label: "Last Week" },
  { value: "month", label: "This Month" },
  { value: "all", label: "All" },
];
export const DEFAULT_PERIOD: PeriodId = "week";
export function readPeriod(v: string | null | undefined): PeriodId {
  return PERIOD_OPTIONS.some((p) => p.value === v) ? (v as PeriodId) : DEFAULT_PERIOD;
}
export function periodRange(id: PeriodId, today: string): DateRange {
  if (id === "week") return weekRange(today, 0);
  if (id === "last_week") return weekRange(today, 1);
  if (id === "month") return monthRange(today);
  return { from: null, to: null };
}
export function inRange(date: string, r: DateRange): boolean {
  if (!date) return false;
  if (r.from && date < r.from) return false;
  if (r.to && date > r.to) return false;
  return true;
}

/** "14 Oct 2026" from a yyyy-mm-dd date or an ISO timestamp read in Brisbane. "" when there is none. */
export function dayLabel(v: string | null | undefined): string {
  if (!v) return "";
  const d = v.length <= 10 ? v : brisbaneDate(v);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return "";
  const [y, m, day] = d.split("-").map(Number);
  return `${day} ${MON[m - 1]} ${y}`;
}
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// ---------------------------------------------------------------- counts

/** A document that is not a real, live invoice: it never counts as "processed". */
export const NOT_COUNTED: readonly DocStatus[] = ["duplicate", "failed", "ignored"];

export interface DocLite {
  id: string;
  status: DocStatus;
  created_at: string;
}
export interface ChangeLite {
  kind: InvoicePriceChangeRow["kind"];
  status: InvoicePriceChangeRow["status"];
  applied_at: string;
}

/** What waits on a person for ONE document: open questions plus lines waiting for approval. */
export interface DocStats {
  /** prices written by the invoice system (kind price_change, still applied) */
  changed: number;
  /** prices confirmed as unchanged */
  confirmed: number;
  questions: number;
  approvals: number;
  needYou: number;
}
const NO_STATS: DocStats = { changed: 0, confirmed: 0, questions: 0, approvals: 0, needYou: 0 };

export function docStats(
  changes: readonly Pick<InvoicePriceChangeRow, "document_id" | "kind" | "status">[],
  questions: readonly { document_id: string }[],
  approvalLines: readonly { document_id: string }[],
): Map<string, DocStats> {
  const m = new Map<string, DocStats>();
  const get = (id: string) => {
    let s = m.get(id);
    if (!s) {
      s = { ...NO_STATS };
      m.set(id, s);
    }
    return s;
  };
  for (const c of changes) {
    if (c.status !== "applied") continue;
    const s = get(c.document_id);
    if (c.kind === "price_change") s.changed++;
    else s.confirmed++;
  }
  for (const q of questions) get(q.document_id).questions++;
  for (const l of approvalLines) get(l.document_id).approvals++;
  for (const s of m.values()) s.needYou = s.questions + s.approvals;
  return m;
}
export const statsFor = (m: Map<string, DocStats>, id: string): DocStats => m.get(id) ?? NO_STATS;

export interface HomeCounts {
  processed: number;
  updated: number;
  needYou: number;
  /** nothing has ever been filed and nothing waits */
  firstRun: boolean;
}

/**
 * The Home card's three numbers (Troy's rule): invoices processed = documents created in the period that are not duplicate,
 * failed or ignored; prices updated = price_change rows still applied in the period (a confirmation is not an update); need you =
 * open questions plus lines waiting for approval, on documents that are not duplicate, failed or ignored.
 */
export function homeCounts(input: {
  docs: readonly DocLite[];
  changes: readonly ChangeLite[];
  range: DateRange;
  /** documents behind the open questions and the approval lines, with their status; one entry per question or line */
  waiting: readonly { status: DocStatus }[];
  totalDocs: number;
}): HomeCounts {
  const processed = input.docs.filter((d) => !NOT_COUNTED.includes(d.status) && inRange(brisbaneDate(d.created_at), input.range)).length;
  const updated = input.changes.filter((c) => c.kind === "price_change" && c.status === "applied" && inRange(brisbaneDate(c.applied_at), input.range)).length;
  const needYou = input.waiting.filter((w) => !NOT_COUNTED.includes(w.status)).length;
  return { processed, updated, needYou, firstRun: input.totalDocs === 0 && needYou === 0 };
}

export function invoicesWord(n: number): string {
  return n === 1 ? "Invoice Processed" : "Invoices Processed";
}
export function pricesWord(n: number): string {
  return n === 1 ? "Price Updated" : "Prices Updated";
}
/** "3 Need You", "1 Needs You". */
export function needYouText(n: number): string {
  return n === 1 ? "1 Needs You" : `${n} Need You`;
}

// ---------------------------------------------------------------- the list

export type StatusFilterId = "all" | "needs" | "applied" | "nothing";
export const STATUS_FILTERS: { value: StatusFilterId; label: string }[] = [
  { value: "all", label: "All" },
  { value: "needs", label: "Needs You" },
  { value: "applied", label: "Applied" },
  { value: "nothing", label: "Nothing To Apply" },
];
export function readStatusFilter(v: string | null | undefined): StatusFilterId {
  return STATUS_FILTERS.some((s) => s.value === v) ? (v as StatusFilterId) : "all";
}
export function matchesStatus(filter: StatusFilterId, status: DocStatus, stats: DocStats): boolean {
  if (filter === "all") return true;
  if (filter === "needs") return !NOT_COUNTED.includes(status) && (status === "needs_review" || stats.needYou > 0);
  if (filter === "applied") return status === "applied" || status === "partly_applied";
  return status === "nothing_to_apply";
}

export type StatusIcon = "check" | "alert" | "dash" | "copy" | "x" | "ban";
export interface StatusView {
  word: string;
  /** warn = waits on a person (amber token), danger = could not be read; neutral is plain text. The word and the icon always go with it. */
  tone: "neutral" | "warn" | "danger";
  icon: StatusIcon;
}
const plural = (n: number, one: string, many: string) => (n === 1 ? `${n} ${one}` : `${n} ${many}`);

export function statusView(status: DocStatus, s: DocStats): StatusView {
  switch (status) {
    case "needs_review":
      return { word: s.needYou > 0 ? `Needs You: ${s.needYou}` : "Needs Review", tone: "warn", icon: "alert" };
    case "partly_applied":
      return { word: `Applied: ${plural(s.changed, "price", "prices")}${s.needYou > 0 ? `, ${s.needYou} ${s.needYou === 1 ? "needs" : "need"} you` : ""}`, tone: s.needYou > 0 ? "warn" : "neutral", icon: s.needYou > 0 ? "alert" : "check" };
    case "applied":
      return { word: s.changed > 0 ? `Applied: ${plural(s.changed, "price", "prices")}` : s.confirmed > 0 ? "Prices Confirmed" : "Applied", tone: "neutral", icon: "check" };
    case "nothing_to_apply":
      return { word: "Nothing To Apply", tone: "neutral", icon: "dash" };
    case "duplicate":
      return { word: "Duplicate", tone: "neutral", icon: "copy" };
    case "ignored":
      return { word: "Ignored", tone: "neutral", icon: "ban" };
    case "failed":
      return { word: "Could Not Read", tone: "danger", icon: "x" };
  }
}

/** "Daniel Street Fish Market · 51329" for a title line; the number is left off when there is none. */
export function docTitle(d: Pick<InvoiceDocumentRow, "supplier_name_read" | "doc_type">, supplierName: string | null): string {
  const name = supplierName || d.supplier_name_read || "Unknown Supplier";
  return d.doc_type === "credit_note" ? `${name} (Credit Note)` : name;
}
export function numberLabel(n: string | null | undefined): string {
  return n && n.trim() ? `#${n.trim()}` : "No number";
}
/** The label the price log uses: "Invoice 51329 · Daniel Street Fish Market · 14 Oct 2026". */
export function invoiceSourceLabel(number: string | null, supplier: string, date: string | null): string {
  return ["Invoice " + (number?.trim() || "(no number)"), supplier, dayLabel(date)].filter(Boolean).join(" · ");
}

/** Newest invoice date first, then newest filed. */
export function sortDocs<T extends Pick<InvoiceDocumentRow, "invoice_date" | "created_at">>(docs: readonly T[]): T[] {
  return [...docs].sort((a, b) => (b.invoice_date ?? "").localeCompare(a.invoice_date ?? "") || b.created_at.localeCompare(a.created_at));
}

export function filterDocs<T extends Pick<InvoiceDocumentRow, "id" | "venue_id" | "status" | "created_at" | "invoice_date">>(
  docs: readonly T[],
  f: { venueId: number | null; range: DateRange; status: StatusFilterId },
  stats: Map<string, DocStats>,
): T[] {
  return docs.filter((d) => {
    if (f.venueId != null && d.venue_id !== f.venueId) return false;
    if (f.range.from || f.range.to) {
      if (!inRange(brisbaneDate(d.created_at), f.range)) return false;
    }
    return matchesStatus(f.status, d.status, statsFor(stats, d.id));
  });
}

/** 100 rows and then Show More, like the Menu list. */
export const PAGE = 100;
export const PAGE_STEP = 200;

// ---------------------------------------------------------------- price moves

export interface PriceMove {
  dir: "up" | "down" | "same" | "none";
  /** "Up 2.8%", "Down 1.1%", "No change", "" */
  text: string;
}
/** `pct` is a signed fraction ((new - old) / old). Under a twentieth of a percent is no change. */
export function priceMove(pct: number | null | undefined): PriceMove {
  if (pct == null || Number.isNaN(Number(pct))) return { dir: "none", text: "" };
  const v = Number(pct) * 100;
  if (Math.abs(v) < 0.05) return { dir: "same", text: "No change" };
  const t = `${Math.abs(v).toFixed(1)}%`;
  return v > 0 ? { dir: "up", text: `Up ${t}` } : { dir: "down", text: `Down ${t}` };
}
/** (new - old) / old, or null when either is missing or old is zero. */
export function pctChange(oldPrice: number | null | undefined, newPrice: number | null | undefined): number | null {
  if (oldPrice == null || newPrice == null || !(Number(oldPrice) > 0)) return null;
  return (Number(newPrice) - Number(oldPrice)) / Number(oldPrice);
}

// ---------------------------------------------------------------- the invoice page

export interface CheckItem {
  key: string;
  /** true = passed, false = failed, null = could not be checked */
  ok: boolean | null;
  label: string;
  detail: string | null;
}

/** The checks, in words. Reasons come from the stored recon notes, which are written for a person. The venue is not a check: prices are shared across venues. (Old stored venue notes are skipped.) */
export function checkItems(doc: Pick<InvoiceDocumentRow, "reconciled" | "recon_notes" | "duplicate_of" | "status">): CheckItem[] {
  const notes: ReconNote[] = Array.isArray(doc.recon_notes) ? doc.recon_notes : [];
  const math = notes.filter((n) => n.check !== "venue" && n.check !== "duplicate");
  const failing = math.filter((n) => !n.ok);
  const out: CheckItem[] = [];
  out.push(
    doc.reconciled && failing.length === 0
      ? { key: "adds", ok: true, label: "Adds up", detail: null }
      : { key: "adds", ok: false, label: "Does not add up", detail: failing.length ? failing.map((n) => n.message).join(" ") : "The lines, subtotal, GST and total do not agree." },
  );
  out.push(doc.duplicate_of || doc.status === "duplicate" ? { key: "dup", ok: false, label: "Possible duplicate", detail: "This invoice number has been filed before." } : { key: "dup", ok: true, label: "Not a duplicate", detail: null });
  return out;
}

export const isChargeClass = (c: LineClass): boolean => c !== "product";

export function splitLines<T extends Pick<InvoiceLineRow, "line_class" | "line_no">>(lines: readonly T[]): { products: T[]; charges: T[] } {
  const sorted = [...lines].sort((a, b) => a.line_no - b.line_no);
  return { products: sorted.filter((l) => !isChargeClass(l.line_class)), charges: sorted.filter((l) => isChargeClass(l.line_class)) };
}

export const CLASS_WORD: Record<LineClass, string> = {
  product: "Product",
  delivery: "Delivery",
  fee: "Fee",
  deposit: "Deposit",
  discount: "Discount",
  credit: "Credit",
  other: "Other",
};

export interface ChargeTreatment {
  label: string;
  /** true = spread over the products, false = left out of cost, null = taken off a product's price */
  spread: boolean | null;
}
/**
 * Whether a charge line is spread over the products as landed cost. The rule table decides (a supplier's own rule before a general
 * one, matched on words in the description); with no rule the seeded defaults apply: delivery, fees and discounts spread, deposits and
 * anything else are left out, and a credit comes off the product it was for.
 */
export function chargeTreatment(
  line: Pick<InvoiceLineRow, "line_class" | "description">,
  docFeePool: number,
  rules: readonly Pick<InvoiceChargeRuleRow, "supplier_id" | "match_text" | "line_class" | "spread" | "active">[],
  supplierId: string | null,
): ChargeTreatment {
  if (line.line_class === "credit") return { label: "Taken off the product price", spread: null };
  const text = line.description.toLowerCase();
  const hits = rules.filter((r) => r.active && r.match_text.trim() && text.includes(r.match_text.trim().toLowerCase()));
  const rule = hits.find((r) => r.supplier_id && r.supplier_id === supplierId) ?? hits.find((r) => !r.supplier_id);
  const spread = rule ? rule.spread : line.line_class === "delivery" || line.line_class === "fee" || line.line_class === "discount";
  if (spread && !(Math.abs(docFeePool) > 0)) return { label: "Left out of cost", spread: false };
  return spread ? { label: "Spread over the products", spread: true } : { label: "Left out of cost", spread: false };
}

export function unitWord(unit: string | null | undefined): string {
  return (unit ?? "").trim().toLowerCase();
}

/** "1.85 kg × $68.90", "2 ea × $38.62"; just the total when the quantity or price was not read. */
export function qtyPriceText(l: Pick<InvoiceLineRow, "qty" | "unit" | "unit_price_ex">): string {
  if (l.qty == null || l.unit_price_ex == null) return "";
  return `${[num(Number(l.qty), 3), unitWord(l.unit)].filter(Boolean).join(" ")} × ${money(Number(l.unit_price_ex))}`;
}

/** "Landed $70.84/kg", or null when the line has no landed cost. */
export function landedText(l: Pick<InvoiceLineRow, "landed_unit_ex" | "unit">): string | null {
  if (l.landed_unit_ex == null) return null;
  const u = unitWord(l.unit);
  return `Landed ${money(Number(l.landed_unit_ex))}${u ? "/" + u : ""}`;
}
/** "Includes $3.59 of delivery" for the tap-to-explain line; null when no share was added. */
export function feeShareText(l: Pick<InvoiceLineRow, "fee_share_ex">, poolClasses: readonly LineClass[]): string | null {
  const share = Number(l.fee_share_ex ?? 0);
  if (!(Math.abs(share) >= 0.005)) return null;
  const set = new Set(poolClasses);
  const parts: string[] = [];
  if (set.has("delivery")) parts.push("delivery");
  if (set.has("fee")) parts.push("fees");
  if (set.has("discount")) parts.push(share < 0 ? "discount" : "discounts");
  const what = parts.length === 0 ? "delivery and fees" : parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  return share < 0 ? `Includes ${money(Math.abs(share))} off for ${what}` : `Includes ${money(share)} of ${what}`;
}
export const LANDED_EXPLAIN = "Landed cost is the price per unit once your share of delivery and fees is added in.";

export interface LineStateView {
  word: string;
  /** warn only for a line that waits on a person */
  tone: "neutral" | "warn";
}
export function lineStateView(l: Pick<InvoiceLineRow, "state" | "decision" | "match_state">): LineStateView {
  switch (l.state) {
    case "applied":
      return { word: "Applied", tone: "neutral" };
    case "confirmed":
      return { word: "Price confirmed", tone: "neutral" };
    case "approved_skip":
      return { word: "Skipped", tone: "neutral" };
    case "reverted":
      return { word: "Put back", tone: "neutral" };
    case "ignored":
      return { word: "Ignored", tone: "neutral" };
    case "open":
      break;
  }
  if (l.decision === "needs_approval") return { word: "Needs approval", tone: "warn" };
  if (l.decision === "apply") return { word: "Ready to apply", tone: "neutral" };
  if (l.decision === "same") return { word: "Same price", tone: "neutral" };
  if (l.match_state === "unmatched" || l.match_state === "ambiguous") return { word: "Not matched yet", tone: "warn" };
  return { word: "Nothing to apply", tone: "neutral" };
}

/** The engine's reason in plain words, with a fallback per decision. */
export function decisionText(l: Pick<InvoiceLineRow, "decision" | "decision_reason" | "match_state">): string {
  if (l.decision_reason && l.decision_reason.trim()) return l.decision_reason.trim();
  switch (l.decision) {
    case "apply":
      return "The price changed by less than the limit.";
    case "needs_approval":
      return "A person needs to approve this price.";
    case "same":
      return "Same price as the app.";
    case "skip":
      return "Skipped.";
    default:
      return l.match_state === "unmatched" ? "Not matched to an ingredient or product." : "No price change to make.";
  }
}

/** A line a person can approve: still open, with a price to write or confirm. */
export function canApprove(l: Pick<InvoiceLineRow, "state" | "decision" | "line_class" | "ingredient_id" | "product_id">): boolean {
  return l.state === "open" && l.line_class === "product" && (l.decision === "needs_approval" || l.decision === "apply" || l.decision === "same") && !!(l.ingredient_id || l.product_id);
}
export function approveLabel(l: Pick<InvoiceLineRow, "decision">): string {
  return l.decision === "same" ? "Confirm Price" : "Approve";
}
/** A line a person can skip (leave the app's price alone): open and waiting. */
export function canSkip(l: Pick<InvoiceLineRow, "state" | "decision" | "line_class">): boolean {
  return l.state === "open" && l.line_class === "product" && (l.decision === "needs_approval" || l.decision === "apply");
}

export interface PriceCompare {
  /** which price the numbers are for */
  what: "ingredient" | "product";
  now: number | null;
  invoice: number | null;
  move: PriceMove;
}
/** The app's price now against the invoice price, for the ingredient and (when linked) the ordering product. */
export function priceCompares(l: Pick<InvoiceLineRow, "old_pack_price" | "new_pack_price" | "old_product_price" | "new_product_price" | "change_pct" | "ingredient_id" | "product_id">): PriceCompare[] {
  const out: PriceCompare[] = [];
  if (l.ingredient_id && (l.old_pack_price != null || l.new_pack_price != null)) {
    out.push({ what: "ingredient", now: l.old_pack_price, invoice: l.new_pack_price, move: priceMove(l.change_pct ?? pctChange(l.old_pack_price, l.new_pack_price)) });
  }
  if (l.product_id && (l.old_product_price != null || l.new_product_price != null)) {
    out.push({ what: "product", now: l.old_product_price, invoice: l.new_product_price, move: priceMove(pctChange(l.old_product_price, l.new_product_price)) });
  }
  return out;
}

export interface TotalsStrip {
  subtotalEx: string;
  gst: string;
  totalInc: string;
  feePool: string | null;
}
export function totalsStrip(d: Pick<InvoiceDocumentRow, "subtotal_ex" | "gst_total" | "total_inc" | "fee_pool_ex">): TotalsStrip {
  return {
    subtotalEx: money(d.subtotal_ex),
    gst: money(d.gst_total),
    totalInc: money(d.total_inc),
    feePool: Math.abs(Number(d.fee_pool_ex ?? 0)) > 0 ? money(Number(d.fee_pool_ex)) : null,
  };
}

// ---------------------------------------------------------------- the changes list (and undo)

export interface ChangeView {
  id: string;
  itemName: string;
  target: InvoicePriceChangeRow["target"];
  oldPrice: number | null;
  newPrice: number | null;
  move: PriceMove;
  mode: "Auto" | "Approved";
  reverted: boolean;
}
export function changeView(c: InvoicePriceChangeRow, itemName: string): ChangeView {
  return {
    id: c.id,
    itemName,
    target: c.target,
    oldPrice: c.old_price,
    newPrice: c.new_price,
    move: priceMove(pctChange(c.old_price, c.new_price)),
    mode: c.mode === "auto" ? "Auto" : "Approved",
    reverted: c.status === "reverted",
  };
}

/** "Put $68.90 back?" (the sheet title). */
export function undoTitle(oldPrice: number | null): string {
  return oldPrice == null ? "Put The Old Price Back?" : `Put ${money(oldPrice)} Back?`;
}
/** The sentence that shows what is there now, so a person sees the effect before they tap. */
export function undoBody(c: Pick<InvoicePriceChangeRow, "kind" | "old_price" | "new_price">, itemName: string, current: number | null): string {
  if (c.kind === "price_confirmed") return `This only confirmed ${itemName} at ${money(c.new_price)}. Undoing it puts back the date it was last checked. The price stays ${money(current ?? c.new_price)}.`;
  const now = current ?? c.new_price;
  return `${itemName} is ${money(now)} now. This sets it back to ${money(c.old_price)}, where it was before the invoice.`;
}
export const FORCE_NOTE = "Someone has changed this price since the invoice set it. Setting it back will replace their change.";
