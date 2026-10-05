/**
 * Ordering: the pure logic behind the ORDER screens (components/ordering/orders). No React, no database.
 * Everything per venue: callers pass one venue's products, suppliers and orders. Decisions are Troy's (5 Oct 2026), see
 * files/research/stock-and-ordering-architecture-2026-10-05.md.
 *
 * What lives here: Brisbane time wording, which count to order from, the editable draft lines of one supplier card (built
 * from a count or typed for a top-up), the text and links for each way of sending, which send buttons are available and
 * why not, the state of a card (open to edit or already sent), and the wording of the Past Orders list.
 */
import { money } from "./format";
import {
  GST_RATE,
  buildOrderText,
  exGst,
  lineTotals,
  mailtoUrl,
  minimumWarning,
  orderTotals,
  outlookWebUrl,
  plainText,
  qtyText,
  qtyWithUnit,
  roundUpToMultiple,
  type ComposeLink,
} from "./ordering";
import type {
  OrderLineDraft,
  OrderSendMethod,
  OrderTextLine,
  OrderTotals,
  OrderingCountSession,
  OrderingMethod,
  OrderingOrder,
  OrderingOrderLine,
  OrderingProduct,
  OrderingSupplier,
  SuggestedLine,
  SupplierOrderGroup,
} from "./ordering-types";

/* ------------------------------------------------------------------ Brisbane time */

export const BRISBANE = "Australia/Brisbane";
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

interface BrisbaneParts {
  dow: string;
  day: number;
  month: string;
  hour: number;
  minute: number;
}

/** The wall clock in Brisbane for an ISO time (Brisbane has no daylight saving). Null for a missing or unreadable time. */
function brisbaneParts(iso: string | null | undefined): BrisbaneParts | null {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return null;
  const shifted = new Date(t + 10 * 3600 * 1000); // UTC+10 all year
  return { dow: DOW[shifted.getUTCDay()], day: shifted.getUTCDate(), month: MON[shifted.getUTCMonth()], hour: shifted.getUTCHours(), minute: shifted.getUTCMinutes() };
}

/** "Mon 5 Oct" in Brisbane time; "" when there is no date. */
export function brisbaneDay(iso: string | null | undefined): string {
  const p = brisbaneParts(iso);
  return p ? `${p.dow} ${p.day} ${p.month}` : "";
}

/** "9:14am" in Brisbane time. */
export function brisbaneTime(iso: string | null | undefined): string {
  const p = brisbaneParts(iso);
  if (!p) return "";
  const h12 = p.hour % 12 || 12;
  return `${h12}:${String(p.minute).padStart(2, "0")}${p.hour < 12 ? "am" : "pm"}`;
}

/** "Tue 6 Oct 9:14am" in Brisbane time. */
export function brisbaneStamp(iso: string | null | undefined): string {
  const day = brisbaneDay(iso);
  return day ? `${day} ${brisbaneTime(iso)}` : "";
}

/* ------------------------------------------------------------------ which count */

/** Finished counts, newest first (by when they were finalised, else started). */
export function finalisedCounts(sessions: readonly OrderingCountSession[]): OrderingCountSession[] {
  const at = (s: OrderingCountSession) => Date.parse(s.finalised_at ?? s.started_at) || 0;
  return sessions.filter((s) => s.status === "finalised").sort((a, b) => at(b) - at(a));
}

/** The count to order from: the one asked for if it is a finished count of this venue, else the latest finished count. */
export function pickCount(sessions: readonly OrderingCountSession[], wantedId: string | null | undefined): OrderingCountSession | null {
  const done = finalisedCounts(sessions);
  return done.find((s) => s.id === wantedId) ?? done[0] ?? null;
}

