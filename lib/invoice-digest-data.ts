/**
 * Invoice digests: the database side. Reads what the two messages need through any supabase-js client (the routes pass a service
 * role client because the scanner script has no signed-in user), hands plain rows to the pure builders in lib/invoice-digest.ts,
 * posts the Slack message and records what was sent in `invoice_digests`, so nothing is announced twice.
 *
 * Assembly, ordering, caps and grouping are pure functions (`assembleSlackData`, `planWeekly`) and tested without a database.
 * The webhook address and the service key are read from the environment and never written to a log, a reply or an error message.
 */
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getServiceClient as baseServiceClient, insertRow } from "./supabase/service";
import { MIN_SECRET_LENGTH } from "./invoice-auth";
import { INVOICE_ENV, INVOICE_SETTING_KEYS, DEFAULT_INVOICE_SETTINGS } from "./invoice-types";
import { SAME_PRICE_EPS } from "./invoice-guards";
import { descKey, normCode } from "./invoice-names";
import { loadDiscountGroups } from "./invoice-discount-data";
import type { DiscountGroup } from "./invoice-discounts";
import {
  DEFAULT_APP_ORIGIN,
  WEEKLY_REVIEW_DAYS,
  WEEKLY_REVIEW_REPEAT_DAYS,
  brisbaneParts,
  buildSlackDigest,
  buildWeeklyReview,
  isWeeklyReviewBody,
  planWeekly,
  shortSupplier,
  withoutAttachments,
  type AttentionItem,
  type DiscountNote,
  type SlackDigestData,
  type VenueIn,
  type WeeklyDocIn,
  type WeeklyPlan,
  type WeeklyQuestionIn,
  type WeeklyReviewData,
  type WeeklyVenueData,
} from "./invoice-digest";

const BUCKET = "invoice-pdfs";
const SIGNED_URL_SECONDS = 600;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------- secret and client
export type SecretCheck = "ok" | "denied" | "not_configured";

/** Constant-time comparison (both sides hashed to the same length first). Kept local so this file stands alone. */
export function secretOk(provided: string | null | undefined, expected: string | null | undefined): boolean {
  if (!provided || !expected) return false;
  const a = createHash("sha256").update(provided.trim()).digest();
  const b = createHash("sha256").update(expected.trim()).digest();
  return timingSafeEqual(a, b);
}

/** Checks the `x-invoice-secret` header value against INVOICE_INGEST_SECRET. A secret that is not set, or is shorter than 24 characters, never lets anyone in. */
export function checkSecret(headerValue: string | null | undefined, env: Record<string, string | undefined> = process.env): SecretCheck {
  const expected = env[INVOICE_ENV.ingestSecret]?.trim();
  if (!expected || expected.length < MIN_SECRET_LENGTH) return "not_configured";
  return secretOk(headerValue, expected) ? "ok" : "denied";
}

export class DigestConfigError extends Error {}

/**
 * The routes these two digests serve are called by the scanner script with no login, so the middleware must let exactly these
 * paths through (they check the shared secret themselves). Add them to INVOICE_INGEST_PATHS in lib/invoice-auth.ts.
 */
export const INVOICE_DIGEST_PATHS = ["/api/invoices/digest", "/api/invoices/weekly"];

/** The shared service role client (bypasses RLS), with a plain message when the key is not set up yet. */
export function getServiceClient(env: Record<string, string | undefined> = process.env): SupabaseClient {
  try {
    return baseServiceClient(env);
  } catch {
    throw new DigestConfigError("The database key for invoices is not set up yet.");
  }
}

/** The app's web address for links: INVOICE_APP_ORIGIN when set, else the live address. No trailing slash. */
export function appOrigin(env: Record<string, string | undefined> = process.env): string {
  return (env.INVOICE_APP_ORIGIN?.trim() || DEFAULT_APP_ORIGIN).replace(/\/+$/, "");
}

export function isUuid(s: unknown): s is string {
  return typeof s === "string" && UUID_RE.test(s);
}

/** Keeps only well formed, distinct ids (at most `max`). Returns null when the input is not a list of ids at all. */
export function cleanIds(input: unknown, max = 500): string[] | null {
  if (!Array.isArray(input)) return null;
  if (!input.every(isUuid)) return null;
  return [...new Set(input as string[])].slice(0, max);
}

// ---------------------------------------------------------------- small query helpers
type Row = Record<string, unknown>;

async function all<T = Row>(q: PromiseLike<{ data: unknown; error: { message: string } | null }>, what: string): Promise<T[]> {
  const { data, error } = await q;
  if (error) throw new Error(`Could not read ${what}.`);
  return (data ?? []) as T[];
}

