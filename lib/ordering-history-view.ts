/**
 * Ordering module: pure view helpers for the History screens (counts list, count detail with Compare To Previous Count, a
 * product's story across weeks, orders list) and the Ordering home status. No React, no database. All dates are Brisbane
 * time (Troy's rule); Brisbane has no daylight saving, so a fixed +10:00 offset is exact and makes the output the same on every
 * machine. Per venue: callers pass one venue's rows.
 */
import { isCounted, plainText, qtyText, suggestOrder } from "./ordering";
import type { OrderingCategory, OrderingCountLine, OrderingCountSession, OrderingOrder, OrderingOrderLine, OrderingProduct, OrderingSupplier } from "./ordering-types";

/* ------------------------------------------------------------------ Brisbane dates */

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const BRISBANE_OFFSET_MS = 10 * 3600_000;

function brisbaneParts(iso: string | null | undefined): { y: number; mo: number; d: number; wd: number; h: number; mi: number } | null {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return null;
  const x = new Date(t + BRISBANE_OFFSET_MS);
  return { y: x.getUTCFullYear(), mo: x.getUTCMonth(), d: x.getUTCDate(), wd: x.getUTCDay(), h: x.getUTCHours(), mi: x.getUTCMinutes() };
}

/** "Mon 28 Sep" (the year is added when it is not the current Brisbane year: "Mon 28 Sep 2026"). Empty text for a missing date. */
export function dayLabel(iso: string | null | undefined, now: Date = new Date()): string {
  const p = brisbaneParts(iso);
  if (!p) return "";
  const cur = brisbaneParts(now.toISOString())?.y;
  return `${WEEKDAYS[p.wd]} ${p.d} ${MONTHS[p.mo]}${cur === p.y ? "" : ` ${p.y}`}`;
}

/** "Mon 28 Sep 2026", always with the year (for text that is copied out). */
export function dayLabelFull(iso: string | null | undefined): string {
  const p = brisbaneParts(iso);
  return p ? `${WEEKDAYS[p.wd]} ${p.d} ${MONTHS[p.mo]} ${p.y}` : "";
}

/** "10:30 am" in Brisbane time. */
export function timeLabel(iso: string | null | undefined): string {
  const p = brisbaneParts(iso);
  if (!p) return "";
  const h12 = p.h % 12 === 0 ? 12 : p.h % 12;
  return `${h12}:${String(p.mi).padStart(2, "0")} ${p.h < 12 ? "am" : "pm"}`;
}

/** "Mon 28 Sep, 10:30 am". */
export function dayTimeLabel(iso: string | null | undefined, now?: Date): string {
  const d = dayLabel(iso, now);
  const t = timeLabel(iso);
  return d && t ? `${d}, ${t}` : d;
}

/* ------------------------------------------------------------------ counts list */

/** Who counted: the old workbook shows as "Sheet import", otherwise the person who finished it, else who started it. */
export function countWho(s: Pick<OrderingCountSession, "source" | "started_by" | "finalised_by">, nameOf: (email: string | null | undefined) => string | null): string {
  if (s.source === "sheet-import") return "Sheet import";
  return nameOf(s.finalised_by ?? s.started_by) ?? "Not recorded";
}

/** Counted products per session: lines with a quantity in at least one place. */
export function tallyBySession(lines: readonly Pick<OrderingCountLine, "session_id" | "store_qty" | "second_qty">[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const l of lines) if (isCounted(l)) out.set(l.session_id, (out.get(l.session_id) ?? 0) + 1);
  return out;
}

export interface SessionRow {
  id: string;
  dateLabel: string;
  timeLabel: string;
  who: string;
  /** null while the tallies are still loading */
  counted: number | null;
  total: number;
  inProgress: boolean;
  statusLabel: "Finalised" | "In Progress";
  /** "42 of 118 counted" */
  progressLabel: string;
}

/**
 * The Counts list, newest first. `total` is the venue's active products now (plus any counted product no longer active, so
 * counted never exceeds total): products added since an old count make it read lower than it was that day, which is the
 * honest limit of not storing the list on the day.
 */
