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
/** The last 30 days including today. */
export function last30Range(today: string): DateRange {
  return { from: addDays(today, -29), to: today };
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
const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** "20 Oct" from a yyyy-mm-dd date or an ISO timestamp read in Brisbane; the year is added only when `today` is in another year. "" when unreadable. */
export function shortDay(v: string | null | undefined, today?: string): string {
  if (!v) return "";
  const d = v.length <= 10 ? v : brisbaneDate(v);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return "";
  const [y, m, day] = d.split("-").map(Number);
  const base = `${day} ${MON[m - 1]}`;
  return today && today.slice(0, 4) !== String(y) ? `${base} ${y}` : base;
}

/** The heading for a day in a list: "Today", "Yesterday", "Mon 19 Oct" (with the year when it is not this year). */
export function dayHeading(date: string, today: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "Earlier";
  if (date === today) return "Today";
  if (date === addDays(today, -1)) return "Yesterday";
  return `${DOW[weekdayMon0(date)]} ${shortDay(date, today)}`;
}

// ---------------------------------------------------------------- counts

/** A document that is not a real, live invoice: it never counts as "processed". */
export const NOT_COUNTED: readonly DocStatus[] = ["duplicate", "failed", "ignored"];

export interface DocLite {
  id: string;
  status: DocStatus;
  created_at: string;
  /** null until the reader has read the invoice: the scan is split into placeholder documents first */
  read_model?: string | null;
}

/**
 * A document the reader has found in a scan but not read yet: when a PDF is sorted, every invoice in it gets a placeholder
 * (needs_review, no read_model) and they are read one per step. Statements and other non-invoices are finished without a read,
 * so they are not "unread": their status is already something other than needs_review.
 */
export function isUnread(d: { status: DocStatus; read_model?: string | null }): boolean {
  return d.status === "needs_review" && !d.read_model;
}
export interface ChangeLite {
  kind: InvoicePriceChangeRow["kind"];
  status: InvoicePriceChangeRow["status"];
  applied_at: string;
}

export interface HomeCounts {
  processed: number;
  updated: number;
  /** invoices found in scans but not read yet (they are not in `processed`) */
  reading: number;
  /** nothing has ever been filed */
  firstRun: boolean;
}

/**
 * The Home card's and the page's counts (Troy's rule): invoices processed = documents created in the period that are not duplicate,
 * failed or ignored and have been READ; prices updated = price_change rows still applied in the period (a confirmation is not an
 * update). What waits on a person comes from the To Do count hooks, never from here, so the card and the page cannot disagree.
 */
export function homeCounts(input: { docs: readonly DocLite[]; changes: readonly ChangeLite[]; range: DateRange; totalDocs: number }): HomeCounts {
  const processed = input.docs.filter((d) => !NOT_COUNTED.includes(d.status) && !isUnread(d) && inRange(brisbaneDate(d.created_at), input.range)).length;
  const reading = input.docs.filter((d) => !NOT_COUNTED.includes(d.status) && isUnread(d)).length;
  const updated = input.changes.filter((c) => c.kind === "price_change" && c.status === "applied" && inRange(brisbaneDate(c.applied_at), input.range)).length;
  return { processed, updated, reading, firstRun: input.totalDocs === 0 && reading === 0 };
}

export function invoicesWord(n: number): string {
  return n === 1 ? "Invoice Processed" : "Invoices Processed";
}
export function pricesWord(n: number): string {
  return n === 1 ? "Price Updated" : "Prices Updated";
}

export const FIRST_RUN_TEXT = "No invoices yet. Scan one and it appears here.";
const countOf = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The one status sentence at the top of the Invoices page. A zero is left out, except the first clause. */
export function statusSentence(c: Pick<HomeCounts, "processed" | "updated" | "reading" | "firstRun">): string {
  if (c.firstRun) return FIRST_RUN_TEXT;
  const parts = [`${countOf(c.processed, "invoice", "invoices")} read this week.`];
  if (c.reading > 0) parts.push(`${c.reading} ${c.reading === 1 ? "is" : "are"} still being read.`);
  if (c.updated > 0) parts.push(`${countOf(c.updated, "price", "prices")} updated.`);
  return parts.join(" ");
}
/** The quiet Home line when nothing waits: "29 invoices read this week, 0 prices updated". */
export function caughtUpLine(c: Pick<HomeCounts, "processed" | "updated">): string {
  return `${countOf(c.processed, "invoice", "invoices")} read this week, ${countOf(c.updated, "price", "prices")} updated`;
}

/** What waits on a person, as the two To Do count hooks report it. */
export interface TodoNumbers {
  items: number;
  prices: number;
  checks: number;
}
export const todoTotal = (t: TodoNumbers): number => t.items + t.prices + t.checks;
/** "41 items to match, 46 prices to approve, 2 to check"; only the parts above zero. Empty when nothing waits. */
export function todoPhrase(t: TodoNumbers): string {
  const parts: string[] = [];
  if (t.items > 0) parts.push(`${countOf(t.items, "item", "items")} to match`);
  if (t.prices > 0) parts.push(`${countOf(t.prices, "price", "prices")} to approve`);
  if (t.checks > 0) parts.push(`${t.checks} to check`);
  return parts.join(", ");
}
/** "To Do (46)"; no number at zero. */
export const todoLabel = (n: number): string => (n > 0 ? `To Do (${n})` : "To Do");

// ---------------------------------------------------------------- the list

/** The documents the list keeps out of sight until someone asks. */
export type HiddenKind = "duplicate" | "reading" | "failed" | "ignored";
export function hiddenKind(d: { status: DocStatus; read_model?: string | null }): HiddenKind | null {
  if (d.status === "duplicate") return "duplicate";
  if (d.status === "ignored") return "ignored";
  if (d.status === "failed") return "failed";
  return isUnread(d) ? "reading" : null;
}
export type HiddenCounts = Record<HiddenKind, number>;
export function hiddenCounts(docs: readonly { status: DocStatus; read_model?: string | null }[]): HiddenCounts {
  const out: HiddenCounts = { duplicate: 0, reading: 0, failed: 0, ignored: 0 };
  for (const d of docs) {
    const k = hiddenKind(d);
    if (k) out[k]++;
  }
  return out;
}
const joinWords = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
/** "3 duplicates and 7 still being read are hidden." ("" when nothing is hidden) */
export function hiddenSentence(c: HiddenCounts): string {
  const parts: string[] = [];
  if (c.duplicate) parts.push(countOf(c.duplicate, "duplicate", "duplicates"));
  if (c.reading) parts.push(`${c.reading} still being read`);
  if (c.failed) parts.push(`${c.failed} that could not be read`);
  if (c.ignored) parts.push(`${c.ignored} ignored`);
  if (!parts.length) return "";
  const total = c.duplicate + c.reading + c.failed + c.ignored;
  return `${joinWords(parts)} ${total === 1 ? "is" : "are"} hidden.`;
}
/** The plain label on a revealed hidden document. `originalNumber` is the invoice number a duplicate copies, when known. */
export function hiddenLabel(kind: HiddenKind, originalNumber?: string | null): string {
  switch (kind) {
    case "duplicate":
      return originalNumber && originalNumber.trim() ? `Duplicate of #${originalNumber.trim()}` : "Duplicate";
    case "reading":
      return "Still being read";
    case "failed":
      return "Could not read";
    case "ignored":
      return "Ignored";
  }
}

/** What an invoice still asks of a person, and what it already did. Built from its lines and open questions (never from the document status). */
export interface DocOutcomeStats {
  /** product lines that need matching to an app item */
  match: number;
  /** product lines with a changed price waiting for a tap */
  approve: number;
  /** open questions that are not about matching (the odd ones) */
  checks: number;
  /** prices written by this invoice */
  changed: number;
  /** product lines whose price already matches the app */
  upToDate: number;
}
export const NO_OUTCOME: DocOutcomeStats = { match: 0, approve: 0, checks: 0, changed: 0, upToDate: 0 };

export interface LineLite {
  document_id: string;
  line_class: LineClass;
  match_state: InvoiceLineRow["match_state"];
  decision: InvoiceLineRow["decision"];
  state: InvoiceLineRow["state"];
}
const MATCH_QUESTIONS = new Set(["unmatched_line", "ambiguous_match"]);

export function outcomeStats(lines: readonly LineLite[], questions: readonly { document_id: string; kind: string }[]): Map<string, DocOutcomeStats> {
  const m = new Map<string, DocOutcomeStats>();
  const get = (id: string) => {
    let s = m.get(id);
    if (!s) {
      s = { ...NO_OUTCOME };
      m.set(id, s);
    }
    return s;
  };
  for (const l of lines) {
    if (l.line_class !== "product") continue;
    const s = get(l.document_id);
    if (l.state === "applied") s.changed++;
    else if (l.state === "confirmed" || (l.state === "open" && l.decision === "same")) s.upToDate++;
    else if (l.state === "open" && (l.match_state === "unmatched" || l.match_state === "ambiguous")) s.match++;
    else if (l.state === "open" && (l.decision === "needs_approval" || l.decision === "apply")) s.approve++;
  }
  for (const q of questions) if (!MATCH_QUESTIONS.has(q.kind)) get(q.document_id).checks++;
  return m;
}
export const outcomeFor = (m: Map<string, DocOutcomeStats>, id: string): DocOutcomeStats => m.get(id) ?? NO_OUTCOME;

export type StatusIcon = "check" | "target" | "dash" | "copy" | "x" | "ban";
export interface OutcomeView {
  word: string;
  /** warn = waits on a person (amber token), danger = could not be read; neutral is plain text. The word and the icon always go with it. */
  tone: "neutral" | "warn" | "danger";
  icon: StatusIcon;
}
/** @deprecated name kept for the shared label component */
export type StatusView = OutcomeView;

/**
 * ONE short phrase for an invoice in the list, in plain words. What waits on a person comes first (matching, then approving, then the
 * odd ones); then what the invoice already did; then "Nothing to update".
 */
export function outcomeView(doc: { status: DocStatus; reconciled: boolean; read_model?: string | null }, s: DocOutcomeStats): OutcomeView {
  const kind = hiddenKind(doc);
  if (kind) return { word: hiddenLabel(kind), tone: kind === "failed" ? "danger" : "neutral", icon: kind === "duplicate" ? "copy" : kind === "failed" ? "x" : kind === "ignored" ? "ban" : "dash" };
  if (s.match > 0) return { word: `Match ${countOf(s.match, "item", "items")}`, tone: "warn", icon: "target" };
  if (s.approve > 0) return { word: `Approve ${countOf(s.approve, "price", "prices")}`, tone: "warn", icon: "target" };
  if (s.checks > 0) return { word: `Check ${s.checks} ${s.checks === 1 ? "thing" : "things"}`, tone: "warn", icon: "target" };
  if (!doc.reconciled && doc.status === "needs_review") return { word: "Check 1 thing", tone: "warn", icon: "target" };
  if (s.changed > 0) return { word: `${countOf(s.changed, "price", "prices")} changed`, tone: "neutral", icon: "check" };
  if (s.upToDate > 0) return { word: `${countOf(s.upToDate, "price", "prices")} up to date`, tone: "neutral", icon: "check" };
  return { word: "Nothing to update", tone: "neutral", icon: "dash" };
}

/** "Daniel Street Fish Market" for a title line; a credit note says so. */
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

/** The day an invoice sits under in the list: its own date, else the day it was filed (Brisbane). */
export function docDay(d: Pick<InvoiceDocumentRow, "invoice_date" | "created_at">): string {
  return d.invoice_date && /^\d{4}-\d{2}-\d{2}/.test(d.invoice_date) ? d.invoice_date.slice(0, 10) : brisbaneDate(d.created_at);
}

/** Newest invoice date first, then newest filed. */
export function sortDocs<T extends Pick<InvoiceDocumentRow, "invoice_date" | "created_at">>(docs: readonly T[]): T[] {
  return [...docs].sort((a, b) => (b.invoice_date ?? "").localeCompare(a.invoice_date ?? "") || b.created_at.localeCompare(a.created_at));
}

/** Documents for one venue (null = all), or whose supplier or number contains `query`. */
export function filterDocs<T extends Pick<InvoiceDocumentRow, "venue_id" | "invoice_number">>(docs: readonly T[], f: { venueId: number | null; query: string; titleOf: (d: T) => string }): T[] {
  const q = f.query.trim().toLowerCase().replace(/^#/, "");
  return docs.filter((d) => {
    if (f.venueId != null && d.venue_id !== f.venueId) return false;
    if (!q) return true;
    return f.titleOf(d).toLowerCase().includes(q) || (d.invoice_number ?? "").toLowerCase().includes(q);
  });
}

/** Groups already-sorted documents under their day headings, keeping order. */
export function groupByDay<T extends Pick<InvoiceDocumentRow, "invoice_date" | "created_at">>(docs: readonly T[], today: string): { heading: string; docs: T[] }[] {
  const out: { heading: string; docs: T[] }[] = [];
  for (const d of docs) {
    const heading = dayHeading(docDay(d), today);
    const last = out[out.length - 1];
    if (last && last.heading === heading) last.docs.push(d);
    else out.push({ heading, docs: [d] });
  }
  return out;
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

/** "+2.8%" or "-1.1%" (a hyphen minus, never a dash), "" when there is no usable move. */
export function signedPct(pct: number | null | undefined): string {
  const m = priceMove(pct);
  if (m.dir === "none") return "";
  if (m.dir === "same") return "0%";
  return `${m.dir === "up" ? "+" : "-"}${m.text.replace(/^(Up|Down) /, "")}`;
}

export type LineKind = "matches" | "changed" | "waiting" | "skipped" | "put_back" | "not_in_app" | "needs_matching" | "nothing";
export interface LineStatus extends OutcomeView {
  kind: LineKind;
}
/** ONE plain status per product line: Matches, Changed +2.8%, Changed +2.8% (waiting), Not in the app, Needs matching. */
export function lineStatus(l: Pick<InvoiceLineRow, "state" | "decision" | "match_state" | "change_pct" | "old_pack_price" | "new_pack_price" | "old_product_price" | "new_product_price">): LineStatus {
  const pct = l.change_pct ?? pctChange(l.old_pack_price, l.new_pack_price) ?? pctChange(l.old_product_price, l.new_product_price);
  const moved = signedPct(pct);
  const changed = moved && moved !== "0%" ? `Changed ${moved}` : "Changed";
  switch (l.state) {
    case "applied":
      return { kind: "changed", word: changed, tone: "neutral", icon: "check" };
    case "confirmed":
      return { kind: "matches", word: "Matches", tone: "neutral", icon: "check" };
    case "approved_skip":
      return { kind: "skipped", word: "Skipped", tone: "neutral", icon: "dash" };
    case "reverted":
      return { kind: "put_back", word: "Put back", tone: "neutral", icon: "dash" };
    case "ignored":
      return { kind: "not_in_app", word: "Not in the app", tone: "neutral", icon: "dash" };
    case "open":
      break;
  }
  if (l.match_state === "ignored") return { kind: "not_in_app", word: "Not in the app", tone: "neutral", icon: "dash" };
  if (l.match_state === "unmatched" || l.match_state === "ambiguous") return { kind: "needs_matching", word: "Needs matching", tone: "warn", icon: "target" };
  if (l.decision === "needs_approval" || l.decision === "apply") return { kind: "waiting", word: `${changed} (waiting)`, tone: "warn", icon: "target" };
  if (l.decision === "same") return { kind: "matches", word: "Matches", tone: "neutral", icon: "check" };
  return { kind: "nothing", word: "Nothing to update", tone: "neutral", icon: "dash" };
}

/** The one sentence at the top of an invoice: what happened to its prices. */
export function detailSentence(lines: readonly Parameters<typeof lineStatus>[0][]): string {
  const k: Record<LineKind, number> = { matches: 0, changed: 0, waiting: 0, skipped: 0, put_back: 0, not_in_app: 0, needs_matching: 0, nothing: 0 };
  for (const l of lines) k[lineStatus(l).kind]++;
  const checked = k.matches + k.changed + k.waiting + k.skipped + k.put_back;
  if (checked + k.needs_matching + k.not_in_app === 0) return "No prices were read from this invoice.";
  const out: string[] = [];
  if (checked > 0) {
    const bits: string[] = [];
    if (k.matches) bits.push(`${k.matches} ${k.matches === 1 ? "matches" : "match"}`);
    if (k.changed) bits.push(`${k.changed} ${k.changed === 1 ? "was" : "were"} updated`);
    if (k.waiting) bits.push(`${k.waiting} changed and ${k.waiting === 1 ? "waits" : "wait"} for approval`);
    if (k.skipped) bits.push(`${k.skipped} ${k.skipped === 1 ? "was" : "were"} skipped`);
    if (k.put_back) bits.push(`${k.put_back} ${k.put_back === 1 ? "was" : "were"} put back`);
    out.push(`${checked} ${checked === 1 ? "price was" : "prices were"} checked: ${bits.join(", ")}.`);
  }
  if (k.needs_matching > 0) out.push(`${countOf(k.needs_matching, "item still needs", "items still need")} matching.`);
  if (k.not_in_app > 0) out.push(`${countOf(k.not_in_app, "item is", "items are")} not in the app.`);
  return out.join(" ");
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