function chunks<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

async function loadVenues(sb: SupabaseClient): Promise<VenueIn[]> {
  const rows = await all<{ id: number; name: string; slug: string; sort: number | null }>(sb.from("cost_venues").select("id, name, slug, sort"), "venues");
  return rows.map((v) => ({ id: v.id, name: v.name, slug: v.slug, sort: v.sort ?? 0 }));
}

async function loadSupplierNames(sb: SupabaseClient, ids: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const part of chunks([...new Set(ids)], 100)) {
    const rows = await all<{ id: string; name: string }>(sb.from("invoice_suppliers").select("id, name").in("id", part), "suppliers");
    for (const r of rows) map.set(r.id, r.name);
  }
  return map;
}

// ---------------------------------------------------------------- Slack: assembly (pure)
export interface SlackRawDoc {
  id: string;
  venue_id: number;
  supplier_id: string | null;
  supplier_name_read: string | null;
  doc_type: string;
  status: string;
}
export interface SlackRawLine {
  document_id: string;
  line_no: number;
  line_class: string;
  description: string;
  unit: string | null;
  unit_price_ex: number | null;
  change_pct: number | null;
  old_pack_price: number | null;
  new_pack_price: number | null;
  old_product_price: number | null;
  new_product_price: number | null;
  decision: string;
  state: string;
}
export interface SlackRaw {
  docs: SlackRawDoc[];
  lines: SlackRawLine[];
  /** price changes written (status applied, kind price_change) */
  changes: { document_id: string }[];
  questions: { document_id: string; kind: string; status: string }[];
  supplierNames: Map<string, string>;
  venues: VenueIn[];
  autoApplyPct: number;
}

/** One line that needs a person, as the old and new invoice unit price (ex GST). */
export function toAttentionItem(line: SlackRawLine, supplier: string): AttentionItem {
  const pct = line.change_pct == null ? null : Number(line.change_pct);
  let newPrice: number | null = line.unit_price_ex == null ? null : Number(line.unit_price_ex);
  let oldPrice: number | null = null;
  if (newPrice != null && pct != null && pct > -1) oldPrice = Math.round((newPrice / (1 + pct)) * 100) / 100;
  if (newPrice == null) {
    // no invoice unit price on the line: fall back to what the app compared (pack, then ordering product)
    if (line.new_pack_price != null) {
      newPrice = Number(line.new_pack_price);
      oldPrice = line.old_pack_price == null ? null : Number(line.old_pack_price);
    } else if (line.new_product_price != null) {
      newPrice = Number(line.new_product_price);
      oldPrice = line.old_product_price == null ? null : Number(line.old_product_price);
    }
  }
  return { supplier, item: line.description, oldPrice, newPrice, unit: line.unit, pct };
}

/** One SlackDigestData per venue that has documents in this run. Duplicates and ignored documents are left out entirely. */
export function assembleSlackData(raw: SlackRaw, origin: string): SlackDigestData[] {
  const live = raw.docs.filter((d) => d.status !== "duplicate");
  const docById = new Map(live.map((d) => [d.id, d]));
  const venueById = new Map(raw.venues.map((v) => [v.id, v]));
  const byVenue = new Map<number, SlackDigestData>();

  const get = (venueId: number): SlackDigestData => {
    let d = byVenue.get(venueId);
    if (!d) {
      const v = venueById.get(venueId);
      d = {
        venueName: v?.name ?? "Venue",
        venueSlug: v?.slug ?? "",
        origin,
        invoices: 0,
        pricesUpdated: 0,
        needApproval: 0,
        needApprovalAllOver: true,
        autoApplyPct: raw.autoApplyPct,
        questions: 0,
        failed: 0,
        items: [],
      };
      byVenue.set(venueId, d);
    }
    return d;
  };

  for (const doc of live) {
    const d = get(doc.venue_id);
    if (doc.status === "failed") d.failed++;
    else if ((doc.doc_type === "invoice" || doc.doc_type === "credit_note") && doc.status !== "ignored") d.invoices++;
  }
  for (const c of raw.changes) {
    const doc = docById.get(c.document_id);
    if (doc) get(doc.venue_id).pricesUpdated++;
  }
  for (const q of raw.questions) {
    const doc = docById.get(q.document_id);
    // "approve this price" questions are already counted as lines waiting for approval
    if (doc && q.status === "open" && q.kind !== "big_change") get(doc.venue_id).questions++;
  }
  for (const l of raw.lines) {
    const doc = docById.get(l.document_id);
    if (!doc || l.decision !== "needs_approval" || l.state !== "open" || l.line_class !== "product") continue;
    const d = get(doc.venue_id);
    d.needApproval++;
    const pct = l.change_pct == null ? null : Math.abs(Number(l.change_pct));
    if (pct == null || pct < raw.autoApplyPct - 1e-9) d.needApprovalAllOver = false;
    const supplier = shortSupplier((doc.supplier_id && raw.supplierNames.get(doc.supplier_id)) || doc.supplier_name_read);
    d.items.push(toAttentionItem(l, supplier));
  }
  return [...byVenue.entries()].sort((a, b) => (venueById.get(a[0])?.sort ?? 0) - (venueById.get(b[0])?.sort ?? 0) || a[0] - b[0]).map(([, d]) => d);
}