export function sessionRows(
  sessions: readonly OrderingCountSession[],
  tallies: ReadonlyMap<string, number> | null,
  activeProducts: number,
  nameOf: (email: string | null | undefined) => string | null,
  now?: Date,
): SessionRow[] {
  return [...sessions]
    .sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at))
    .map((s) => {
      const counted = tallies ? tallies.get(s.id) ?? 0 : null;
      const total = Math.max(activeProducts, counted ?? 0);
      const inProgress = s.status === "in_progress";
      return {
        id: s.id,
        dateLabel: dayLabel(s.started_at, now),
        timeLabel: timeLabel(s.started_at),
        who: countWho(s, nameOf),
        counted,
        total,
        inProgress,
        statusLabel: inProgress ? "In Progress" : "Finalised",
        progressLabel: counted == null ? "" : `${counted} of ${total} counted`,
      };
    });
}

/** The session counted just before `id` (older by start time), or null for the oldest. */
export function previousSession(sessions: readonly OrderingCountSession[], id: string): OrderingCountSession | null {
  const sorted = [...sessions].sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at));
  const i = sorted.findIndex((s) => s.id === id);
  return i >= 0 ? sorted[i + 1] ?? null : null;
}

/* ------------------------------------------------------------------ count detail */

export type CountState = "Not Counted" | "Below Build To" | "At Build To" | "Over Build To";

export interface CountDetailRow {
  productId: string;
  name: string;
  unit: string;
  store: number | null;
  second: number | null;
  /** store + second place, null when not counted */
  total: number | null;
  /** Build To as it was at the count (the snapshot), else the product's current level */
  par: number | null;
  /** what was suggested to order then: Build To minus counted, rounded up to the pack multiple, 0 when at or over */
  suggested: number;
  over: number;
  state: CountState;
  /** the product is no longer active */
  inactive: boolean;
  change: CountChange | null;
}

export interface CountDetailGroup {
  categoryId: string;
  name: string;
  /** "Bar", "Coldroom" or null (Store only): the label of the second quantity */
  secondLabel: string | null;
  rows: CountDetailRow[];
}

/**
 * One count's detail: every product that has a line in the count, plus every active product that was not counted (shown as
 * Not Counted), grouped by category in shelf order. A product that has since been switched off still shows if it was counted.
 */
export function countDetailGroups(input: {
  products: readonly OrderingProduct[];
  categories: readonly OrderingCategory[];
  lines: readonly OrderingCountLine[];
}): CountDetailGroup[] {
  const { products, categories, lines } = input;
  const byProduct = new Map(lines.map((l) => [l.product_id, l]));
  const cats = [...categories].sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
  const groups: CountDetailGroup[] = [];
  for (const c of cats) {
    const rows: CountDetailRow[] = [];
    const mine = products.filter((p) => p.category_id === c.id).sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
    for (const p of mine) {
      const l = byProduct.get(p.id);
      if (!l && !p.active) continue;
      rows.push(detailRow(p, l));
    }
    if (rows.length) groups.push({ categoryId: c.id, name: c.name, secondLabel: c.second_location_label, rows });
  }
  return groups;
}

function detailRow(p: OrderingProduct, l: OrderingCountLine | undefined): CountDetailRow {
  const par = l?.par_at_count ?? p.par;
  const s = suggestOrder({ par: par ?? 0, pack_multiple: p.pack_multiple }, l?.store_qty, l?.second_qty);
  const state: CountState = s.uncounted ? "Not Counted" : s.counted != null && s.counted < (par ?? 0) ? "Below Build To" : s.over > 0 ? "Over Build To" : "At Build To";
  return {
    productId: p.id,
    name: plainText(l?.product_name) || p.name,
    unit: plainText(l?.unit_name) || p.unit_name,
    store: l?.store_qty ?? null,
    second: l?.second_qty ?? null,
    total: s.counted,
    par: par ?? null,
    suggested: s.orderQty,
    over: s.over,
    state,
    inactive: !p.active,
    change: null,
  };
}

