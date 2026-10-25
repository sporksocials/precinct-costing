/**
 * Invoices > To Do > Approve Prices. The prices that changed on invoices, waiting for a person: pure rules (which lines count, which
 * need a closer look, how they are grouped and described), the loader, the counts hook the To Do page uses, and the sequential
 * approver. Nothing here writes a price itself: approving calls applyLine (lib/invoice-apply.ts) one line at a time.
 *
 * What counts as a price waiting: a PRODUCT line, still open, decided needs_approval or apply, matched to an ingredient and/or an
 * ordering product, whose new price really differs from the app's, on an invoice that is not a duplicate, failed or set aside.
 * A line whose price already matches ("same", a confirmation) is never listed or counted.
 *
 * "Look closely" (never pre-ticked, listed first): a change of the auto-apply limit (5% by default) or more, an invoice that does
 * not add up, or a line with no earlier price to compare with. Everything else is pre-ticked.
 *
 * The counts and the screen read through the SAME loader (`loadApprovePrices`, `loadCheckTasks`), so a number on the To Do page
 * always equals the list behind it.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingTable } from "./change-log";
import { applyLine, sameMoney } from "./invoice-apply";
import { settingsFromRows } from "./invoice-context";
import { loadCheckTasks } from "./invoice-todo-checks";
import { limitText, tidySupplierName } from "./invoice-names";
import { INVOICE_SETTING_KEYS, DEFAULT_INVOICE_SETTINGS, type DocStatus, type InvoiceDocumentRow, type InvoiceLineRow } from "./invoice-types";
import { readLine } from "./invoice-data";
import { NOT_COUNTED } from "./invoice-view";
import { getSupabaseBrowser } from "./supabase/client";
import { useStore } from "./store";

/** Two prices closer than half a cent are the same price (a confirmation, not a change). */
const SAME_EPS = 0.005;

export type ApproveDoc = Pick<InvoiceDocumentRow, "id" | "venue_id" | "supplier_id" | "supplier_name_read" | "invoice_number" | "invoice_date" | "page_pdf_path" | "status" | "reconciled">;

export type RowFlag = "big" | "no_price" | "unbalanced" | null;

export interface ApproveRow {
  line: InvoiceLineRow;
  doc: ApproveDoc;
  supplierKey: string;
  supplierName: string;
  /** the price shown: the ingredient's pack price when the line has one that changes, else the ordering price (inc GST) */
  target: "ingredient" | "product";
  oldPrice: number | null;
  newPrice: number;
  /** signed fraction of the shown price, null when there is no earlier price */
  pct: number | null;
  /** signed dollars of the shown price */
  dollars: number | null;
  /** the second price on the line (the ordering price when the ingredient is shown), for a quiet extra line */
  other: { label: string; oldPrice: number | null; newPrice: number } | null;
  /** the largest |change| across both prices, the one the limit is tested against */
  maxPct: number | null;
  flag: RowFlag;
}

const num = (v: unknown): number | null => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

/** Does this price really change? A missing earlier price counts as a change (there is a new price to set). */
export function priceDiffers(oldP: unknown, newP: unknown): boolean {
  const n = num(newP);
  if (n === null) return false;
  const o = num(oldP);
  return o === null || Math.abs(n - o) >= SAME_EPS;
}

/** (new - old) / old, or null when there is no usable earlier price. */
export function fractionChange(oldP: unknown, newP: unknown): number | null {
  const o = num(oldP), n = num(newP);
  return o === null || n === null || !(o > 0) ? null : (n - o) / o;
}

/** Is this change at or over the limit? Rounded so 5.0% is 5%, not 4.99999%. */
export function overLimit(pct: number | null, limit: number): boolean {
  return pct !== null && Math.round(Math.abs(pct) * 1e6) / 1e6 >= limit;
}

/** The line waits on a person with a price that differs. The document test is separate (see `docCounts`). */
export function isPriceLine(l: Pick<InvoiceLineRow, "line_class" | "state" | "decision" | "ingredient_id" | "product_id" | "old_pack_price" | "new_pack_price" | "old_product_price" | "new_product_price">): boolean {
  if (l.line_class !== "product" || l.state !== "open") return false;
  if (l.decision !== "needs_approval" && l.decision !== "apply") return false;
  return (!!l.ingredient_id && priceDiffers(l.old_pack_price, l.new_pack_price)) || (!!l.product_id && priceDiffers(l.old_product_price, l.new_product_price));
}

export const docIsLive = (status: DocStatus | undefined): boolean => status !== undefined && !NOT_COUNTED.includes(status);

