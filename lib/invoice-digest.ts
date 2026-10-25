/**
 * Invoice digests: the Slack message after a processing run and the Monday email of open questions. Pure text builders, no
 * network, no database, no clock (the caller passes `now`), so every sentence can be tested word for word.
 *
 * Two audiences:
 *   - Slack (Troy and Abbey, in the shared Drift / Greedy / Gelato channel): one short message per venue per run.
 *     Quiet runs say nothing at all (`buildSlackDigest` returns null).
 *   - The weekly email: Troy and Abbey receive it and FORWARD IT AS IS to the venue managers (Mon and Matt). Everything below the
 *     divider line is written for the managers, so it is client-facing text: no dashes (em or en), no mention of any AI product,
 *     warm Australian professional. `plainText` scrubs anything that comes from an invoice or a stored prompt before it lands in
 *     either message.
 *
 * Invoice text is UNTRUSTED DATA. It is shown, never followed, and Slack's special characters are escaped.
 */

export const DEFAULT_APP_ORIGIN = "https://precinct-costing.vercel.app";
/** most "what needs a person" bullets in one Slack message; the rest are counted */
export const SLACK_MAX_ITEMS = 6;
/** weekly email caps: attachments by count and by total size; questions listed by count */
export const WEEKLY_MAX_FILES = 15;
export const WEEKLY_MAX_BYTES = 20 * 1024 * 1024;
export const WEEKLY_MAX_QUESTIONS = 60;
/** a question already emailed is only repeated once it has stayed open this long */
export const WEEKLY_REPEAT_DAYS = 7;
/** assumed size when a PDF's size cannot be read, so the 20 MB cap stays safe */
export const WEEKLY_UNKNOWN_PDF_BYTES = 2 * 1024 * 1024;

// ---------------------------------------------------------------- small text helpers
/**
 * One line of safe text from anything stored or read off an invoice: dashes (em, en) become commas, the names of AI products
 * are replaced, line breaks and runs of spaces collapse. Never used on money or links.
 */
export function plainText(input: string | null | undefined): string {
  return String(input ?? "")
    .replace(/\s*[—–―]\s*/g, ", ")
    .replace(/\b(Claude|Anthropic)\b/gi, "the system")
    .replace(/\bAI\b/g, "the system")
    .replace(/\s+/g, " ")
    .replace(/,\s*,/g, ",")
    .trim();
}

/**
 * Takes the Slack control sequences out of text that came off an invoice: <!channel>, <!here>, <@U123>, <#C123> (a ping or a
 * channel link) and <https://...|label> or <mailto:...> (a link that reads as something else). Whole tokens go first, then any
 * leftover opener, so a mention can never be produced however the text is escaped or joined afterwards.
 */