/** Whole-venue figures for the top of a count: how many counted, below Build To, over, and the order units suggested. */
export function countHeadline(groups: readonly CountDetailGroup[]): { counted: number; uncounted: number; below: number; over: number; suggestedUnits: number } {
  let counted = 0;
  let uncounted = 0;
  let below = 0;
  let over = 0;
  let suggestedUnits = 0;
  for (const g of groups)
    for (const r of g.rows) {
      if (r.state === "Not Counted") uncounted += 1;
      else counted += 1;
      if (r.state === "Below Build To") below += 1;
      if (r.state === "Over Build To") over += 1;
      suggestedUnits += r.suggested;
    }
  return { counted, uncounted, below, over, suggestedUnits };
}

/* ------------------------------------------------------------------ compare to previous count */

export type ChangeKind = "up" | "down" | "same" | "new" | "gone" | "none";

export interface CountChange {
  kind: ChangeKind;
  /** this count's total minus the previous one (0 when either was not counted) */
  delta: number;
  prev: number | null;
  /** the words: "Up 3", "Down 2", "No change", "Not counted last time", "Not counted this time" */
  word: string;
  /** an arrow for the eye; the word always carries the meaning, so the arrow is decoration */
  arrow: "↑" | "↓" | "=" | "";
}

/** The change in one product's total between two counts. A product counted in only one of them says so in words. */
export function changeBetween(now: number | null, prev: number | null): CountChange {
  if (now == null && prev == null) return { kind: "none", delta: 0, prev: null, word: "", arrow: "" };
  if (now != null && prev == null) return { kind: "new", delta: 0, prev: null, word: "Not counted last time", arrow: "" };
  if (now == null && prev != null) return { kind: "gone", delta: 0, prev, word: `Not counted this time (was ${qtyText(prev)})`, arrow: "" };
  const delta = Math.round(((now as number) - (prev as number)) * 1e6) / 1e6;
  if (delta > 0) return { kind: "up", delta, prev, word: `Up ${qtyText(delta)}`, arrow: "↑" };
  if (delta < 0) return { kind: "down", delta, prev, word: `Down ${qtyText(-delta)}`, arrow: "↓" };
  return { kind: "same", delta: 0, prev, word: "No change", arrow: "=" };
}

/** Totals by product from a count's lines (null when the product has no quantity in either place). */
export function totalsByProduct(lines: readonly Pick<OrderingCountLine, "product_id" | "store_qty" | "second_qty">[]): Map<string, number | null> {
  const out = new Map<string, number | null>();
  for (const l of lines) out.set(l.product_id, isCounted(l) ? (l.store_qty ?? 0) + (l.second_qty ?? 0) : null);
  return out;
}

/** The same groups with `change` filled in against an earlier count's lines. */
export function withChanges(groups: readonly CountDetailGroup[], previousLines: readonly OrderingCountLine[]): CountDetailGroup[] {
  const prev = totalsByProduct(previousLines);
  return groups.map((g) => ({ ...g, rows: g.rows.map((r) => ({ ...r, change: changeBetween(r.total, prev.get(r.productId) ?? null) })) }));
}

export function changeSummary(groups: readonly CountDetailGroup[]): { up: number; down: number; same: number } {
  const out = { up: 0, down: 0, same: 0 };
  for (const g of groups)
    for (const r of g.rows) {
      if (r.change?.kind === "up") out.up += 1;
      else if (r.change?.kind === "down") out.down += 1;
      else if (r.change?.kind === "same") out.same += 1;
    }
  return out;
}

/* ------------------------------------------------------------------ copy as text */

/**
 * The count as plain text for pasting into an email or a chat: no dashes other than hyphens, one line per product.
 * With `compare` each line ends with the change since the previous count.
 */