export function buildApproveRow(line: InvoiceLineRow, doc: ApproveDoc, supplierName: string, limit: number): ApproveRow | null {
  if (!docIsLive(doc.status) || !isPriceLine(line)) return null;
  const ing = !!line.ingredient_id && priceDiffers(line.old_pack_price, line.new_pack_price);
  const prod = !!line.product_id && priceDiffers(line.old_product_price, line.new_product_price);
  const ingT = ing ? { oldPrice: num(line.old_pack_price), newPrice: num(line.new_pack_price)! } : null;
  const prodT = prod ? { oldPrice: num(line.old_product_price), newPrice: num(line.new_product_price)! } : null;
  const main = ingT ?? prodT!;
  const second = ingT && prodT ? { label: "Ordering price (inc GST)", ...prodT } : null;
  const pcts = [ingT, prodT].filter((t): t is NonNullable<typeof t> => !!t).map((t) => fractionChange(t.oldPrice, t.newPrice));
  const known = pcts.filter((p): p is number => p !== null);
  const maxPct = known.length ? known.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a)) : null;
  const noPrice = pcts.some((p) => p === null);
  const flag: RowFlag = overLimit(maxPct, limit) ? "big" : noPrice ? "no_price" : !doc.reconciled ? "unbalanced" : null;
  const key = doc.supplier_id ?? `name:${tidySupplierName(doc.supplier_name_read).toLowerCase()}`;
  return {
    line,
    doc,
    supplierKey: key,
    supplierName,
    target: ingT ? "ingredient" : "product",
    oldPrice: main.oldPrice,
    newPrice: main.newPrice,
    pct: fractionChange(main.oldPrice, main.newPrice),
    dollars: main.oldPrice === null ? null : Math.round((main.newPrice - main.oldPrice) * 10000) / 10000,
    other: second,
    maxPct,
    flag,
  };
}

/** Looks closer first (biggest change first), then the ordinary ones A to Z by what the invoice calls them. */
export function sortRows(rows: readonly ApproveRow[]): ApproveRow[] {
  return [...rows].sort((a, b) => {
    if ((a.flag !== null) !== (b.flag !== null)) return a.flag !== null ? -1 : 1;
    if (a.flag !== null) return Math.abs(b.maxPct ?? Infinity) - Math.abs(a.maxPct ?? Infinity) || a.line.description.localeCompare(b.line.description);
    return a.line.description.localeCompare(b.line.description) || a.line.line_no - b.line.line_no;
  });
}

export interface ApproveGroup {
  key: string;
  name: string;
  rows: ApproveRow[];
  /** rows that need a closer look */
  flagged: number;
  /** the rows under the limit (what "Approve All Under 5%" approves) */
  easy: ApproveRow[];
}

/** One group per supplier, the groups with something to look at first, then A to Z. */
export function groupBySupplier(rows: readonly ApproveRow[]): ApproveGroup[] {
  const by = new Map<string, ApproveRow[]>();
  for (const r of rows) by.set(r.supplierKey, [...(by.get(r.supplierKey) ?? []), r]);
  const groups = [...by.entries()].map(([key, list]): ApproveGroup => {
    const sorted = sortRows(list);
    return { key, name: list[0].supplierName, rows: sorted, flagged: sorted.filter((r) => r.flag !== null).length, easy: sorted.filter((r) => r.flag === null) };
  });
  return groups.sort((a, b) => (a.flagged > 0) !== (b.flagged > 0) ? (a.flagged > 0 ? -1 : 1) : a.name.localeCompare(b.name));
}

/** The ids ticked when the screen opens: everything that needs no closer look. */
export const defaultSelection = (rows: readonly ApproveRow[], isStale: (r: ApproveRow) => boolean = () => false): Set<string> =>
  new Set(rows.filter((r) => r.flag === null && !isStale(r)).map((r) => r.line.id));

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
export const pricesWord = (n: number) => plural(n, "price", "prices");

/** "46 prices changed since the last invoices. 41 are under 5%." */
export function approveSummary(rows: readonly ApproveRow[], limit: number): string {
  const n = rows.length;
  const small = rows.filter((r) => !overLimit(r.maxPct, limit)).length;
  const head = `${pricesWord(n)} changed since the last invoices.`;
  const l = limitText(limit);
  if (n === 0) return "No prices are waiting.";
  if (small === n) return `${head} ${n === 1 ? `It is under ${l}.` : `All are under ${l}.`}`;
  if (small === 0) return `${head} ${n === 1 ? `It is ${l} or more.` : `All are ${l} or more.`}`;
  return `${head} ${small} ${small === 1 ? "is" : "are"} under ${l}.`;
}