// ---------------------------------------------------------------- Slack: queries, posting, record
async function loadSlackRaw(sb: SupabaseClient, ids: string[]): Promise<SlackRaw> {
  const docs: SlackRawDoc[] = [];
  const lines: SlackRawLine[] = [];
  const changes: { document_id: string }[] = [];
  const questions: { document_id: string; kind: string; status: string }[] = [];
  for (const part of chunks(ids, 100)) {
    docs.push(...(await all<SlackRawDoc>(sb.from("invoice_documents").select("id, venue_id, supplier_id, supplier_name_read, doc_type, status").in("id", part), "documents")));
    lines.push(
      ...(await all<SlackRawLine>(
        sb
          .from("invoice_lines")
          .select("document_id, line_no, line_class, description, unit, unit_price_ex, change_pct, old_pack_price, new_pack_price, old_product_price, new_product_price, decision, state")
          .in("document_id", part)
          .eq("decision", "needs_approval")
          .eq("state", "open"),
        "invoice lines",
      )),
    );
    changes.push(...(await all<{ document_id: string }>(sb.from("invoice_price_changes").select("document_id").in("document_id", part).eq("status", "applied").eq("kind", "price_change"), "price changes")));
    questions.push(...(await all<{ document_id: string; kind: string; status: string }>(sb.from("invoice_questions").select("document_id, kind, status").in("document_id", part).eq("status", "open"), "questions")));
  }
  const settings = await all<{ key: string; value: number }>(sb.from("cost_settings").select("key, value").eq("key", INVOICE_SETTING_KEYS.autoApplyPct), "settings");
  const autoApplyPct = settings.length && Number.isFinite(Number(settings[0].value)) ? Number(settings[0].value) : DEFAULT_INVOICE_SETTINGS.autoApplyPct;
  const supplierNames = await loadSupplierNames(sb, docs.map((d) => d.supplier_id).filter((s): s is string => !!s));
  return { docs, lines, changes, questions, supplierNames, venues: await loadVenues(sb), autoApplyPct };
}

/** Document ids that an earlier Slack digest already covered. */
async function alreadyAnnounced(sb: SupabaseClient, ids: string[]): Promise<Set<string>> {
  const done = new Set<string>();
  const rows = await all<{ document_ids: string[] | null }>(sb.from("invoice_digests").select("document_ids").eq("kind", "slack").overlaps("document_ids", ids), "earlier digests");
  for (const r of rows) for (const id of r.document_ids ?? []) done.add(id);
  return done;
}

/** Posts `{ text }` to a Slack incoming webhook. Five second limit. Returns false on any failure (the address is never logged). */
export async function postToSlack(webhookUrl: string, text: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 5000);
  try {
    const res = await fetchImpl(webhookUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }), signal: ctl.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export interface NotifyOptions {
  origin?: string;
  /** defaults to INVOICE_SLACK_WEBHOOK_URL; null or empty means "no Slack": nothing is posted or recorded */
  webhookUrl?: string | null;
  fetchImpl?: typeof fetch;
  now?: Date;
  /** build the text only: post nothing, record nothing */
  dryRun?: boolean;
}

export interface NotifyMessage {
  venueSlug: string;
  text: string;
  posted: boolean;
  documentIds: string[];
}

export interface NotifyResult {
  /** true when at least one message went to Slack */
  sent: boolean;
  /** every message built, joined by a blank line; null when the run was quiet */
  text: string | null;
  messages: NotifyMessage[];
  /** documents left out because an earlier digest already announced them */
  alreadyAnnounced: number;
}

/**
 * Builds (and, when a webhook is set, posts and records) the Slack digest for these documents: one message per venue, none for a
 * quiet venue. A document already inside an earlier Slack digest is not announced again. A message that fails to post is not
 * recorded, so the next call tries it again.
 */