/** "Counted Mon 5 Oct by Brendan" (just the date when nobody is named). */
export function countLabel(session: Pick<OrderingCountSession, "finalised_at" | "started_at" | "finalised_by" | "started_by">, nameOf: (email: string | null | undefined) => string | null): string {
  const day = brisbaneDay(session.finalised_at ?? session.started_at);
  const who = nameOf(session.finalised_by ?? session.started_by);
  return `Counted ${day}${who ? ` by ${who}` : ""}`;
}

/* ------------------------------------------------------------------ draft lines (what the manager edits) */

/** One line of an order being built. Product lines carry the count; a typed line has no product. Prices are inc GST. */
export interface DraftLine {
  /** product id, or "free:<n>" for a typed line */
  key: string;
  productId: string | null;
  name: string;
  unit: string | null;
  code: string | null;
  packMultiple: number | null;
  /** price of one unit, inc GST */
  price: number | null;
  par: number | null;
  counted: number | null;
  /** the suggestion rounded up to the pack multiple; null for a line that was added by hand */
  suggested: number | null;
  qty: number;
}

export const MAX_QTY = 9999;

/** A quantity as typed: whole numbers only, 0 to 9999. Null when it is not a number. */
export function parseQty(text: string | number | null | undefined): number | null {
  const s = String(text ?? "").trim();
  if (!/^\d{1,4}$/.test(s)) return null;
  return Math.min(MAX_QTY, Number(s));
}

export function clampQty(n: number): number {
  return Number.isFinite(n) ? Math.min(MAX_QTY, Math.max(0, Math.round(n))) : 0;
}

/** The lines to order for one supplier, as suggested from the count (quantity already rounded up to the pack multiple). */
export function draftLinesFromGroup(group: Pick<SupplierOrderGroup, "lines">): DraftLine[] {
  return group.lines.map((l) => draftLineFromSuggested(l, l.suggestion.orderQty));
}

export function draftLineFromSuggested(l: SuggestedLine, qty: number): DraftLine {
  return {
    key: l.product.id,
    productId: l.product.id,
    name: l.product.name,
    unit: l.product.unit_name,
    code: l.product.supplier_item_code,
    packMultiple: l.product.pack_multiple,
    price: l.product.price_inc_gst,
    par: l.product.par,
    counted: l.suggestion.counted,
    suggested: l.suggestion.uncounted ? null : l.suggestion.orderQty,
    qty,
  };
}

/** A product added by hand (a top-up, or one the count did not suggest). Starts at its pack multiple, or its suggestion when there is one. */
export function draftLineFromProduct(product: OrderingProduct, suggested?: SuggestedLine | null, qty?: number): DraftLine {
  const start = qty ?? (suggested && suggested.suggestion.orderQty > 0 ? suggested.suggestion.orderQty : Math.max(1, product.pack_multiple || 1));
  if (suggested) return draftLineFromSuggested(suggested, start);
  return {
    key: product.id,
    productId: product.id,
    name: product.name,
    unit: product.unit_name,
    code: product.supplier_item_code,
    packMultiple: product.pack_multiple,
    price: product.price_inc_gst,
    par: product.par,
    counted: null,
    suggested: null,
    qty: start,
  };
}

let freeCounter = 0;
/** A typed line with no product behind it (no price, no item code). */
export function freeTextLine(name: string, qty = 1, unit: string | null = null): DraftLine | null {
  const clean = plainText(name);
  if (!clean) return null;
  freeCounter += 1;
  return { key: `free:${Date.now().toString(36)}-${freeCounter}`, productId: null, name: clean, unit: unit ? plainText(unit) || null : null, code: null, packMultiple: null, price: null, par: null, counted: null, suggested: null, qty: clampQty(qty) };
}

export function setLineQty(lines: readonly DraftLine[], key: string, qty: number): DraftLine[] {
  return lines.map((l) => (l.key === key ? { ...l, qty: clampQty(qty) } : l));
}

export function removeLine(lines: readonly DraftLine[], key: string): DraftLine[] {
  return lines.filter((l) => l.key !== key);
}