export function countAsText(input: { venueName: string; dateLabel: string; who: string; status: string; groups: readonly CountDetailGroup[]; compare: boolean; previousLabel?: string | null }): string {
  const lines: string[] = [`${plainText(input.venueName)} stock count, ${input.dateLabel}`, `Counted by ${input.who} (${input.status})`];
  if (input.compare) lines.push(input.previousLabel ? `Compared to the count on ${input.previousLabel}` : "No earlier count to compare to");
  for (const g of input.groups) {
    lines.push("", g.name.toUpperCase());
    for (const r of g.rows) {
      if (r.state === "Not Counted") {
        lines.push(`${r.name}: not counted${input.compare && r.change?.kind === "gone" ? ` (was ${qtyText(r.change.prev ?? 0)})` : ""}`);
        continue;
      }
      const places = [`Store ${qtyText(r.store ?? 0)}`];
      if (g.secondLabel) places.push(`${g.secondLabel} ${qtyText(r.second ?? 0)}`);
      const bits = [`${r.name}: ${places.join(", ")}, total ${qtyText(r.total ?? 0)} ${plainText(r.unit)}`, `Build To ${r.par == null ? "not set" : qtyText(r.par)}`];
      bits.push(r.suggested > 0 ? `order ${qtyText(r.suggested)}` : r.over > 0 ? `over by ${qtyText(r.over)}` : "nothing to order");
      if (input.compare && r.change && r.change.kind !== "none") bits.push(r.change.word);
      lines.push(bits.join(" | "));
    }
  }
  return lines.join("\n");
}

/* ------------------------------------------------------------------ a product's story across weeks */

export type StoryPosition = "Not counted" | "At Build To" | `Under by ${string}` | `Over by ${string}`;

export interface StoryRow {
  sessionId: string;
  dateLabel: string;
  timeLabel: string;
  inProgress: boolean;
  store: number | null;
  second: number | null;
  total: number | null;
  par: number | null;
  position: StoryPosition;
  /** units ordered for this product on orders made from this count (null when none) */
  ordered: number | null;
  orderNote: string;
  /** a count that asked for an order of this product and no order for it was made: the "did we forget" flag */
  missed: boolean;
  over: number;
  belowPar: boolean;
}

/**
 * One product, one row per count that has it (newest first): what was counted, Build To then, where it stood, and what was
 * ordered from that count. `lines` are this product's count lines; `orders` and `orderLines` are the venue's orders and the
 * lines that name this product. Only orders made from a count (session_id) are matched; top-ups are not tied to a count.
 * A count brought in from the old workbook (source 'sheet-import') has no orders in the app, so it never reads as a missed order.
 */
export function productStory(input: {
  product: OrderingProduct;
  sessions: readonly OrderingCountSession[];
  lines: readonly OrderingCountLine[];
  orders: readonly Pick<OrderingOrder, "id" | "session_id" | "status">[];
  orderLines: readonly Pick<OrderingOrderLine, "order_id" | "product_id" | "ordered_qty">[];
  now?: Date;
}): StoryRow[] {
  const { product, sessions, lines, orders, orderLines, now } = input;
  const lineBySession = new Map(lines.map((l) => [l.session_id, l]));
  const ordersBySession = new Map<string, Pick<OrderingOrder, "id" | "session_id" | "status">[]>();
  for (const o of orders) if (o.session_id) ordersBySession.set(o.session_id, [...(ordersBySession.get(o.session_id) ?? []), o]);
  const rows: StoryRow[] = [];
  for (const s of [...sessions].sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at))) {
    const l = lineBySession.get(s.id);
    if (!l && s.status === "in_progress") continue;
    const par = l?.par_at_count ?? product.par;
    const sug = suggestOrder({ par: par ?? 0, pack_multiple: product.pack_multiple }, l?.store_qty, l?.second_qty);
    const mine = ordersBySession.get(s.id) ?? [];
    const mineIds = new Set(mine.map((o) => o.id));
    const lineQty = orderLines.filter((x) => x.product_id === product.id && mineIds.has(x.order_id)).reduce((n, x) => n + Number(x.ordered_qty || 0), 0);
    const ordered = lineQty > 0 ? lineQty : null;
    const anySent = mine.some((o) => o.status === "sent");
    let orderNote: string;
    let missed = false;
    if (sug.uncounted) orderNote = "Not counted";
    else if (s.status === "in_progress") orderNote = sug.orderQty > 0 ? "Count not finished yet" : "Nothing needed";
    else if (sug.orderQty > 0 && ordered != null) orderNote = `Ordered ${qtyText(ordered)}${anySent ? "" : " (draft order)"}`;
    else if (sug.orderQty > 0 && mine.length === 0 && s.source === "sheet-import") orderNote = "Ordered on the old sheet, not recorded here";
    else if (sug.orderQty > 0 && mine.length === 0) {
      orderNote = "No order was made from this count";
      missed = true;
    } else if (sug.orderQty > 0) {
      orderNote = "Not on the order";
      missed = true;
    } else if (ordered != null) orderNote = `Ordered ${qtyText(ordered)} (at or over Build To)`;
    else orderNote = "Nothing needed";
    const position: StoryPosition = sug.uncounted ? "Not counted" : sug.belowPar ? `Under by ${qtyText(Math.max(0, (par ?? 0) - (sug.counted ?? 0)))}` : sug.over > 0 ? `Over by ${qtyText(sug.over)}` : "At Build To";
    rows.push({
      sessionId: s.id,
      dateLabel: dayLabel(s.started_at, now),
      timeLabel: timeLabel(s.started_at),
      inProgress: s.status === "in_progress",
      store: l?.store_qty ?? null,
      second: l?.second_qty ?? null,
      total: sug.counted,
      par: par ?? null,
      position,
      ordered,
      orderNote,
      missed,
      over: sug.over,
      belowPar: sug.belowPar,
    });
  }
  return rows;
}