export async function notifyDocuments(sb: SupabaseClient, documentIds: string[], opts: NotifyOptions = {}): Promise<NotifyResult> {
  const ids = [...new Set(documentIds.filter(isUuid))];
  if (ids.length === 0) return { sent: false, text: null, messages: [], alreadyAnnounced: 0 };
  const done = await alreadyAnnounced(sb, ids);
  const fresh = ids.filter((id) => !done.has(id));
  if (fresh.length === 0) return { sent: false, text: null, messages: [], alreadyAnnounced: ids.length };

  const raw = await loadSlackRaw(sb, fresh);
  const origin = opts.origin ?? appOrigin();
  const webhook = opts.webhookUrl === undefined ? process.env[INVOICE_ENV.slackWebhook]?.trim() : opts.webhookUrl?.trim();
  const now = opts.now ?? new Date();
  const messages: NotifyMessage[] = [];

  for (const data of assembleSlackData(raw, origin)) {
    const text = buildSlackDigest(data);
    if (!text) continue;
    const venueDocs = raw.docs.filter((d) => d.status !== "duplicate" && raw.venues.find((v) => v.id === d.venue_id)?.slug === data.venueSlug).map((d) => d.id);
    let posted = false;
    if (webhook && !opts.dryRun) {
      posted = await postToSlack(webhook, text, opts.fetchImpl);
      if (posted) await recordSlack(sb, raw, data.venueSlug, venueDocs, text, now);
    }
    messages.push({ venueSlug: data.venueSlug, text, posted, documentIds: venueDocs });
  }
  return { sent: messages.some((m) => m.posted), text: messages.length ? messages.map((m) => m.text).join("\n\n") : null, messages, alreadyAnnounced: ids.length - fresh.length };
}

async function recordSlack(sb: SupabaseClient, raw: SlackRaw, venueSlug: string, documentIds: string[], body: string, now: Date): Promise<void> {
  const venue = raw.venues.find((v) => v.slug === venueSlug);
  const questionIds: string[] = [];
  const { error } = await insertRow(sb, "invoice_digests", {
    id: randomUUID(),
    kind: "slack",
    venue_id: venue?.id,
    period_from: now.toISOString(),
    period_to: now.toISOString(),
    document_ids: documentIds,
    question_ids: questionIds,
    body,
    sent_at: now.toISOString(),
  });
  if (error) console.warn("invoice digest: could not record the Slack message");
}

// ---------------------------------------------------------------- weekly email: queries
/** Size of a stored PDF in bytes (from the storage listing), or null when it cannot be read. */
export async function pdfSize(sb: SupabaseClient, path: string): Promise<number | null> {
  try {
    const slash = path.lastIndexOf("/");
    const dir = slash >= 0 ? path.slice(0, slash) : "";
    const file = slash >= 0 ? path.slice(slash + 1) : path;
    const { data, error } = await sb.storage.from(BUCKET).list(dir, { search: file, limit: 10 });
    if (error || !data) return null;
    const hit = data.find((f) => f.name === file);
    const size = (hit?.metadata as { size?: number } | undefined)?.size;
    return typeof size === "number" ? size : null;
  } catch {
    return null;
  }
}

/** The plan for this week's email, read from the database. */
export async function loadWeeklyPlan(sb: SupabaseClient, now: Date): Promise<WeeklyPlan> {
  const questions = await all<WeeklyQuestionIn>(
    sb.from("invoice_questions").select("id, venue_id, document_id, prompt, emailed_at, created_at").eq("status", "open").order("created_at", { ascending: true }).limit(1000),
    "questions",
  );
  const docIds = [...new Set(questions.map((q) => q.document_id))];
  const rawDocs: Row[] = [];
  for (const part of chunks(docIds, 100)) {
    rawDocs.push(...(await all(sb.from("invoice_documents").select("id, venue_id, supplier_id, supplier_name_read, invoice_number, invoice_date, page_pdf_path, status").in("id", part), "documents")));
  }
  const names = await loadSupplierNames(sb, rawDocs.map((d) => d.supplier_id as string | null).filter((s): s is string => !!s));
  const docs: WeeklyDocIn[] = [];
  for (const d of rawDocs) {
    const path = (d.page_pdf_path as string | null) ?? null;
    docs.push({
      id: d.id as string,
      venue_id: d.venue_id as number,
      supplier: names.get(d.supplier_id as string) || (d.supplier_name_read as string | null),
      invoice_number: d.invoice_number as string | null,
      invoice_date: d.invoice_date as string | null,
      page_pdf_path: path,
      status: d.status as string,
      pdf_bytes: path ? await pdfSize(sb, path) : null,
    });
  }
  return planWeekly({ questions, docs, venues: await loadVenues(sb), now });
}

export interface SignedAttachment {
  name: string;
  /** a 10 minute signed link to the single-invoice PDF */
  url: string;
}