/** One step of the plus and minus buttons: a pack multiple at a time (Star spirits 6 or 12), one at a time otherwise. Never below 0. */
export function stepQty(line: Pick<DraftLine, "qty" | "packMultiple">, direction: 1 | -1): number {
  const step = Math.max(1, Math.floor(line.packMultiple ?? 1));
  if (direction === 1) return clampQty(roundUpToMultiple(line.qty + 1, step));
  // down: to the multiple below, never below 0
  const below = Math.ceil(line.qty / step) * step - step;
  return clampQty(below < 0 ? 0 : below >= line.qty ? line.qty - step : below);
}

/** The quantity is not a whole multiple of the pack the supplier sells (editable, so this is a soft flag only). */
export function notPackMultiple(line: Pick<DraftLine, "qty" | "packMultiple">): boolean {
  const m = Math.floor(line.packMultiple ?? 1);
  return m > 1 && line.qty > 0 && line.qty % m !== 0;
}

/** Adds a line unless that product is already on the order (the existing line is kept). */
export function addLine(lines: readonly DraftLine[], line: DraftLine): DraftLine[] {
  return lines.some((l) => l.key === line.key) ? [...lines] : [...lines, line];
}

/** The lines as the data layer saves them. Lines with no quantity are left out. */
export function draftsToOrderLines(lines: readonly DraftLine[]): OrderLineDraft[] {
  const out: OrderLineDraft[] = [];
  for (const l of lines) {
    if (!(l.qty > 0)) continue;
    out.push({
      product_id: l.productId,
      product_name: l.name,
      supplier_item_code: l.code,
      unit_name: l.unit,
      suggested_qty: l.suggested,
      ordered_qty: l.qty,
      pack_multiple: l.packMultiple,
      price_inc_gst: l.price,
      sort: out.length,
    });
  }
  return out;
}

/** Same lines and quantities (used to know whether a saved draft order still matches what is on screen). */
export function linesSignature(lines: readonly DraftLine[]): string {
  return lines
    .filter((l) => l.qty > 0)
    .map((l) => `${l.key}:${l.qty}:${l.price ?? ""}`)
    .join("|");
}

/* ------------------------------------------------------------------ products that can be added to a card */

export interface AddCandidate {
  product: OrderingProduct;
  /** the suggestion from the count, when the product was counted */
  suggested: SuggestedLine | null;
  /** another supplier's product (only offered on a top-up, which searches the whole venue) */
  otherSupplierId: string | null;
}

/**
 * Products offered by the Add Product search, best match first: not already on the order, matching every typed word in the
 * name or item code. `scope` supplier searches only that supplier's products (a count card); venue searches all of the
 * venue's active products with the supplier's own first (a top-up).
 */