export interface StorySummary {
  counts: number;
  below: number;
  over: number;
  missed: number;
  sentences: string[];
}

/** The answers to "have we been over par?" and "did we forget to order it?" in a few plain sentences. */
export function storySummary(rows: readonly StoryRow[]): StorySummary {
  const counted = rows.filter((r) => r.total != null);
  const below = counted.filter((r) => r.belowPar).length;
  const over = counted.filter((r) => r.over > 0).length;
  const missed = rows.filter((r) => r.missed).length;
  const sentences: string[] = [];
  if (!counted.length) sentences.push("This product has not been counted yet.");
  else {
    sentences.push(`Counted ${counted.length} time${counted.length === 1 ? "" : "s"}. Below Build To in ${below}, over Build To in ${over}.`);
    sentences.push(missed ? `A needed order may have been missed in ${missed} count${missed === 1 ? "" : "s"}.` : "Every count that needed an order has an order for it.");
  }
  return { counts: counted.length, below, over, missed, sentences };
}

/* ------------------------------------------------------------------ orders list */

export interface OrderListRow {
  id: string;
  /** when it was sent, else when it was started */
  dateLabel: string;
  supplierName: string;
  /** "Sent by Matt", "Draft" */
  whoLabel: string;
  status: "Draft" | "Sent";
  kindLabel: "From A Count" | "Top-Up";
}

export function orderListRows(
  orders: readonly OrderingOrder[],
  suppliers: readonly Pick<OrderingSupplier, "id" | "name">[],
  nameOf: (email: string | null | undefined) => string | null,
  now?: Date,
): OrderListRow[] {
  const sup = new Map(suppliers.map((s) => [s.id, s.name]));
  const when = (o: OrderingOrder) => o.sent_at ?? o.created_at ?? o.updated_at ?? null;
  return [...orders]
    .sort((a, b) => Date.parse(when(b) ?? "") - Date.parse(when(a) ?? ""))
    .map((o) => ({
      id: o.id,
      dateLabel: dayLabel(when(o), now),
      supplierName: sup.get(o.supplier_id) ?? "Supplier removed",
      whoLabel: o.status === "sent" ? `Sent by ${nameOf(o.sent_by) ?? "someone"}` : "Draft, not sent",
      status: o.status === "sent" ? "Sent" : "Draft",
      kindLabel: o.kind === "top_up" ? "Top-Up" : "From A Count",
    }));
}

/* ------------------------------------------------------------------ Ordering home status */

/** "Last count: Mon 28 Sep, by Sheet import", or "No count yet". Only finalised counts are "last". */
export function lastCountLine(last: Pick<OrderingCountSession, "started_at" | "source" | "started_by" | "finalised_by"> | null, nameOf: (email: string | null | undefined) => string | null, now?: Date): string {
  if (!last) return "No count yet";
  return `Last count: ${dayLabel(last.started_at, now)}, by ${countWho(last, nameOf)}`;
}