/** Signs a 10 minute link for every attached PDF. An invoice whose link cannot be made loses its attachment (and the email stops naming it). */
export async function signAttachments(sb: SupabaseClient, plan: WeeklyPlan): Promise<{ plan: WeeklyPlan; attachments: SignedAttachment[] }> {
  const attachments: SignedAttachment[] = [];
  const failed: string[] = [];
  for (const g of plan.groups) {
    for (const i of g.invoices) {
      if (!i.attachmentName || !i.pdfPath) continue;
      const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(i.pdfPath, SIGNED_URL_SECONDS);
      if (error || !data?.signedUrl) failed.push(i.documentId);
      else attachments.push({ name: i.attachmentName, url: data.signedUrl });
    }
  }
  return { plan: failed.length ? withoutAttachments(plan, failed) : plan, attachments };
}

/** Marks these questions as emailed now and records one weekly_email digest row. */
export async function markQuestionsEmailed(sb: SupabaseClient, questionIds: string[], now: Date = new Date()): Promise<{ marked: number }> {
  if (questionIds.length === 0) return { marked: 0 };
  const stamp = now.toISOString();
  let docIds: string[] = [];
  for (const part of chunks(questionIds, 100)) {
    const { error } = await sb.from("invoice_questions").update({ emailed_at: stamp }).in("id", part);
    if (error) throw new Error("Could not mark the questions as emailed.");
    const rows = await all<{ document_id: string }>(sb.from("invoice_questions").select("document_id").in("id", part), "questions");
    docIds = docIds.concat(rows.map((r) => r.document_id));
  }
  const { error } = await insertRow(sb, "invoice_digests", {
    id: randomUUID(),
    kind: "weekly_email",
    period_from: stamp,
    period_to: stamp,
    document_ids: [...new Set(docIds)],
    question_ids: questionIds,
    body: `Weekly email of ${questionIds.length} open ${questionIds.length === 1 ? "question" : "questions"}`,
    sent_at: stamp,
  });
  if (error) console.warn("invoice digest: could not record the weekly email");
  return { marked: questionIds.length };
}

// ---------------------------------------------------------------- the weekly Slack review: assembly (pure)
/*
 * Definitions (they match the To Do screens, which count the same way):
 *   items to match   distinct (supplier, item code else description) among the lines of OPEN unmatched_line and ambiguous_match
 *                    questions on documents that are not duplicate, failed or ignored
 *   prices to approve  open product lines with decision needs_approval or apply whose new price differs from the old
 *   to check         open questions of kind unit_unclear, totals_mismatch, credit_unclear, other, and new_supplier ones that
 *                    mention an ABN mismatch
 *   invoices read    invoices and credit notes created in the period that have been read (a read_model, or a status other than
 *                    needs_review), not duplicate, failed or ignored
 *   prices updated / confirmed   invoice_price_changes applied in the period, kind price_change / price_confirmed
 *   still being read documents in needs_review with no read_model
 */
const DEAD_DOC = new Set(["duplicate", "failed", "ignored"]);
const CHECK_KINDS = new Set(["unit_unclear", "totals_mismatch", "credit_unclear", "other"]);
const MATCH_KINDS = new Set(["unmatched_line", "ambiguous_match"]);
const READ_DOC_TYPES = new Set(["invoice", "credit_note"]);

export interface WeeklyRawDoc {
  id: string;
  venue_id: number;
  supplier_id: string | null;
  supplier_name_read: string | null;
  doc_type: string;
  status: string;
  read_model: string | null;
  created_at: string;
}
export interface WeeklyRawQuestion {
  id: string;
  venue_id: number;
  document_id: string;
  line_id: string | null;
  kind: string;
  prompt: string;
}
export interface WeeklyRawLine extends SlackRawLine {
  id: string;
  venue_id: number;
  item_code: string | null;
}
export interface WeeklyRaw {
  now: Date;
  venues: VenueIn[];
  /** every document any of the lists below points at (duplicates are deduplicated by id) */
  docs: WeeklyRawDoc[];
  /** open questions, any age */
  questions: WeeklyRawQuestion[];
  /** the lines the open questions point at (for the item code and description) */
  questionLines: { id: string; document_id: string; item_code: string | null; description: string }[];
  /** open product lines whose decision is needs_approval or apply */
  openLines: WeeklyRawLine[];
  /** the product lines of the documents created in the period */
  periodLines: WeeklyRawLine[];
  /** price changes applied in the period */
  changes: { venue_id: number; kind: string }[];
  supplierNames: Map<string, string>;
  /** supplier discounts by venue id */
  discounts: Map<number, DiscountGroup[]>;
}

const finiteNum = (v: unknown): number | null => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