export function addCandidates(
  products: readonly OrderingProduct[],
  opts: { supplierId: string | null; scope: "supplier" | "venue"; onOrder: readonly DraftLine[]; query: string; suggestions?: ReadonlyMap<string, SuggestedLine>; limit?: number },
): AddCandidate[] {
  const taken = new Set(opts.onOrder.map((l) => l.key));
  const words = plainText(opts.query).toLowerCase().split(" ").filter(Boolean);
  const hit = (p: OrderingProduct) => {
    const hay = `${p.name} ${p.supplier_item_code ?? ""}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  };
  const pool = products.filter((p) => p.active && !taken.has(p.id) && (opts.scope === "venue" || p.supplier_id === opts.supplierId) && hit(p));
  const mine = (p: OrderingProduct) => (p.supplier_id === opts.supplierId ? 0 : 1);
  const startsWith = (p: OrderingProduct) => (words.length && p.name.toLowerCase().startsWith(words[0]) ? 0 : 1);
  return pool
    .sort((a, b) => mine(a) - mine(b) || startsWith(a) - startsWith(b) || a.name.localeCompare(b.name))
    .slice(0, opts.limit ?? 40)
    .map((product) => ({ product, suggested: opts.suggestions?.get(product.id) ?? null, otherSupplierId: product.supplier_id !== opts.supplierId ? product.supplier_id : null }));
}

/* ------------------------------------------------------------------ lines not on the order (count review) */

/** "Over by 3" for a product over its Build To, "At Build To" for one exactly on it. */
export function notNeededNote(l: SuggestedLine): string {
  if (l.suggestion.over > 0) return `Over by ${qtyText(l.suggestion.over)}`;
  return "At Build To";
}

/** "Counted 8, Build To 6" for a counted line; "Build To 6" for a product that was skipped. */
export function countSummary(l: SuggestedLine): string {
  const par = `Build To ${qtyText(l.product.par)}`;
  return l.suggestion.counted == null ? par : `Counted ${qtyText(l.suggestion.counted)}, ${par}`;
}

/** A group's suggested lines are all there is when the supplier is a real one with something to say about it. */
export function groupHasWork(g: Pick<SupplierOrderGroup, "lines" | "uncountedLines">): boolean {
  return g.lines.length > 0 || g.uncountedLines.length > 0;
}

/** Cards to show in order: suppliers with something to order first, then the ones with nothing (still openable). Unassigned stays last. */
export function orderCardGroups(groups: readonly SupplierOrderGroup[], sentSupplierIds: ReadonlySet<string> = new Set()): { assigned: SupplierOrderGroup[]; unassigned: SupplierOrderGroup | null } {
  const assigned = groups.filter((g) => g.supplierId != null && g.supplier != null);
  const unassigned = groups.filter((g) => g.supplierId == null || g.supplier == null);
  const busy = (g: SupplierOrderGroup) => (g.lines.length > 0 || sentSupplierIds.has(g.supplierId as string) ? 0 : 1);
  const sorted = assigned.map((g, i) => ({ g, i })).sort((a, b) => busy(a.g) - busy(b.g) || a.i - b.i).map((x) => x.g);
  // everything the unassigned products need, merged into one group (a missing supplier row groups on its own id)
  const merged: SupplierOrderGroup | null = unassigned.length
    ? { supplierId: null, supplierName: "Unassigned", supplier: null, lines: unassigned.flatMap((g) => g.lines), zeroLines: unassigned.flatMap((g) => g.zeroLines), uncountedLines: unassigned.flatMap((g) => g.uncountedLines) }
    : null;
  return { assigned: sorted, unassigned: merged && (merged.lines.length > 0 || merged.uncountedLines.length > 0) ? merged : null };
}

/* ------------------------------------------------------------------ the text and the ways of sending */

/** The line shape the text builder and totals read. Lines with no quantity are left out. */
export function textLinesFromDraft(lines: readonly DraftLine[]): OrderTextLine[] {
  return lines.filter((l) => l.qty > 0).map((l) => ({ product_name: l.name, unit_name: l.unit, supplier_item_code: l.code, ordered_qty: l.qty, price_inc_gst: l.price }));
}

/** The one unit all the ordered lines share ("carton"), or null when they differ or none is named. Used for a minimum in units. */
export function commonUnit(lines: readonly { unit_name: string | null; ordered_qty: number }[]): string | null {
  const units = new Set(lines.filter((l) => l.ordered_qty > 0 && l.unit_name).map((l) => plainText(l.unit_name).toLowerCase()));
  return units.size === 1 ? [...units][0] : null;
}

/**
 * Units that count toward a minimum in units. When every named unit is the same ("keg"), only lines in that unit count: a
 * typed line with no unit ("Bar mats") is not a keg. With mixed units everything counts.
 */
export function minimumUnits(lines: readonly { unit_name: string | null; ordered_qty: number }[]): number {
  const common = commonUnit(lines);
  const sum = lines.filter((l) => l.ordered_qty > 0 && (!common || (l.unit_name && plainText(l.unit_name).toLowerCase() === common))).reduce((a, l) => a + l.ordered_qty, 0);
  return Math.round(sum * 1e6) / 1e6;
}

export interface SupplierSendInput {
  venueName: string;
  supplier: Pick<OrderingSupplier, "rep_name" | "account_no" | "email_to" | "min_order_value" | "min_order_units">;
  lines: readonly DraftLine[];
  showPrices: boolean;
  /** the signed-in person's first name */
  senderName: string | null;
}

export interface SupplierSend {
  subject: string;
  /** the exact text, \n line breaks */
  body: string;
  mailto: ComposeLink;
  outlook: ComposeLink;
  totals: OrderTotals;
  /** "Order is $120.00 short of the $650.00 minimum", or null */
  warning: string | null;
  /** lines with a quantity above 0 */
  lineCount: number;
  textLines: OrderTextLine[];
}

/** Everything the send panel needs from the lines as they stand: the exact text, both draft links, totals and the minimum warning. */
export function buildSupplierSend(i: SupplierSendInput): SupplierSend {
  const textLines = textLinesFromDraft(i.lines);
  const text = buildOrderText({ venueName: i.venueName, supplier: i.supplier, lines: textLines, showPrices: i.showPrices, senderName: i.senderName });
  const totals = orderTotals(textLines);
  const warning = minimumWarning({ totals: { ...totals, units: minimumUnits(textLines) }, unitName: commonUnit(textLines) }, i.supplier);
  return {
    subject: text.subject,
    body: text.body,
    mailto: mailtoUrl({ to: i.supplier.email_to, subject: text.subject, body: text.body }),
    outlook: outlookWebUrl({ to: i.supplier.email_to, subject: text.subject, body: text.body }),
    totals,
    warning,
    lineCount: textLines.length,
    textLines,
  };
}

export type SendActionId = "email" | "outlook" | "copy" | "login";

export interface SendAction {
  id: SendActionId;
  label: string;
  /** the supplier's own way of ordering: drawn as the filled button */
  primary: boolean;
  enabled: boolean;
  /** plain words for why a disabled button is disabled; null when enabled */
  reason: string | null;
  /** where the button goes (mailto, Outlook on the web, the supplier login); null for Copy */
  href: string | null;
  /** opens in a new tab */
  newTab: boolean;
}

export const NO_EMAIL_REASON = "No email address is saved for this supplier.";
export const NO_LOGIN_REASON = "No login link is saved for this supplier.";
export const NO_LINES_REASON = "Add a quantity to at least one product first.";
export const TOO_LONG_MAILTO = "This order is too long for an email link, so Open Email is off. Use Copy Order, or Open In Outlook if that is on.";
export const TOO_LONG_OUTLOOK = "This order is too long for an Outlook link. Use Copy Order and paste it in.";

/**
 * Every way of sending, in the order they are drawn, each with its own button. The supplier's method decides which button is
 * filled (and which ones apply), nothing is hidden in a menu.
 *   email    Open Email (filled), Open In Outlook, Copy Order
 *   website  Open Login (filled), Copy Order
 *   app      Copy Order (filled), plus Open Login when a link is saved
 * A button that cannot work is kept, disabled, with its reason in words.
 */
export function sendActions(supplier: Pick<OrderingSupplier, "method" | "email_to" | "login_url">, send: Pick<SupplierSend, "mailto" | "outlook" | "lineCount">): SendAction[] {
  const hasLines = send.lineCount > 0;
  const email = (supplier.email_to ?? "").trim().length > 0;
  const login = (supplier.login_url ?? "").trim().length > 0;
  const method: OrderingMethod = supplier.method;

  const emailAction: SendAction = (() => {
    const reason = !hasLines ? NO_LINES_REASON : !email ? NO_EMAIL_REASON : send.mailto.tooLong ? TOO_LONG_MAILTO : null;
    return { id: "email", label: "Open Email", primary: method === "email", enabled: reason == null, reason, href: reason == null ? send.mailto.url : null, newTab: false };
  })();
  const outlookAction: SendAction = (() => {
    const reason = !hasLines ? NO_LINES_REASON : !email ? NO_EMAIL_REASON : send.outlook.tooLong ? TOO_LONG_OUTLOOK : null;
    return { id: "outlook", label: "Open In Outlook", primary: false, enabled: reason == null, reason, href: reason == null ? send.outlook.url : null, newTab: true };
  })();
  const copyAction: SendAction = { id: "copy", label: "Copy Order", primary: method === "app", enabled: hasLines, reason: hasLines ? null : NO_LINES_REASON, href: null, newTab: false };
  const loginAction: SendAction = { id: "login", label: "Open Login", primary: method === "website", enabled: login, reason: login ? null : NO_LOGIN_REASON, href: login ? (supplier.login_url ?? "").trim() : null, newTab: true };

  if (method === "email") return [emailAction, outlookAction, copyAction];
  if (method === "website") return [loginAction, copyAction];
  return login ? [copyAction, loginAction] : [copyAction];
}

/** The reasons to print under the buttons (each once), so a disabled button is never a mystery. */
export function sendReasons(actions: readonly SendAction[]): string[] {
  const out: string[] = [];
  for (const a of actions) if (a.reason && !out.includes(a.reason)) out.push(a.reason);
  return out;
}

/** What to save as the way the order went out, from the last button used (else the supplier's own way). */
export function defaultSendMethod(last: SendActionId | null, supplierMethod: OrderingMethod): OrderSendMethod {
  if (last === "email") return "email";
  if (last === "outlook") return "outlook";
  if (last === "copy") return "copy";
  if (last === "login") return "website";
  return supplierMethod === "email" ? "email" : supplierMethod === "website" ? "website" : "other";
}

export const SEND_METHOD_LABEL: Record<OrderSendMethod, string> = {
  email: "Email",
  outlook: "Outlook",
  copy: "Copied And Pasted",
  website: "Website",
  other: "Other",
};

export const SEND_METHOD_OPTIONS: { value: OrderSendMethod; label: string }[] = [
  { value: "email", label: SEND_METHOD_LABEL.email },
  { value: "outlook", label: SEND_METHOD_LABEL.outlook },
  { value: "copy", label: SEND_METHOD_LABEL.copy },
  { value: "website", label: SEND_METHOD_LABEL.website },
  { value: "other", label: SEND_METHOD_LABEL.other },
];

export const METHOD_LABEL: Record<OrderingMethod, string> = { email: "Email", website: "Website Login", app: "App" };

/* ------------------------------------------------------------------ the state of a card */

/** Sent orders for a supplier from one count, newest first. A top-up (no count) is never matched. */
export function sentOrdersFor(orders: readonly OrderingOrder[], sessionId: string | null, supplierId: string): OrderingOrder[] {
  if (!sessionId) return [];
  const at = (o: OrderingOrder) => Date.parse(o.sent_at ?? o.created_at ?? "") || 0;
  return orders.filter((o) => o.status === "sent" && o.kind === "count" && o.session_id === sessionId && o.supplier_id === supplierId).sort((a, b) => at(b) - at(a));
}

export type CardMode = "sent" | "edit";

/**
 * A card is read-only ("sent") once an order for this count and supplier was marked as sent, so a second tap cannot send a
 * duplicate. Send Again turns the card back into an editor; the new order is a separate one.
 */
export function cardMode(sent: readonly OrderingOrder[], sendAgain: boolean): CardMode {
  return sent.length > 0 && !sendAgain ? "sent" : "edit";
}

/** The line a sent card or detail page prints: products and units, and the total when any line has a price. */
export function sentSummary(lines: readonly Pick<OrderingOrderLine, "ordered_qty" | "price_inc_gst">[]): { products: number; units: number; totals: OrderTotals } {
  const real = lines.filter((l) => l.ordered_qty > 0);
  const totals = orderTotals(real);
  return { products: real.length, units: totals.units, totals };
}

/* ------------------------------------------------------------------ money wording */

export interface PriceCells {
  /** "$26.82" ex GST for one unit, null without a price */
  unitEx: string | null;
  unitInc: string | null;
  /** the line value */
  totalEx: string | null;
  totalInc: string | null;
}

/** Price and line total of a line, as shown (ex and inc GST), all null when the line has no price. */
export function priceCells(qty: number, priceInc: number | null | undefined, rate: number = GST_RATE): PriceCells {
  if (priceInc == null) return { unitEx: null, unitInc: null, totalEx: null, totalInc: null };
  const t = lineTotals(qty, priceInc, rate);
  return { unitEx: money(exGst(priceInc, rate)), unitInc: money(priceInc), totalEx: t ? money(t.ex) : null, totalInc: t ? money(t.inc) : null };
}

/** "2 products, 14 units" style wording for a count of things. */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${qtyText(n)} ${n === 1 ? one : many}`;
}

/** "14 units", or in the one unit the lines share ("4 kegs"), with typed lines counted apart ("1 keg and 1 typed line"). */
export function unitsText(lines: readonly { ordered_qty: number; unit_name: string | null }[]): string {
  const unit = commonUnit(lines);
  const real = lines.filter((l) => l.ordered_qty > 0);
  if (!unit) return plural(real.reduce((a, l) => a + l.ordered_qty, 0), "unit");
  const typed = real.filter((l) => !l.unit_name).length;
  const text = qtyWithUnit(minimumUnits(real), unit);
  return typed ? `${text} and ${plural(typed, "typed line")}` : text;
}

/* ------------------------------------------------------------------ Past Orders */

export interface PastOrderRow {
  id: string;
  supplierName: string;
  kind: "count" | "top_up";
  kindLabel: string;
  status: "sent" | "draft";
  /** "Tue 6 Oct 9:14am by Troy, Email" or "Saved ..., not marked as sent" */
  when: string;
}

/** The Past Orders list, latest first. A saved order that was never marked as sent says so plainly. */
export function pastOrderRows(orders: readonly OrderingOrder[], suppliers: readonly Pick<OrderingSupplier, "id" | "name">[], nameOf: (email: string | null | undefined) => string | null): PastOrderRow[] {
  const name = new Map(suppliers.map((s) => [s.id, s.name]));
  const at = (o: OrderingOrder) => Date.parse(o.sent_at ?? o.created_at ?? "") || 0;
  return [...orders]
    .sort((a, b) => at(b) - at(a))
    .map((o) => {
      const sent = o.status === "sent";
      const who = nameOf(o.sent_by);
      const stamp = brisbaneStamp(sent ? o.sent_at : o.created_at);
      const how = sent && o.method ? `, ${SEND_METHOD_LABEL[o.method]}` : "";
      return {
        id: o.id,
        supplierName: name.get(o.supplier_id) ?? "Supplier",
        kind: o.kind,
        kindLabel: o.kind === "top_up" ? "Top-Up" : "Count",
        status: sent ? "sent" : "draft",
        when: sent ? `Sent ${stamp}${who ? ` by ${who}` : ""}${how}` : `Saved ${stamp}, not marked as sent`,
      };
    });
}

/** Wording for who sent an order and when: "Sent Tue 6 Oct 9:14am by Troy". */
export function sentLine(order: Pick<OrderingOrder, "sent_at" | "sent_by" | "method">, nameOf: (email: string | null | undefined) => string | null): string {
  const who = nameOf(order.sent_by);
  return `Sent ${brisbaneStamp(order.sent_at)}${who ? ` by ${who}` : ""}`;
}