/** The warning above the list, or null when nothing needs a closer look. */
export function lookCloselyText(rows: readonly ApproveRow[], limit: number): string | null {
  const big = rows.filter((r) => r.flag === "big").length;
  const other = rows.filter((r) => r.flag === "no_price" || r.flag === "unbalanced").length;
  const l = limitText(limit);
  if (big && !other) return `${big === 1 ? "This 1 price changed" : `These ${big} changed`} by ${l} or more. Check ${big === 1 ? "it" : "them"} before approving.`;
  if (!big && other) return `${other === 1 ? "This 1 price needs" : `These ${other} need`} a closer look. Check ${other === 1 ? "it" : "them"} before approving.`;
  if (big && other) return `${big + other} prices need a closer look: ${big} changed by ${l} or more and ${other} more ${other === 1 ? "has" : "have"} a problem noted. Check them before approving.`;
  return null;
}

export const FLAG_WORD: Record<Exclude<RowFlag, null>, string> = {
  big: "Big Change",
  no_price: "No Earlier Price",
  unbalanced: "Invoice Does Not Add Up",
};

/** The biggest change among rows (by |percent|), for the confirm sheet. */
export function biggestChange(rows: readonly ApproveRow[]): ApproveRow | null {
  let best: ApproveRow | null = null;
  for (const r of rows) if (r.pct !== null && (!best || Math.abs(r.pct) > Math.abs(best.pct ?? 0))) best = r;
  return best;
}

// ---------------------------------------------------------------- the loader (shared by the screen and the counts)

const PAGE_SIZE = 1000;
const CHUNK = 80;
const DOC_COLS = "id,venue_id,supplier_id,supplier_name_read,invoice_number,invoice_date,page_pdf_path,status,reconciled";

export interface ApproveLoad {
  /** the invoice tables are not in the database yet */
  missing: boolean;
  rows: ApproveRow[];
  /** invoice_auto_apply_pct as a fraction (default 0.05) */
  limit: number;
}

/** Every price waiting for approval, built into rows. `venueId` null means all venues. Throws on a real failure. */
export async function loadApprovePrices(sb: SupabaseClient, venueId: number | null): Promise<ApproveLoad> {
  const none: ApproveLoad = { missing: false, rows: [], limit: DEFAULT_INVOICE_SETTINGS.autoApplyPct };
  const lines: InvoiceLineRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    let q = sb.from("invoice_lines").select("*").eq("line_class", "product").eq("state", "open").in("decision", ["needs_approval", "apply"]);
    if (venueId != null) q = q.eq("venue_id", venueId);
    const { data, error } = await q.order("id", { ascending: true }).range(from, from + PAGE_SIZE - 1);
    if (error) {
      if (isMissingTable(error)) return { ...none, missing: true };
      throw new Error(error.message);
    }
    const page = (data ?? []).map(readLine);
    lines.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  const waiting = lines.filter(isPriceLine);
  if (waiting.length === 0) return none;

  const docIds = [...new Set(waiting.map((l) => l.document_id))];
  const docs: ApproveDoc[] = [];
  for (let i = 0; i < docIds.length; i += CHUNK) {
    const { data, error } = await sb.from("invoice_documents").select(DOC_COLS).in("id", docIds.slice(i, i + CHUNK));
    if (error) throw new Error(error.message);
    docs.push(...((data ?? []) as unknown as ApproveDoc[]));
  }
  const supplierIds = [...new Set(docs.map((d) => d.supplier_id).filter((x): x is string => !!x))];
  const names = new Map<string, string>();
  for (let i = 0; i < supplierIds.length; i += CHUNK) {
    const { data, error } = await sb.from("invoice_suppliers").select("id,name").in("id", supplierIds.slice(i, i + CHUNK));
    if (error) throw new Error(error.message);
    for (const s of (data ?? []) as { id: string; name: string }[]) names.set(s.id, s.name);
  }
  let limit = DEFAULT_INVOICE_SETTINGS.autoApplyPct;
  try {
    const { data } = await sb.from("cost_settings").select("key,value").eq("key", INVOICE_SETTING_KEYS.autoApplyPct);
    limit = settingsFromRows((data ?? []) as { key: string; value: unknown }[]).settings.autoApplyPct;
  } catch {
    /* the default limit is the safe answer */
  }
  const docById = new Map(docs.map((d) => [d.id, d]));
  const rows: ApproveRow[] = [];
  for (const l of waiting) {
    const doc = docById.get(l.document_id);
    if (!doc) continue;
    const name = (doc.supplier_id ? names.get(doc.supplier_id) : undefined) ?? (tidySupplierName(doc.supplier_name_read) || "Unknown supplier");
    const row = buildApproveRow(l, doc, name, limit);
    if (row) rows.push(row);
  }
  return { missing: false, rows, limit };
}

// ---------------------------------------------------------------- settling the matching question

/**
 * A line waiting for approval may also carry an open "big_change" question (an older way of asking the same thing). Approving or
 * skipping the line answers it, so the same thing is never asked twice. Best effort: the price is already applied or skipped, and
 * a failure here only leaves a question that the next re-check clears.
 */