/** The "prices to approve" test: a pack or ordering product price pair where the new price is not the old one. */
export function priceDiffers(l: Pick<SlackRawLine, "old_pack_price" | "new_pack_price" | "old_product_price" | "new_product_price">): boolean {
  const pair = (oldP: unknown, newP: unknown): boolean => {
    const n = finiteNum(newP);
    if (n == null) return false;
    const o = finiteNum(oldP);
    return o == null || Math.abs(n - o) >= SAME_PRICE_EPS;
  };
  return pair(l.old_pack_price, l.new_pack_price) || pair(l.old_product_price, l.new_product_price);
}

/** yyyy-mm-dd in Brisbane. */
export function brisbaneDay(d: Date): string {
  const p = brisbaneParts(d);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** The review period: the 7 days up to the run. */
export function reviewPeriod(now: Date): { from: Date; to: Date; fromDay: string; toDay: string } {
  const from = new Date(now.getTime() - WEEKLY_REVIEW_DAYS * 24 * 3600 * 1000);
  return { from, to: now, fromDay: brisbaneDay(from), toDay: brisbaneDay(now) };
}

function toDiscountNote(g: DiscountGroup): DiscountNote {
  return {
    supplier: g.supplier,
    item: g.item,
    status: g.status,
    pctMean: g.pct.mean,
    pctMin: g.pct.min,
    pctMax: g.pct.max,
    perUnit: g.perBase ? g.perBase.mean : null,
    unit: g.baseUnit,
  };
}

/** One WeeklyVenueData for every venue, counted by the definitions above. Pure: no database, no clock. */
export function assembleWeeklyData(raw: WeeklyRaw, origin: string): WeeklyReviewData {
  const { from, to, fromDay, toDay } = reviewPeriod(raw.now);
  const docById = new Map(raw.docs.map((d) => [d.id, d]));
  const live = (id: string): WeeklyRawDoc | null => {
    const d = docById.get(id);
    return d && !DEAD_DOC.has(d.status) ? d : null;
  };
  const supplierOf = (d: WeeklyRawDoc): string => shortSupplier((d.supplier_id && raw.supplierNames.get(d.supplier_id)) || d.supplier_name_read);
  const supplierKey = (d: WeeklyRawDoc): string => d.supplier_id ?? `name:${descKey(d.supplier_name_read)}`;

  const venues = new Map<number, WeeklyVenueData>();
  const get = (id: number): WeeklyVenueData => {
    let v = venues.get(id);
    if (!v) {
      const info = raw.venues.find((x) => x.id === id);
      v = { venueName: info?.name ?? "Venue", venueSlug: info?.slug ?? "", invoicesRead: 0, pricesUpdated: 0, pricesConfirmed: 0, moves: [], discounts: [], toMatch: 0, toApprove: 0, toCheck: 0, stillReading: 0 };
      venues.set(id, v);
    }
    return v;
  };
  for (const info of raw.venues) get(info.id);

  // invoices read, and the ones still being read
  const readIds = new Set<string>();
  for (const d of raw.docs) {
    if (DEAD_DOC.has(d.status)) continue;
    if (d.status === "needs_review" && !d.read_model) {
      get(d.venue_id).stillReading++;
      continue;
    }
    const t = Date.parse(d.created_at);
    if (!READ_DOC_TYPES.has(d.doc_type) || Number.isNaN(t) || t < from.getTime() || t > to.getTime()) continue;
    get(d.venue_id).invoicesRead++;
    readIds.add(d.id);
  }

  for (const c of raw.changes) {
    if (c.kind === "price_change") get(c.venue_id).pricesUpdated++;
    else if (c.kind === "price_confirmed") get(c.venue_id).pricesConfirmed++;
  }

  // price moves: this week's read invoices, lines that changed a price (applied, or waiting for a tap)
  for (const l of raw.periodLines) {
    const doc = readIds.has(l.document_id) ? live(l.document_id) : null;
    if (!doc || l.line_class !== "product") continue;
    if (l.decision !== "apply" && l.decision !== "needs_approval") continue;
    if (l.state !== "open" && l.state !== "applied") continue;
    const pct = finiteNum(l.change_pct);
    if (pct == null || pct <= -1 || Math.round(Math.abs(pct) * 1000) === 0) continue;
    const item = toAttentionItem(l, supplierOf(doc));
    if (item.oldPrice == null || item.newPrice == null || item.oldPrice === item.newPrice) continue;
    get(doc.venue_id).moves.push(item);
  }

  // still to do
  const lineById = new Map(raw.questionLines.map((l) => [l.id, l]));
  const matchKeys = new Set<string>();
  for (const q of raw.questions) {
    const doc = live(q.document_id);
    if (!doc) continue;
    if (MATCH_KINDS.has(q.kind)) {
      const line = q.line_id ? lineById.get(q.line_id) : undefined;
      const what = line ? (normCode(line.item_code) ? `code:${normCode(line.item_code)}` : `desc:${descKey(line.description)}`) : `question:${q.id}`;
      const key = `${q.venue_id}|${supplierKey(doc)}|${what}`;
      if (!matchKeys.has(key)) {
        matchKeys.add(key);
        get(q.venue_id).toMatch++;
      }
    } else if (CHECK_KINDS.has(q.kind) || (q.kind === "new_supplier" && /\bABN\b/i.test(q.prompt))) {
      get(q.venue_id).toCheck++;
    }
  }
  for (const l of raw.openLines) {
    if (!live(l.document_id) || l.line_class !== "product" || l.state !== "open") continue;
    if (l.decision !== "needs_approval" && l.decision !== "apply") continue;
    if (priceDiffers(l)) get(l.venue_id).toApprove++;
  }

  // supplier discounts whose latest invoice is new this week
  for (const [venueId, groups] of raw.discounts) {
    const v = get(venueId);
    for (const g of groups) {
      const day = g.latest?.date;
      if (day && day > fromDay && day <= toDay) v.discounts.push(toDiscountNote(g));
    }
  }

  const order = (id: number) => raw.venues.find((x) => x.id === id)?.sort ?? 0;
  const sorted = [...venues.entries()].sort((a, b) => order(a[0]) - order(b[0]) || a[0] - b[0]).map(([, v]) => v);
  return { now: raw.now, origin, venues: sorted };
}

// ---------------------------------------------------------------- the weekly Slack review: queries
const PAGE = 1000;

/** Reads every row of a query, a page at a time (the database returns at most 1000 rows per request). */
async function pageAll<T>(build: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>, what: string): Promise<T[]> {
  const out: T[] = [];
  for (let page = 0; page < 30; page++) {
    const { data, error } = await build(page * PAGE, page * PAGE + PAGE - 1);
    if (error) throw new Error(`Could not read ${what}.`);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

const DOC_COLUMNS = "id, venue_id, supplier_id, supplier_name_read, doc_type, status, read_model, created_at";
const LINE_COLUMNS =
  "id, document_id, venue_id, line_no, line_class, item_code, description, unit, unit_price_ex, change_pct, old_pack_price, new_pack_price, old_product_price, new_product_price, decision, state";

/** Everything the weekly review needs, read once. Any failure throws a plain message (nothing is posted on a failed read). */
export async function loadWeeklyRaw(sb: SupabaseClient, now: Date): Promise<WeeklyRaw> {
  const { from } = reviewPeriod(now);
  const fromIso = from.toISOString();
  const venues = await loadVenues(sb);

  const periodDocs = await pageAll<WeeklyRawDoc>((a, b) => sb.from("invoice_documents").select(DOC_COLUMNS).gte("created_at", fromIso).order("id").range(a, b), "documents");
  const unreadDocs = await pageAll<WeeklyRawDoc>((a, b) => sb.from("invoice_documents").select(DOC_COLUMNS).eq("status", "needs_review").is("read_model", null).order("id").range(a, b), "documents");
  const questions = await pageAll<WeeklyRawQuestion>((a, b) => sb.from("invoice_questions").select("id, venue_id, document_id, line_id, kind, prompt").eq("status", "open").order("id").range(a, b), "questions");
  const openLines = await pageAll<WeeklyRawLine>(
    (a, b) => sb.from("invoice_lines").select(LINE_COLUMNS).eq("state", "open").eq("line_class", "product").in("decision", ["needs_approval", "apply"]).order("id").range(a, b),
    "invoice lines",
  );
  const changes = await pageAll<{ venue_id: number; kind: string }>(
    (a, b) => sb.from("invoice_price_changes").select("id, venue_id, kind").eq("status", "applied").gte("applied_at", fromIso).order("id").range(a, b),
    "price changes",
  );

  // the lines behind the "match" questions, and the documents anything above points at that we do not have yet
  const lineIds = [...new Set(questions.filter((q) => MATCH_KINDS.has(q.kind) && q.line_id).map((q) => q.line_id as string))];
  const questionLines: WeeklyRaw["questionLines"] = [];
  for (const part of chunks(lineIds, 100)) {
    questionLines.push(...(await all<WeeklyRaw["questionLines"][number]>(sb.from("invoice_lines").select("id, document_id, item_code, description").in("id", part), "invoice lines")));
  }

  const docs = new Map<string, WeeklyRawDoc>();
  for (const d of [...periodDocs, ...unreadDocs]) docs.set(d.id, d);
  const need = new Set<string>([...questions.map((q) => q.document_id), ...openLines.map((l) => l.document_id)]);
  const missing = [...need].filter((id) => !docs.has(id));
  for (const part of chunks(missing, 100)) {
    for (const d of await all<WeeklyRawDoc>(sb.from("invoice_documents").select(DOC_COLUMNS).in("id", part), "documents")) docs.set(d.id, d);
  }

  // lines of this week's read invoices, for the price moves
  const periodLines: WeeklyRawLine[] = [];
  const readPeriodIds = periodDocs.filter((d) => READ_DOC_TYPES.has(d.doc_type) && !DEAD_DOC.has(d.status) && !(d.status === "needs_review" && !d.read_model)).map((d) => d.id);
  for (const part of chunks(readPeriodIds, 50)) {
    periodLines.push(...(await pageAll<WeeklyRawLine>((a, b) => sb.from("invoice_lines").select(LINE_COLUMNS).in("document_id", part).eq("line_class", "product").order("id").range(a, b), "invoice lines")));
  }

  const supplierNames = await loadSupplierNames(sb, [...docs.values()].map((d) => d.supplier_id).filter((s): s is string => !!s));
  const discounts = new Map<number, DiscountGroup[]>();
  for (const v of venues) discounts.set(v.id, (await loadDiscountGroups(sb, { venueId: v.id })).groups);

  return { now, venues, docs: [...docs.values()], questions, questionLines, openLines, periodLines, changes, supplierNames, discounts };
}

// ---------------------------------------------------------------- the weekly Slack review: send
export interface WeeklySendOptions {
  origin?: string;
  /** defaults to INVOICE_SLACK_WEBHOOK_URL; null or empty means "no Slack": nothing is posted or recorded */
  webhookUrl?: string | null;
  fetchImpl?: typeof fetch;
  now?: Date;
  /** build the text only: post nothing, record nothing, and skip the "already sent" check */
  dryRun?: boolean;
}

export interface WeeklySendResult {
  sent: boolean;
  /** the review text; null only when it was not built because this week's review already went out */
  text: string | null;
  note?: string;
}

/** True when a weekly review was recorded as sent in the last few days. */
export async function weeklyAlreadySent(sb: SupabaseClient, now: Date): Promise<boolean> {
  const since = new Date(now.getTime() - WEEKLY_REVIEW_REPEAT_DAYS * 24 * 3600 * 1000).toISOString();
  const rows = await all<{ document_ids: string[] | null; body: string | null }>(sb.from("invoice_digests").select("document_ids, body").eq("kind", "slack").gte("sent_at", since), "earlier digests");
  return rows.some((r) => (r.document_ids ?? []).length === 0 && isWeeklyReviewBody(r.body));
}

/** The weekly review text for the week to `now`, read from the database. Posts nothing. */
export async function buildWeeklyReviewText(sb: SupabaseClient, now: Date, origin: string): Promise<string> {
  return buildWeeklyReview(assembleWeeklyData(await loadWeeklyRaw(sb, now), origin));
}

/**
 * Builds the weekly review and, when a webhook is set, posts it to Slack and records ONE invoice_digests row. Answers
 * "Already sent this week." (and posts nothing) when a weekly review was recorded in the last 5 days, so a double trigger can
 * never send twice. With no webhook the text comes back and nothing is recorded; a post Slack refuses is not recorded either.
 */
export async function sendWeeklyReview(sb: SupabaseClient, opts: WeeklySendOptions = {}): Promise<WeeklySendResult> {
  const now = opts.now ?? new Date();
  if (!opts.dryRun && (await weeklyAlreadySent(sb, now))) return { sent: false, text: null, note: "Already sent this week." };

  const text = await buildWeeklyReviewText(sb, now, opts.origin ?? appOrigin());
  if (opts.dryRun) return { sent: false, text };
  const webhook = opts.webhookUrl === undefined ? process.env[INVOICE_ENV.slackWebhook]?.trim() : opts.webhookUrl?.trim();
  if (!webhook) return { sent: false, text, note: "No Slack address is set up." };

  if (!(await postToSlack(webhook, text, opts.fetchImpl))) return { sent: false, text, note: "Slack did not accept the message." };
  const { from } = reviewPeriod(now);
  const { error } = await insertRow(sb, "invoice_digests", {
    id: randomUUID(),
    kind: "slack",
    period_from: from.toISOString(),
    period_to: now.toISOString(),
    document_ids: [],
    question_ids: [],
    body: text,
    sent_at: now.toISOString(),
  });
  if (error) console.warn("invoice digest: could not record the weekly review");
  return { sent: true, text };
}