export function stripSlackMarkup(s: string): string {
  let out = String(s);
  // repeat until stable, so "<<!channel>!channel>" cannot rebuild a mention from the pieces left behind
  for (let i = 0; i < 5; i++) {
    const next = out
      .replace(/<\s*[!@#][^>]*>?/g, "")
      .replace(/<\s*(?:https?:|mailto:|tel:)[^>]*>?/gi, "")
      .replace(/<\s*[!@#]/g, "");
    if (next === out) break;
    out = next;
  }
  return out;
}

/** Slack mrkdwn needs only these three escaped. Mention and link markup is removed first (see stripSlackMarkup). */
export function slackEscape(s: string): string {
  return stripSlackMarkup(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function htmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** $1,234.50 (two decimals, thousands commas, deterministic whatever the server locale). */
export function fmtPrice(n: number): string {
  const [whole, dec] = Math.abs(n).toFixed(2).split(".");
  const withCommas = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${n < 0 ? "-" : ""}$${withCommas}.${dec}`;
}

/** +7.7% / -3.2% (fraction in, one decimal out). */
export function fmtChange(frac: number): string {
  const p = Math.round(frac * 1000) / 10;
  return `${p > 0 ? "+" : ""}${p.toFixed(1)}%`;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "Pty Ltd" and friends dropped; "X trading as Y" becomes Y. "Daniel Street Fish Market" stays whole. */
export function shortSupplier(name: string | null | undefined): string {
  let s = plainText(name);
  if (!s) return "Unknown supplier";
  const ta = s.match(/\b(?:trading as|t\/as|t\/a)\s+(.+)$/i);
  if (ta) s = ta[1];
  s = s.replace(/[,\s]+(pty\.?\s*ltd\.?|pty\.?\s*limited|limited|ltd\.?|pty\.?)\s*$/i, "").trim();
  return s || "Unknown supplier";
}

/** An invoice description made readable: ALL CAPS comes down to a sentence, long ones are cut at a word. */
export function tidyItem(desc: string | null | undefined): string {
  let s = plainText(desc);
  if (!s) return "An item";
  if (/[A-Z]/.test(s) && !/[a-z]/.test(s)) s = s.charAt(0) + s.slice(1).toLowerCase();
  if (s.length > 48) {
    const cut = s.slice(0, 48);
    const sp = cut.lastIndexOf(" ");
    s = (sp > 20 ? cut.slice(0, sp) : cut).trim();
  }
  return s;
}

// ---------------------------------------------------------------- Brisbane dates (UTC+10, no daylight saving)
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Brisbane calendar parts for an instant. */
export function brisbaneParts(d: Date): { y: number; m: number; day: number; dow: number } {
  const t = new Date(d.getTime() + 10 * 3600 * 1000);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, day: t.getUTCDate(), dow: t.getUTCDay() };
}

/** "26 Oct" for the Monday on or before `now` in Brisbane. */
export function mondayLabel(now: Date): string {
  const p = brisbaneParts(now);
  const back = (p.dow + 6) % 7; // Monday = 0 days back
  const monday = new Date(Date.UTC(p.y, p.m - 1, p.day - back));
  return `${monday.getUTCDate()} ${MONTHS[monday.getUTCMonth()]}`;
}

/** yyyy-mm-dd to "14 Oct 2026"; anything else comes back as "undated". */
export function dayLabel(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  if (!m) return "undated";
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

// ---------------------------------------------------------------- Slack digest
export interface AttentionItem {
  supplier: string;
  item: string;
  /** invoice unit prices, ex GST; old is null for a product with no earlier price */
  oldPrice: number | null;
  newPrice: number | null;
  /** kg, ctn, ea ... as printed on the invoice */
  unit: string | null;
  /** signed fraction, 0.077 = +7.7% */
  pct: number | null;
}

export interface SlackDigestData {
  venueName: string;
  venueSlug: string;
  /** the app's web address, no trailing slash */
  origin: string;
  /** invoices and credit notes finished in this run (statements, blanks and repeats are not counted) */
  invoices: number;
  /** price changes written to the app in this run */
  pricesUpdated: number;
  /** lines waiting for a tap */
  needApproval: number;
  /** true when every one of them is at or over the auto-apply limit (so "over 5%" is the honest reason) */
  needApprovalAllOver: boolean;
  /** the auto-apply limit as a fraction, 0.05 */
  autoApplyPct: number;
  /** open questions that are not just "approve this price" */
  questions: number;
  /** documents that could not be read */
  failed: number;
  /** what needs a person, any order (the builder sorts and caps) */
  items: AttentionItem[];
}

function wholePct(frac: number): string {
  const v = Math.round(frac * 1000) / 10;
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

/** "Kingfish fillets, Daniel Street: $68.90 to $74.20/kg (+7.7%)" */
export function attentionLine(it: AttentionItem): string {
  const unit = it.unit ? `/${slackEscape(plainText(it.unit).toLowerCase())}` : "";
  let change: string;
  if (it.newPrice == null) change = "price to check";
  else if (it.oldPrice == null) change = `${fmtPrice(it.newPrice)}${unit} (new price)`;
  else change = `${fmtPrice(it.oldPrice)} to ${fmtPrice(it.newPrice)}${unit}${it.pct != null ? ` (${fmtChange(it.pct)})` : ""}`;
  return `• ${slackEscape(tidyItem(it.item))}, ${slackEscape(shortSupplier(it.supplier))}: ${change}`;
}

/**
 * One Slack message for one venue and one processing run, or null when the run was quiet (nothing applied and nothing needs a
 * person). At most one status emoji, at the very start.
 */
export function buildSlackDigest(d: SlackDigestData): string | null {
  const needsPerson = d.needApproval + d.questions + d.failed > 0;
  if (!needsPerson && d.pricesUpdated === 0) return null;

  const parts: string[] = [];
  if (d.pricesUpdated > 0) parts.push(plural(d.pricesUpdated, "price updated", "prices updated"));
  if (d.needApproval > 0) {
    const over = d.needApprovalAllOver ? ` (over ${wholePct(d.autoApplyPct)}%)` : "";
    parts.push(`${d.needApproval} ${d.needApproval === 1 ? "needs" : "need"} approval${over}`);
  }
  if (d.questions > 0) parts.push(plural(d.questions, "question", "questions"));
  if (d.failed > 0) parts.push(`${d.failed} could not be read`);

  const emoji = needsPerson ? ":warning:" : ":white_check_mark:";
  const venue = slackEscape(plainText(d.venueName));
  const lines: string[] = [`${emoji} *${venue}: ${d.invoices === 0 ? "no invoices" : plural(d.invoices, "invoice", "invoices")} processed.* ${parts.join(", ")}.`];

  const sorted = [...d.items].sort((a, b) => Math.abs(b.pct ?? 0) - Math.abs(a.pct ?? 0));
  const shown = sorted.slice(0, SLACK_MAX_ITEMS);
  if (shown.length) {
    lines.push("");
    for (const it of shown) lines.push(attentionLine(it));
    const more = Math.max(d.needApproval, sorted.length) - shown.length;
    if (more > 0) lines.push(`and ${more} more in the app`);
  }

  const slug = encodeURIComponent(d.venueSlug);
  lines.push("");
  lines.push(`<${d.origin}/invoices?venue=${slug}|Review them in the CFP App>`);
  if (d.questions > 0) lines.push(`<${d.origin}/invoices/questions?venue=${slug}|Answer the questions>`);
  return lines.join("\n");
}

// ---------------------------------------------------------------- weekly email: planning (pure)
export interface WeeklyQuestionIn {
  id: string;
  venue_id: number;
  document_id: string;
  prompt: string;
  emailed_at: string | null;
  created_at: string;
}

export interface WeeklyDocIn {
  id: string;
  venue_id: number;
  supplier: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  page_pdf_path: string | null;
  status: string;
  /** size of the split PDF in bytes, when known */
  pdf_bytes?: number | null;
}

export interface VenueIn {
  id: number;
  name: string;
  slug: string;
  sort?: number;
}

export interface WeeklyQuestionOut {
  id: string;
  prompt: string;
  stillWaiting: boolean;
}

export interface WeeklyInvoice {
  documentId: string;
  supplier: string;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  /** storage path of the split PDF, or null when there is none */
  pdfPath: string | null;
  /** the file name it will carry as an attachment, or null when it is not attached (no PDF, or over the caps) */
  attachmentName: string | null;
  questions: WeeklyQuestionOut[];
}

export interface WeeklyVenueGroup {
  venueId: number;
  name: string;
  slug: string;
  invoices: WeeklyInvoice[];
}

export interface WeeklyPlan {
  groups: WeeklyVenueGroup[];
  /** every question the email lists, and so every question to mark as emailed */
  questionIds: string[];
  /** open questions left out by the 60 question cap */
  moreQuestions: number;
  invoiceCount: number;
}

/** Statuses whose questions nobody needs to answer any more. */
const DEAD_DOC_STATUSES = new Set(["ignored", "duplicate"]);

/** A question belongs in this week's email when it is open and either never emailed or still open a week after it was. */
export function isDueForEmail(q: Pick<WeeklyQuestionIn, "emailed_at">, now: Date): boolean {
  if (!q.emailed_at) return true;
  const t = Date.parse(q.emailed_at);
  if (Number.isNaN(t)) return true;
  return now.getTime() - t >= WEEKLY_REPEAT_DAYS * 24 * 3600 * 1000;
}

/** A file name safe for an email attachment: no slashes, quotes or control characters, never a dash character. */
export function attachmentFileName(venue: string, supplier: string, number: string | null, date: string | null): string {
  const base = [plainText(venue), shortSupplier(supplier), number ? plainText(number) : "no number", dayLabel(date)].join(" ");
  const clean = base.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 110);
  return `${clean}.pdf`;
}

/**
 * Groups the due questions by venue then invoice, in a stable order (venue order, then invoice date, supplier, number; questions
 * oldest first), and picks which invoices get their PDF attached under the caps (15 files, 20 MB, in that order).
 */
export function planWeekly(input: { questions: WeeklyQuestionIn[]; docs: WeeklyDocIn[]; venues: VenueIn[]; now: Date }): WeeklyPlan {
  const docById = new Map(input.docs.map((d) => [d.id, d]));
  const venueById = new Map(input.venues.map((v) => [v.id, v]));
  const due = input.questions
    .filter((q) => isDueForEmail(q, input.now))
    .filter((q) => {
      const doc = docById.get(q.document_id);
      return !!doc && !DEAD_DOC_STATUSES.has(doc.status);
    })
    .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));

  const listed = due.slice(0, WEEKLY_MAX_QUESTIONS);
  const moreQuestions = due.length - listed.length;

  // invoices that hold at least one listed question
  const byDoc = new Map<string, WeeklyQuestionOut[]>();
  for (const q of listed) {
    const arr = byDoc.get(q.document_id) ?? [];
    arr.push({ id: q.id, prompt: plainText(q.prompt).slice(0, 400), stillWaiting: !!q.emailed_at });
    byDoc.set(q.document_id, arr);
  }

  const invoices: (WeeklyInvoice & { venueId: number; bytes: number })[] = [];
  for (const [docId, qs] of byDoc) {
    const doc = docById.get(docId)!;
    invoices.push({
      documentId: docId,
      venueId: doc.venue_id,
      supplier: shortSupplier(doc.supplier),
      invoiceNumber: doc.invoice_number ? plainText(doc.invoice_number) : null,
      invoiceDate: doc.invoice_date,
      pdfPath: doc.page_pdf_path,
      attachmentName: null,
      questions: qs,
      bytes: doc.pdf_bytes ?? WEEKLY_UNKNOWN_PDF_BYTES,
    });
  }

  const venueOrder = (id: number) => {
    const v = venueById.get(id);
    return v ? [v.sort ?? 0, v.id] : [9999, id];
  };
  invoices.sort((a, b) => {
    const [as, ai] = venueOrder(a.venueId);
    const [bs, bi] = venueOrder(b.venueId);
    return as - bs || ai - bi || (a.invoiceDate ?? "9999").localeCompare(b.invoiceDate ?? "9999") || a.supplier.localeCompare(b.supplier) || (a.invoiceNumber ?? "").localeCompare(b.invoiceNumber ?? "");
  });

  // attachments, first come first served in that order
  let files = 0;
  let bytes = 0;
  const used = new Set<string>();
  for (const inv of invoices) {
    if (!inv.pdfPath) continue;
    if (files >= WEEKLY_MAX_FILES || bytes + inv.bytes > WEEKLY_MAX_BYTES) continue;
    const venue = venueById.get(inv.venueId)?.name ?? "Venue";
    let name = attachmentFileName(venue, inv.supplier, inv.invoiceNumber, inv.invoiceDate);
    for (let n = 2; used.has(name.toLowerCase()); n++) name = name.replace(/( \d+)?\.pdf$/, ` ${n}.pdf`);
    used.add(name.toLowerCase());
    inv.attachmentName = name;
    files++;
    bytes += inv.bytes;
  }

  const groups: WeeklyVenueGroup[] = [];
  for (const inv of invoices) {
    let g = groups.find((x) => x.venueId === inv.venueId);
    if (!g) {
      const v = venueById.get(inv.venueId);
      g = { venueId: inv.venueId, name: v ? plainText(v.name) : "Venue", slug: v?.slug ?? "", invoices: [] };
      groups.push(g);
    }
    const { venueId: _v, bytes: _b, ...rest } = inv;
    void _v;
    void _b;
    g.invoices.push(rest);
  }

  return { groups, questionIds: listed.map((q) => q.id), moreQuestions, invoiceCount: invoices.length };
}

/** Takes the attachment off these invoices (a signed link could not be made), so the email never names a file it does not carry. */
export function withoutAttachments(plan: WeeklyPlan, documentIds: string[]): WeeklyPlan {
  const drop = new Set(documentIds);
  return { ...plan, groups: plan.groups.map((g) => ({ ...g, invoices: g.invoices.map((i) => (drop.has(i.documentId) ? { ...i, attachmentName: null } : i)) })) };
}

export function attachedNames(plan: WeeklyPlan): string[] {
  return plan.groups.flatMap((g) => g.invoices.map((i) => i.attachmentName).filter((n): n is string => !!n));
}

// ---------------------------------------------------------------- weekly email: text (pure)
export interface WeeklyEmail {
  skipped: boolean;
  subject: string;
  text: string;
  html: string;
  questionIds: string[];
}

const DIVIDER = "----------------------------------------";

function invoiceHeading(i: WeeklyInvoice): string {
  const num = i.invoiceNumber ? `invoice ${i.invoiceNumber}` : "no invoice number";
  return `${i.supplier}, ${num}, ${dayLabel(i.invoiceDate)}`;
}

function pdfLine(i: WeeklyInvoice): string {
  return i.attachmentName ? `PDF attached: ${i.attachmentName}` : "No PDF attached, so open it in the app.";
}

function headerLine(plan: WeeklyPlan): string {
  const q = plural(plan.questionIds.length, "question", "questions");
  const inv = plural(plan.invoiceCount, "invoice", "invoices");
  const n = attachedNames(plan).length;
  const rest = plan.invoiceCount - n;
  let pdfs: string;
  if (plan.invoiceCount === 0 || n === 0) pdfs = "No PDFs attached, so the managers open each one in the app";
  else if (rest > 0) pdfs = `${plural(n, "PDF", "PDFs")} attached, and the other ${rest} ${rest === 1 ? "is" : "are"} in the app`;
  else pdfs = n === 1 ? "PDF attached" : "PDFs attached";
  return `Forward everything below the line to Mon and Matt. ${q}, ${inv}, ${pdfs}.`;
}

/** The whole weekly email (subject, plain text, HTML), or `skipped: true` when no question is due. */
export function buildWeeklyEmail(plan: WeeklyPlan, opts: { origin: string; now: Date }): WeeklyEmail {
  if (plan.questionIds.length === 0) return { skipped: true, subject: "", text: "", html: "", questionIds: [] };
  const subject = `Invoice questions for the week of ${mondayLabel(opts.now)}`;
  const answerUrl = `${opts.origin}/invoices/questions`;
  const intro = "These are the invoice questions waiting on you this week. Each one takes a few seconds in the CFP App.";
  const header = headerLine(plan);

  // plain text
  const t: string[] = [header, DIVIDER, "", "Hi Mon and Matt,", "", intro, ""];
  for (const g of plan.groups) {
    t.push(g.name.toUpperCase(), "");
    for (const i of g.invoices) {
      t.push(invoiceHeading(i), pdfLine(i));
      i.questions.forEach((q, n) => t.push(`  ${n + 1}. ${q.stillWaiting ? "Still waiting: " : ""}${q.prompt}`));
      t.push("");
    }
    if (g.slug) t.push(`Answer the ${g.name} questions: ${opts.origin}/invoices/questions?venue=${encodeURIComponent(g.slug)}`, "");
  }
  if (plan.moreQuestions > 0) t.push(`${plural(plan.moreQuestions, "more question is", "more questions are")} waiting in the app too.`, "");
  t.push(`Answer them all here: ${answerUrl}`, "", "Thanks,", "Troy and Abbey");
  const text = t.join("\n");

  // html (inline styles only: mail apps ignore a style block)
  const font = "font-family:Arial,Helvetica,sans-serif;color:#222;font-size:15px;line-height:1.5";
  const h: string[] = [];
  h.push(`<div style="${font};max-width:640px">`);
  h.push(`<div style="background:#f3f0ea;border-radius:6px;padding:10px 14px;font-size:13px">${htmlEscape(header)}</div>`);
  h.push(`<hr style="border:0;border-top:1px solid #bbb;margin:16px 0">`);
  h.push(`<p>Hi Mon and Matt,</p><p>${htmlEscape(intro)}</p>`);
  for (const g of plan.groups) {
    h.push(`<h2 style="font-size:17px;margin:22px 0 6px">${htmlEscape(g.name)}</h2>`);
    for (const i of g.invoices) {
      h.push(`<p style="margin:12px 0 2px"><strong>${htmlEscape(invoiceHeading(i))}</strong><br><span style="color:#555;font-size:13px">${htmlEscape(pdfLine(i))}</span></p>`);
      h.push(`<ol style="margin:4px 0 0;padding-left:22px">`);
      for (const q of i.questions) h.push(`<li style="margin:3px 0">${q.stillWaiting ? `<em>Still waiting:</em> ` : ""}${htmlEscape(q.prompt)}</li>`);
      h.push(`</ol>`);
    }
    if (g.slug) h.push(`<p style="margin:10px 0"><a href="${htmlEscape(`${opts.origin}/invoices/questions?venue=${encodeURIComponent(g.slug)}`)}">Answer the ${htmlEscape(g.name)} questions</a></p>`);
  }
  if (plan.moreQuestions > 0) h.push(`<p>${htmlEscape(`${plural(plan.moreQuestions, "more question is", "more questions are")} waiting in the app too.`)}</p>`);
  h.push(`<p style="margin-top:18px"><a href="${htmlEscape(answerUrl)}">Answer them all here</a></p>`);
  h.push(`<p>Thanks,<br>Troy and Abbey</p></div>`);
  const html = h.join("\n");

  return { skipped: false, subject, text, html, questionIds: plan.questionIds };
}

// ---------------------------------------------------------------- the weekly Slack review (the ONLY Slack message)
/*
 * Troy, 25 Oct 2026: "I only want a msg once a week on a Friday morning at 8am with a review from that week." One message for
 * every venue, built from per venue sections so the shared channel can be split into one channel per venue later (call
 * `splitWeeklyByVenue` and post each piece). Plain Australian English, no dashes, one emoji at the very start, no jargon.
 */

/** Every weekly review contains this text, which is how a recorded digest is recognised as the weekly one. */
export const WEEKLY_REVIEW_MARKER = "Invoice review: week to";
/** a second request inside this many days answers "Already sent this week." and posts nothing */
export const WEEKLY_REVIEW_REPEAT_DAYS = 5;
/** the review looks back this many days from the moment it runs */
export const WEEKLY_REVIEW_DAYS = 7;
export const WEEKLY_MAX_MOVES = 5;
export const WEEKLY_MAX_DISCOUNTS = 3;
/** the whole message stays under about this many characters (discounts and moves are dropped one at a time to fit) */
export const WEEKLY_TEXT_LIMIT = 2500;

/** A standing, new or varying supplier discount seen on an invoice this week. */
export interface DiscountNote {
  supplier: string;
  item: string;
  status: "standing" | "seen once" | "varies";
  /** fractions: 0.1662 is 16.6% */
  pctMean: number;
  pctMin: number;
  pctMax: number;
  /** dollars per kg, L or each, ex GST; null when the unit cost was not worked out */
  perUnit: number | null;
  unit: string | null;
}

export interface WeeklyVenueData {
  venueName: string;
  venueSlug: string;
  /** invoices and credit notes read this week */
  invoicesRead: number;
  /** price changes written to the app this week */
  pricesUpdated: number;
  /** prices that matched what the app already had */
  pricesConfirmed: number;
  /** price moves seen on this week's invoices (any order; the builder sorts and caps) */
  moves: AttentionItem[];
  discounts: DiscountNote[];
  /** still to do, now: distinct items to match, prices to approve, other questions to check */
  toMatch: number;
  toApprove: number;
  toCheck: number;
  /** invoices found in scans but not read yet */
  stillReading: number;
}

export interface WeeklyReviewData {
  now: Date;
  /** the app's web address, no trailing slash */
  origin: string;
  venues: WeeklyVenueData[];
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "Fri 30 Oct" for an instant, in Brisbane. */
export function weekdayDayLabel(d: Date): string {
  const p = brisbaneParts(d);
  return `${WEEKDAYS[p.dow]} ${p.day} ${MONTHS[p.m - 1]}`;
}

/** The venue as the owners say it: "Greedy Gringo's" is "Greedy". */
export function shortVenueName(name: string | null | undefined): string {
  const s = plainText(name).replace(/\s+gringo'?s$/i, "").trim();
  return s || "A venue";
}

/** "per kg", "each", "per carton": how a unit price reads after the dollar amount. */
function perUnitWords(unit: string | null | undefined): string {
  const u = plainText(unit).toLowerCase().replace(/\.$/, "");
  if (!u) return "";
  if (u === "ea" || u === "each") return " each";
  if (u === "ctn" || u === "carton") return " per carton";
  if (u === "lt" || u === "ltr" || u === "litre") return " per L";
  return ` per ${slackEscape(u)}`;
}

function listWords(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** "Kingfish fillets (Daniel Street): $68.90 to $74.20 per kg, up 7.7%" */
export function moveLine(m: AttentionItem): string {
  const up = (m.pct ?? 0) > 0;
  const pct = `${(Math.round(Math.abs(m.pct ?? 0) * 1000) / 10).toFixed(1)}%`;
  const prices = `${fmtPrice(m.oldPrice ?? 0)} to ${fmtPrice(m.newPrice ?? 0)}${perUnitWords(m.unit)}`;
  return `• ${slackEscape(tidyItem(m.item))} (${slackEscape(shortSupplier(m.supplier))}): ${prices}, ${up ? "up" : "down"} ${pct}`;
}

const pct1 = (f: number) => `${(Math.round(f * 1000) / 10).toFixed(1)}%`;

/** "Daniel Street takes 16.6% ($6.88 per kg) off Humpty Doo barramundi fillets." */
export function discountLine(d: DiscountNote): string {
  const who = slackEscape(shortSupplier(d.supplier));
  const item = slackEscape(tidyItem(d.item));
  const dollars = d.perUnit != null && d.perUnit > 0 ? ` (${fmtPrice(d.perUnit)}${perUnitWords(d.unit)})` : "";
  if (d.status === "varies") return `• ${who} takes between ${pct1(d.pctMin)} and ${pct1(d.pctMax)} off ${item}.`;
  if (d.status === "seen once") return `• ${who} took ${pct1(d.pctMean)}${dollars} off ${item}.`;
  return `• ${who} takes ${pct1(d.pctMean)}${dollars} off ${item}.`;
}

/** Largest change first (up or down), then item and supplier A to Z so ties always come out the same way. */
export function sortMoves(moves: readonly AttentionItem[]): AttentionItem[] {
  return [...moves].sort(
    (a, b) => Math.abs(b.pct ?? 0) - Math.abs(a.pct ?? 0) || a.item.localeCompare(b.item) || a.supplier.localeCompare(b.supplier) || (a.newPrice ?? 0) - (b.newPrice ?? 0),
  );
}

function venueHasActivity(v: WeeklyVenueData): boolean {
  return v.invoicesRead + v.pricesUpdated + v.pricesConfirmed + v.moves.length + v.discounts.length + v.toMatch + v.toApprove + v.toCheck + v.stillReading > 0;
}

function venueSection(v: WeeklyVenueData, maxMoves: number, maxDiscounts: number): string[] {
  const head: string[] = [];
  if (v.invoicesRead > 0) head.push(plural(v.invoicesRead, "invoice", "invoices"));
  if (v.pricesUpdated > 0) head.push(plural(v.pricesUpdated, "price updated", "prices updated"));
  if (v.pricesConfirmed > 0) head.push(`${v.pricesConfirmed} confirmed as unchanged`);
  const lines: string[] = [`*${slackEscape(shortVenueName(v.venueName))}:* ${head.length ? head.join(", ") : "nothing new this week"}`];

  const moves = sortMoves(v.moves).slice(0, maxMoves);
  if (moves.length > 0) {
    lines.push(moves.length === 1 ? "*Biggest price move* (by percent, up or down):" : `*Biggest price moves* (top ${moves.length} by percent, up or down):`);
    for (const m of moves) lines.push(moveLine(m));
  }
  const discounts = v.discounts.slice(0, maxDiscounts);
  if (discounts.length > 0) {
    lines.push("*Supplier discounts we spotted*:");
    for (const d of discounts) lines.push(discountLine(d));
  }
  const todo: string[] = [];
  if (v.toMatch > 0) todo.push(`${plural(v.toMatch, "item", "items")} to match`);
  if (v.toApprove > 0) todo.push(`${plural(v.toApprove, "price", "prices")} to approve`);
  if (v.toCheck > 0) todo.push(`${v.toCheck} to check`);
  if (todo.length) lines.push(`*Still to do*: ${todo.join(", ")}.`);
  if (v.stillReading > 0) lines.push(`*Reading*: ${v.stillReading} ${v.stillReading === 1 ? "invoice is" : "invoices are"} still being read.`);
  return lines;
}

function summaryLine(venues: WeeklyVenueData[]): string {
  const read = venues.reduce((n, v) => n + v.invoicesRead, 0);
  const updated = venues.reduce((n, v) => n + v.pricesUpdated, 0);
  const confirmed = venues.reduce((n, v) => n + v.pricesConfirmed, 0);
  const readAt = venues.filter((v) => v.invoicesRead > 0);
  const where = listWords(readAt.map((v) => slackEscape(shortVenueName(v.venueName))));
  const first = read > 0 ? `${plural(read, "invoice", "invoices")} read ${readAt.length > 1 ? "across" : "at"} ${where}.` : "No new invoices were read this week.";
  let prices: string;
  if (updated > 0 && confirmed > 0) prices = `${plural(updated, "price", "prices")} updated, ${confirmed} confirmed as unchanged.`;
  else if (updated > 0) prices = `${plural(updated, "price", "prices")} updated.`;
  else if (confirmed > 0) prices = `${plural(confirmed, "price", "prices")} confirmed as unchanged.`;
  else prices = read > 0 ? "No prices changed." : "";
  return prices ? `${first} ${prices}` : first;
}

function renderWeekly(d: WeeklyReviewData, maxMoves: number, maxDiscounts: number): string {
  const headline = `:receipt: *${WEEKLY_REVIEW_MARKER} ${weekdayDayLabel(d.now)}*`;
  const active = d.venues.filter(venueHasActivity);
  if (active.length === 0) return `${headline}\nNothing new this week. All caught up.`;

  const out: string[] = [headline, summaryLine(active)];
  for (const v of active) {
    out.push("");
    out.push(...venueSection(v, maxMoves, maxDiscounts));
  }
  const open = active.reduce((n, v) => n + v.toMatch + v.toApprove + v.toCheck, 0);
  out.push("");
  if (open > 0) {
    const origin = d.origin.replace(/[<>|\s]/g, "").replace(/\/+$/, "");
    out.push(`<${origin}/invoices?tab=todo|Open Invoices>`);
  } else {
    out.push("Nothing is waiting on you.");
  }
  return out.join("\n");
}

/**
 * The one Slack message of the week: headline, a summary line, then a section for each venue that had anything happen or
 * anything waiting. A quiet week still says so in one line. If the text would pass about 2500 characters, discounts and then
 * price moves are trimmed (never the counts) until it fits.
 */
export function buildWeeklyReview(d: WeeklyReviewData): string {
  let text = renderWeekly(d, WEEKLY_MAX_MOVES, WEEKLY_MAX_DISCOUNTS);
  for (const [moves, discounts] of [[4, 3], [3, 2], [2, 1], [1, 1], [1, 0], [0, 0]] as const) {
    if (text.length <= WEEKLY_TEXT_LIMIT) break;
    text = renderWeekly(d, moves, discounts);
  }
  if (text.length > WEEKLY_TEXT_LIMIT) {
    const cut = text.slice(0, WEEKLY_TEXT_LIMIT);
    const nl = cut.lastIndexOf("\n");
    text = nl > 0 ? cut.slice(0, nl) : cut;
  }
  return text;
}

/** One review per venue, for the day the shared channel is split into a channel for each venue. */
export function splitWeeklyByVenue(d: WeeklyReviewData): WeeklyReviewData[] {
  return d.venues.map((v) => ({ ...d, venues: [v] }));
}

/** True when a recorded digest body is a weekly review (the idempotency check reads this). */
export function isWeeklyReviewBody(body: string | null | undefined): boolean {
  return typeof body === "string" && body.includes(WEEKLY_REVIEW_MARKER);
}