export async function settleBigChange(sb: SupabaseClient, lineId: string, optionId: "approve_change" | "reject_change", actor: string): Promise<void> {
  try {
    await sb
      .from("invoice_questions")
      .update({ status: "answered", answer: { option_id: optionId }, answered_by: actor, answered_at: new Date().toISOString() })
      .eq("line_id", lineId)
      .eq("kind", "big_change")
      .eq("status", "open");
  } catch {
    /* see above */
  }
}

// ---------------------------------------------------------------- approving, one at a time

export interface ApproveFailure {
  row: ApproveRow;
  message: string;
}
export interface ApproveOutcome {
  done: ApproveRow[];
  failed: ApproveFailure[];
}

/**
 * Approves the rows ONE AT A TIME (never together), reporting progress after each. A line that fails (the app's price moved since,
 * the invoice was read with an unclear pack) is listed with its plain message and the rest carry on. Each success settles the
 * line's big_change question, if it has one.
 */
export async function approveSequentially(
  sb: SupabaseClient,
  rows: readonly ApproveRow[],
  actor: string,
  opts: { onProgress?: (done: number, total: number) => void; apply?: typeof applyLine; settle?: typeof settleBigChange } = {},
): Promise<ApproveOutcome> {
  const apply = opts.apply ?? applyLine;
  const settle = opts.settle ?? settleBigChange;
  const out: ApproveOutcome = { done: [], failed: [] };
  let n = 0;
  for (const row of rows) {
    try {
      const r = await apply(sb, { lineId: row.line.id, actor, mode: "approved" });
      if (r.ok) {
        out.done.push(row);
        await settle(sb, row.line.id, "approve_change", actor);
      } else out.failed.push({ row, message: r.message || "That price could not be applied." });
    } catch (e) {
      out.failed.push({ row, message: e instanceof Error ? e.message : "That price could not be applied." });
    }
    opts.onProgress?.(++n, rows.length);
  }
  return out;
}

/** "Updated 41 prices. 5 left to check. Undo is on each item's price history." */
export function outcomeText(o: ApproveOutcome, leftToCheck: number): string {
  const parts: string[] = [];
  if (o.done.length) parts.push(`Updated ${pricesWord(o.done.length)}.`);
  else parts.push("No prices were updated.");
  if (o.failed.length) parts.push(`${plural(o.failed.length, "price", "prices")} could not be updated.`);
  if (leftToCheck > 0) parts.push(`${leftToCheck} left to check.`);
  if (o.done.length) parts.push("Undo is on each item's price history.");
  return parts.join(" ");
}

/** True when the app's price for the ingredient has moved since the invoice was read, so approving would be refused. */
export function isStaleIngredient(row: ApproveRow, currentPackPrice: number | null | undefined): boolean {
  if (row.target !== "ingredient" || currentPackPrice == null) return false;
  return !sameMoney(currentPackPrice, row.line.old_pack_price);
}

// ---------------------------------------------------------------- the counts for the To Do page

export interface ApproveCounts {
  /** prices waiting for approval (the rows of Approve Prices) */
  prices: number;
  /** things to check (the tasks of Check These) */
  checks: number;
}

/** Counts from the SAME loaders the two screens use. An error or a missing table gives null data, never a throw. */
export async function loadApproveCounts(sb: SupabaseClient, venueId: number | null): Promise<ApproveCounts | null> {
  try {
    const [p, c] = await Promise.all([loadApprovePrices(sb, venueId), loadCheckTasks(sb, venueId)]);
    if (p.missing || c.missing) return null;
    return { prices: p.rows.length, checks: c.tasks.length };
  } catch {
    return null;
  }
}

/** `venue` is a venue slug, or null for all venues. Reloads when the tab comes back into view. */
export function useApproveCounts(venue: string | null): { data: ApproveCounts | null; loading: boolean; reload: () => void } {
  const { venues } = useStore();
  const known = venue === null ? true : venues.some((v) => v.slug === venue);
  const venueId = venue === null ? null : (venues.find((v) => v.slug === venue)?.id ?? null);
  const [data, setData] = useState<ApproveCounts | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const run = useCallback(async () => {
    if (!known) return;
    const mine = ++seq.current;
    const d = await loadApproveCounts(getSupabaseBrowser(), venueId);
    if (mine !== seq.current) return;
    setData(d);
    setLoading(false);
  }, [known, venueId]);
  useEffect(() => {
    setLoading(true);
    void run();
    const onShow = () => {
      if (document.visibilityState === "visible") void run();
    };
    document.addEventListener("visibilitychange", onShow);
    return () => {
      seq.current++;
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [run]);
  const reload = useCallback(() => void run(), [run]);
  return { data, loading, reload };
}
