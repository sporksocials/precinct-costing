/**
 * Invoices: a person answers a question (tap on Home, in the weekly email's link, or a review screen). The answer is recorded,
 * what it teaches is stored (invoice_item_map), the document is re-analysed with that knowledge, and anything the rules now
 * allow is applied. Takes ANY Supabase client. The engine is passed in (`deps.analyse`) so tests can fake it; by default it is
 * loaded on demand.
 *
 * An answer is recorded only AFTER its effect worked: a stale price on "Approve This Price" leaves the question open.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { brisbaneToday } from "./deals";
import { applyDocumentAuto, applyLine } from "./invoice-apply";
import { fetchAll, loadAnalyseContext } from "./invoice-context";
import { insertRow } from "./invoice-insert";
import { descKey, normCode } from "./invoice-names";
import type { AnalyseInvoice, AnswerQuestion, AnswerResult, ApplyResult } from "./invoice-interfaces";
import { saveAnalysis } from "./invoice-store";
import type {
  ExtractedInvoice,
  ExtractedLine,
  InvoiceChargeRuleRow,
  InvoiceDocumentRow,
  InvoiceItemMapRow,
  InvoiceLineRow,
  InvoiceQuestionRow,
  QuestionOption,
  ReconNote,
} from "./invoice-types";

export interface AnswerDeps {
  /** the engine; defaults to lib/invoice-engine.ts, loaded on demand */
  analyse?: AnalyseInvoice;
  /** Brisbane yyyy-mm-dd, injected by tests */
  today?: string;
}

function check<T extends { error: any }>(res: T, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message ?? "database error"}`);
  return res;
}

/**
 * Rebuilds the reader's output from what is stored, so a document can be analysed again without reading the PDF again.
 * Stored prices are already ex GST, so every line comes back with basis "ex". The reader's free-text notes are not stored.
 */
export function extractedFromStored(doc: InvoiceDocumentRow, lines: InvoiceLineRow[]): ExtractedInvoice {
  const sorted = [...lines].sort((a, b) => a.line_no - b.line_no);
  return {
    doc_type: doc.doc_type,
    supplier_name: doc.supplier_name_read,
    supplier_abn: doc.supplier_abn_read,
    invoice_number: doc.invoice_number,
    invoice_date: doc.invoice_date,
    due_date: doc.due_date,
    bill_to: doc.bill_to,
    ship_to: doc.ship_to,
    pages: doc.pages ?? [],
    subtotal_ex: numOrNull(doc.subtotal_ex),
    gst_total: numOrNull(doc.gst_total),
    total_inc: numOrNull(doc.total_inc),
    lines: sorted.map((l): ExtractedLine => {
      const qty = numOrNull(l.qty);
      const unit = numOrNull(l.unit_price_ex);
      const total = numOrNull(l.line_total_ex);
      const line: ExtractedLine = {
        line_no: l.line_no,
        page: l.page ?? 1,
        item_code: l.item_code,
        description: l.description,
        qty,
        unit: l.unit,
        unit_price: unit,
        line_total: total,
        basis: "ex",
        gst: l.gst,
        class_hint: l.line_class,
      };
      // A discount printed on the line itself is stored as the LIST price in unit_price_ex, the NET amount in line_total_ex and the
      // dollars off in line_discount_ex (a same-code negative line also fills line_discount_ex, but then the line total is still
      // gross). So the printed part is the gap between qty x list price and the net total, and only a gap the stored discount can
      // explain counts: a line whose maths already failed (math_ok false) or whose gap is bigger than the discount stays unexplained
      // and fails again. The tolerance is the reconciliation's own (max(2c, qty x half a cent + 1c)).
      const disc = numOrNull(l.line_discount_ex);
      if (l.line_class === "product" && l.math_ok !== false && disc != null && disc > 0 && qty != null && qty !== 0 && unit != null && total != null) {
        const tol = Math.max(0.02, Math.abs(qty) * 0.005 + 0.01);
        const gap = qty * unit - total;
        if (gap > tol && gap <= disc + tol) {
          line.discount_amount = Math.round(gap * 100) / 100;
          line.total_basis = "ex";
        }
      }
      return line;
    }),
    notes: [],
  };
}

function numOrNull(v: unknown): number | null {
  return v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v);
}

/** A pack count above zero, or null (a blank, zero or garbage value is "not said"). */
function positiveOrNull(v: unknown): number | null {
  const n = numOrNull(v);
  return n !== null && n > 0 ? n : null;
}

type MapTarget = { ingredientId: string | null; productId: string | null };

/**
 * Remembers a match (or a "not a product") for this supplier and item code, or description when the line has no code.
 *
 * A row belongs to a VENUE SCOPE and only ever reads, updates or replaces rows in its own scope: `venueId` is the document's venue
 * for an answer that names an ordering product (that product exists in one venue only) and null (every venue) for an ingredient-only
 * answer. Drift's saved match is never touched by a Chiobu answer for the same supplier and code. Within a scope, one row per code
 * (or description) holds the answer: a different target is a correction and updates that row, an earlier "not that" for the same
 * target flips its flag. `packs` is only what a person (or the engine, safely) stated; otherwise the column stays null and the
 * engine asks the unit question itself. `alsoClear` is the extra scope a "not a product" answer also clears of positive matches.
 */
async function learnMap(
  sb: SupabaseClient,
  a: { supplierId: string; venueId: number | null; line: InvoiceLineRow; target: MapTarget; packs: number | null; rejected: boolean; actor: string; alsoClear?: number | null },
): Promise<void> {
  const code = a.line.item_code?.trim() || null;
  const dkey = code ? null : descKey(a.line.description) || null;
  if (!code && !dkey) throw new Error("This line has no item code or description to remember.");
  const scope = a.venueId ?? null;
  const wanted = code ? normCode(code) : null;
  const rows = await fetchAll<InvoiceItemMapRow>(sb, "invoice_item_map", "id,supplier_id,venue_id,item_code,desc_key,ingredient_id,product_id,packs_per_unit,rejected", (q) => q.eq("supplier_id", a.supplierId));
  const forKey = (inScope: (venue: number | null) => boolean) =>
    rows.filter((m) => inScope(m.venue_id ?? null) && (code ? !!m.item_code && normCode(m.item_code) === wanted : !m.item_code && m.desc_key === dkey));
  const mine = forKey((v) => v === scope);
  const sameTarget = (m: InvoiceItemMapRow) => (m.ingredient_id ?? null) === a.target.ingredientId && (m.product_id ?? null) === a.target.productId;
  const packsOf = (m: InvoiceItemMapRow | undefined): number | null => (m && Number(m.packs_per_unit) > 0 ? Number(m.packs_per_unit) : null);

  if (a.rejected && !a.target.ingredientId && !a.target.productId) {
    // "not a product": a learned match for the same code would contradict it, so the person's newer answer replaces it
    // (in the row's own scope, and in the venue the answer came from)
    const positives = forKey((v) => v === scope || (a.alsoClear !== undefined && a.alsoClear !== null && v === a.alsoClear)).filter((m) => !m.rejected);
    if (positives.length) check(await sb.from("invoice_item_map").delete().in("id", positives.map((m) => m.id)), "Could not replace the earlier match");
    if (mine.some((m) => m.rejected && !m.ingredient_id && !m.product_id)) return;
  } else {
    const hit = mine.find(sameTarget) ?? (a.rejected ? undefined : mine.find((m) => !m.rejected));
    if (hit) {
      // the same target keeps the pack size a person already gave when this answer says nothing about it; a corrected target starts fresh
      const packs = a.packs ?? (sameTarget(hit) ? packsOf(hit) : null);
      check(
        await sb.from("invoice_item_map").update({ venue_id: scope, ingredient_id: a.target.ingredientId, product_id: a.target.productId, packs_per_unit: packs, rejected: a.rejected, updated_by: a.actor }).eq("id", hit.id),
        "Could not update what was learned",
      );
      return;
    }
  }
  check(
    await insertRow(sb, "invoice_item_map", { supplier_id: a.supplierId, item_code: code, desc_key: dkey, venue_id: scope, ingredient_id: a.target.ingredientId, product_id: a.target.productId, packs_per_unit: a.packs, rejected: a.rejected, created_by: a.actor }),
    "Could not remember the match",
  );
}

async function nameOf(sb: SupabaseClient, option: QuestionOption): Promise<string> {
  if (option.ingredient_id) {
    const r = await sb.from("cost_ingredients").select("name").eq("id", option.ingredient_id).maybeSingle();
    if ((r.data as { name?: string } | null)?.name) return (r.data as { name: string }).name;
  }
  if (option.product_id) {
    const r = await sb.from("ordering_products").select("name").eq("id", option.product_id).maybeSingle();
    if ((r.data as { name?: string } | null)?.name) return (r.data as { name: string }).name;
  }
  return option.label;
}

async function reanalyse(sb: SupabaseClient, documentId: string, actor: string, deps: AnswerDeps): Promise<{ applied: ApplyResult[] }> {
  const doc = check(await sb.from("invoice_documents").select("*").eq("id", documentId).maybeSingle(), "Could not read the invoice").data as InvoiceDocumentRow | null;
  if (!doc) throw new Error("That invoice no longer exists.");
  if (doc.status === "ignored" || doc.status === "duplicate" || doc.status === "failed") return { applied: [] };
  const lines = await fetchAll<InvoiceLineRow>(sb, "invoice_lines", "*", (q) => q.eq("document_id", documentId));
  const file = check(await sb.from("invoice_files").select("venue_id").eq("id", doc.file_id).maybeSingle(), "Could not read the file").data as { venue_id: number } | null;
  const questions = (check(await sb.from("invoice_questions").select("*").eq("document_id", documentId).eq("status", "answered"), "Could not read the questions").data ?? []) as InvoiceQuestionRow[];
  // what people already said is replayed on every look, from the answered questions (not from stored text)
  const venueConfirmed = questions.some((q) => q.kind === "venue_mismatch" && q.options.find((o) => o.id === q.answer?.option_id)?.action === "confirm_venue");
  const supplierConfirmed = questions.some((q) => q.kind === "new_supplier" && q.answer?.option_id === "same_supplier");

  const analyse = deps.analyse ?? (await loadEngine());
  const ctx = await loadAnalyseContext(sb, { venueId: doc.venue_id, folderVenueId: file?.venue_id ?? doc.venue_id, today: deps.today ?? brisbaneToday() });
  // this document is already filed: it must not be seen as a duplicate of itself
  ctx.existingDocs = ctx.existingDocs.filter((d) => d.id !== doc.id);
  Object.assign(ctx, { venueConfirmed, supplierConfirmed }); // the engine's AnalyseConfirmations
  const extracted = extractedFromStored(doc, lines);
  const analysis = analyse(extracted, ctx);
  await saveAnalysis(sb, { fileId: doc.file_id, venueId: doc.venue_id, extracted, analysis, pagePdfPath: doc.page_pdf_path, readModel: doc.read_model, documentId });
  return { applied: await applyDocumentAuto(sb, { documentId, actor }) };
}

// ---------------------------------------------------------------- the choices a question offers, and the ones a screen adds
const MAX_PACKS = 10_000;
const CUSTOM = "custom:";
const CUSTOM_PACKS = "custom:packs";
const NOT_A_PRODUCT = "not_a_product";

/**
 * Finds the option a person chose. Most are on the question. The screens also send two answers the engine never lists:
 * "custom:<ingredientId>" (an ingredient found by search, for unmatched_line and ambiguous_match) and "custom:packs"
 * (a pack size typed for unit_unclear); both carry a JSON note that is checked here, because it came from a browser.
 */
async function resolveOption(
  sb: SupabaseClient,
  q: InvoiceQuestionRow,
  optionId: string,
  note: string | undefined,
): Promise<{ option: QuestionOption } | { error: string }> {
  const listed = (q.options ?? []).find((o) => o.id === optionId);
  if (listed) return { option: listed };
  // the review screen's "Not In The App" works on every line question, even one whose own list (an ambiguous match) never offered it
  if (optionId === NOT_A_PRODUCT && (q.kind === "unmatched_line" || q.kind === "ambiguous_match")) return { option: { id: NOT_A_PRODUCT, label: "This is not a stock item", action: "not_a_product" } };
  if (!optionId.startsWith(CUSTOM)) return { error: "That is not one of the choices for this question." };

  let parsed: { ingredient_id?: unknown; packs_per_unit?: unknown } = {};
  if (note !== undefined && note !== "") {
    try {
      const v = JSON.parse(note) as unknown;
      if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("not an object");
      parsed = v as typeof parsed;
    } catch {
      return { error: "That answer could not be read. Please try again." };
    }
  }
  let packs: number | null = null;
  if (parsed.packs_per_unit !== undefined && parsed.packs_per_unit !== null) {
    const n = parsed.packs_per_unit;
    if (typeof n !== "number" || !Number.isFinite(n) || n <= 0 || n > MAX_PACKS) return { error: "The pack size must be a number above zero." };
    packs = n;
  }

  if (optionId === CUSTOM_PACKS) {
    if (q.kind !== "unit_unclear") return { error: "That answer does not fit this question." };
    if (packs === null) return { error: "Please say how many are in one unit." };
    return { option: { id: optionId, label: `${packs} per unit`, packs_per_unit: packs } };
  }

  if (q.kind !== "unmatched_line" && q.kind !== "ambiguous_match") return { error: "That answer does not fit this question." };
  const ingredientId = optionId.slice(CUSTOM.length);
  if (!ingredientId || (typeof parsed.ingredient_id === "string" && parsed.ingredient_id !== ingredientId)) return { error: "That answer could not be read. Please try again." };
  const found = await sb.from("cost_ingredients").select("id,name").eq("id", ingredientId).maybeSingle();
  if (found.error) throw new Error(found.error.message);
  if (!found.data) return { error: "That ingredient could not be found, so nothing was saved." };
  return { option: { id: optionId, label: (found.data as { name: string }).name, ingredient_id: ingredientId, packs_per_unit: packs } };
}

async function supplierName(sb: SupabaseClient, doc: InvoiceDocumentRow): Promise<string | null> {
  if (!doc.supplier_id) return doc.supplier_name_read;
  const r = await sb.from("invoice_suppliers").select("name").eq("id", doc.supplier_id).maybeSingle();
  return (r.data as { name?: string } | null)?.name ?? doc.supplier_name_read;
}

const digitsOnly = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");

/** "supplier:<id>": this invoice is from a supplier we already have. Remember how it writes the name, and its ABN if we lack one. */
async function attachExistingSupplier(sb: SupabaseClient, doc: InvoiceDocumentRow, supplierId: string): Promise<string> {
  const sup = check(await sb.from("invoice_suppliers").select("id,name,abn,aliases").eq("id", supplierId).maybeSingle(), "Could not read the supplier").data as
    | { id: string; name: string; abn: string | null; aliases: string[] | null }
    | null;
  if (!sup) throw new Error("That supplier could not be found.");
  const read = doc.supplier_name_read?.trim() ?? "";
  const aliases = [...(sup.aliases ?? [])];
  if (read && read.toLowerCase() !== sup.name.trim().toLowerCase() && !aliases.some((a) => a.trim().toLowerCase() === read.toLowerCase())) aliases.push(read);
  const patch: Record<string, unknown> = { aliases };
  const abn = digitsOnly(doc.supplier_abn_read);
  if (!sup.abn && abn.length === 11) {
    const taken = check(await sb.from("invoice_suppliers").select("id").eq("abn", abn).neq("id", sup.id), "Could not read the suppliers").data ?? [];
    if (taken.length === 0) patch.abn = abn;
  }
  check(await sb.from("invoice_suppliers").update(patch).eq("id", sup.id), "Could not update the supplier");
  check(await sb.from("invoice_documents").update({ supplier_id: sup.id }).eq("id", doc.id), "Could not update the invoice");
  return `${read ? `"${read}"` : "This supplier"} is recorded as ${sup.name}.`;
}

/** "add_supplier": the supplier row normally exists already (saving the analysis creates it); make it only if the invoice still has none. */
async function addSupplierIfMissing(sb: SupabaseClient, doc: InvoiceDocumentRow): Promise<string> {
  if (doc.supplier_id) return "Answer noted.";
  const name = doc.supplier_name_read?.trim();
  if (!name) throw new Error("The name of the supplier could not be read from this invoice, so it cannot be added.");
  const abn = digitsOnly(doc.supplier_abn_read) || null;
  const all = await fetchAll<{ id: string; name: string; abn: string | null }>(sb, "invoice_suppliers", "id,name,abn");
  let hit = all.find((x) => abn && x.abn === abn);
  if (!hit) {
    // names are unique ignoring case: a different ABN under the same name gets the ABN in brackets
    const clash = all.some((x) => x.name.trim().toLowerCase() === name.toLowerCase());
    const created = await insertRow(sb, "invoice_suppliers", { name: clash && abn ? `${name} (ABN ${abn})` : name, abn }).select("id,name").single();
    hit = check(created, "Could not add the supplier").data as { id: string; name: string; abn: string | null };
  }
  check(await sb.from("invoice_documents").update({ supplier_id: hit.id }).eq("id", doc.id), "Could not update the invoice");
  return `${hit.name} is added as a new supplier.`;
}

/** A rule matches on text contained in a description or code, so a very short one would catch unrelated lines. */
const MIN_RULE_TEXT = 5;
const MIN_RULE_CODE = 3;
export const RULE_TOO_SHORT = "That description is too short to make a rule from. Ask for the rule to be added in Settings.";

/**
 * Saves a charge rule for this supplier unless an identical active one exists. Returns false when it already existed, or a
 * refusal in plain words when the line gives nothing safe to match on.
 */
async function saveChargeRule(sb: SupabaseClient, a: { supplierId: string; line: InvoiceLineRow; spread: boolean }): Promise<boolean | { refusal: string }> {
  const fromDescription = a.line.description.trim().toLowerCase().slice(0, 60).trim();
  // a short description ("Fee") would catch every line containing those letters: use the supplier's own item code for the charge instead
  const code = a.line.item_code?.trim().toLowerCase() ?? "";
  const match_text = fromDescription.length >= MIN_RULE_TEXT ? fromDescription : code.length >= MIN_RULE_CODE ? code : null;
  if (!match_text) return { refusal: RULE_TOO_SHORT };
  // spreading only works for a charge class (the engine ignores it on "other"), so an unclear class becomes a fee
  const spreadable = ["delivery", "fee", "discount", "deposit"];
  const line_class = a.spread ? (spreadable.includes(a.line.line_class) ? a.line.line_class : "fee") : "other";
  const rules = await fetchAll<InvoiceChargeRuleRow>(sb, "invoice_charge_rules", "id,supplier_id,match_text,line_class,spread,note,active", (q) => q.eq("active", true));
  if (rules.some((r) => r.supplier_id === a.supplierId && r.match_text.trim().toLowerCase() === match_text && r.line_class === line_class && r.spread === a.spread)) return false;
  check(await insertRow(sb, "invoice_charge_rules", { supplier_id: a.supplierId, match_text, line_class, spread: a.spread, note: "Added from an answer", active: true }), "Could not save the rule");
  return true;
}

async function loadEngine(): Promise<AnalyseInvoice> {
  const mod = await import("./invoice-engine");
  return mod.analyseInvoice;
}

/** What one recorded answer was, for the words of a batch summary. */
type AnswerClass = "match" | "ignored" | "approved" | "other";

type Recorded =
  | { ok: false; status: "already" | "failed"; message: string; applied: ApplyResult[] }
  | { ok: true; parts: string[]; applied: ApplyResult[]; docId: string; lineNo: number | null; cls: AnswerClass; reanalyse: boolean; terminal: boolean };

/**
 * Records ONE answer and its direct effect (a learned match, an ignored line, an approved price) but does NOT look at the invoice
 * again. `answerQuestion` re-analyses straight after; `answerQuestionsBatch` re-analyses each invoice once after all its answers.
 * `terminal` means the answer ends the invoice's story (set aside, read again): nothing should be re-analysed after it.
 */
async function recordAnswer(sb: SupabaseClient, args: { questionId: string; optionId: string; actor: string; note?: string }): Promise<Recorded> {
  const failed = (message: string, applied: ApplyResult[] = []): Recorded => ({ ok: false, status: "failed", message, applied });
  const { questionId, optionId, actor, note } = args;
  const q = check(await sb.from("invoice_questions").select("*").eq("id", questionId).maybeSingle(), "Could not read the question").data as InvoiceQuestionRow | null;
  if (!q) return failed("That question no longer exists.");
  if (q.status !== "open") return q.status === "answered" ? { ok: false, status: "already", message: "This question has already been answered.", applied: [] } : failed("This question no longer needs an answer.");
  const resolved = await resolveOption(sb, q, optionId, note);
  if ("error" in resolved) return failed(resolved.error);
  const option = resolved.option;
  const doc = check(await sb.from("invoice_documents").select("*").eq("id", q.document_id).maybeSingle(), "Could not read the invoice").data as InvoiceDocumentRow | null;
  if (!doc) return failed("The invoice for this question no longer exists.");
  const line = q.line_id ? (check(await sb.from("invoice_lines").select("*").eq("id", q.line_id).maybeSingle(), "Could not read the line").data as InvoiceLineRow | null) : null;

  const parts: string[] = [];
  const applied: ApplyResult[] = [];
  let reanalyseAfter = true;
  let terminal = false;
  let cls: AnswerClass = "other";
  const needLine = () => {
    if (!line) throw new Error("This answer is about a line, but the line is no longer on the invoice.");
    return line;
  };

  // the charge answers carry action "not_a_product" for leave_out_charge, but the rule is the memory, not a rejected map row
  const answerId = option.id;
  if (answerId === "spread_charge" || answerId === "leave_out_charge") {
    const l = needLine();
    if (!doc.supplier_id) throw new Error("This invoice has no supplier yet, so the rule cannot be saved.");
    const spread = answerId === "spread_charge";
    const saved = await saveChargeRule(sb, { supplierId: doc.supplier_id, line: l, spread });
    if (typeof saved === "object") return failed(saved.refusal);
    const made = saved;
    const who = (await supplierName(sb, doc)) ?? "This supplier";
    parts.push(spread ? `${who} "${l.description.trim()}" will be spread over the products as part of their cost.` : `${who} "${l.description.trim()}" will be left out of cost.`);
    if (!made) parts.push("That rule already existed.");
  } else switch (option.action) {
    case "approve_change": {
      const r = await applyLine(sb, { lineId: needLine().id, actor, mode: "approved" });
      if (!r.ok) return failed(r.message, [r]);
      applied.push(r);
      parts.push(r.message);
      cls = "approved";
      break;
    }
    case "reject_change":
    case "ignore_line": {
      const l = needLine();
      check(await sb.from("invoice_lines").update({ state: "ignored" }).eq("id", l.id), "Could not update the line");
      parts.push(option.action === "reject_change" ? `That price change for ${l.description} was left alone.` : `${l.description} will be ignored.`);
      if (option.action === "ignore_line") cls = "ignored";
      break;
    }
    case "not_a_product": {
      const l = needLine();
      if (doc.supplier_id) await learnMap(sb, { supplierId: doc.supplier_id, venueId: null, alsoClear: doc.venue_id, line: l, target: { ingredientId: null, productId: null }, packs: null, rejected: true, actor });
      check(await sb.from("invoice_lines").update({ state: "ignored", match_state: "ignored" }).eq("id", l.id), "Could not update the line");
      parts.push(`${l.description} is not a product, and it will be ignored from now on.`);
      cls = "ignored";
      break;
    }
    case "confirm_venue": {
      check(await sb.from("invoice_documents").update({ venue_check: "ok" }).eq("id", doc.id), "Could not update the invoice");
      parts.push("This invoice is confirmed for this venue.");
      break;
    }
    case "wrong_venue": {
      const notes: ReconNote[] = [...(doc.recon_notes ?? []), { check: "venue", ok: false, message: `Marked as not for this venue by ${actor}.` }];
      check(await sb.from("invoice_documents").update({ status: "ignored", recon_notes: notes }).eq("id", doc.id), "Could not update the invoice");
      parts.push("This invoice is set aside because it is not for this venue.");
      reanalyseAfter = false;
      terminal = true;
      break;
    }
    case "ignore_document": {
      check(await sb.from("invoice_documents").update({ status: "ignored" }).eq("id", doc.id), "Could not update the invoice");
      parts.push("This invoice is set aside.");
      reanalyseAfter = false;
      terminal = true;
      break;
    }
    case "reread": {
      check(await sb.from("invoice_files").update({ status: "received", attempts: 0, error: null }).eq("id", doc.file_id), "Could not queue the file");
      // the reader skips a document that already has a stored reading, so forget it on every invoice of this file that is not settled
      const siblings = (check(await sb.from("invoice_documents").select("id,status").eq("file_id", doc.file_id), "Could not read the file's invoices").data ?? []) as { id: string; status: string }[];
      const rereadable = siblings.filter((d) => !["applied", "partly_applied", "ignored", "duplicate"].includes(d.status)).map((d) => d.id);
      if (rereadable.length) check(await sb.from("invoice_documents").update({ read_model: null }).in("id", rereadable), "Could not clear the earlier reading");
      parts.push("This invoice will be read again.");
      reanalyseAfter = false;
      terminal = true;
      break;
    }
    default: {
      if (answerId.startsWith("supplier:")) {
        parts.push(await attachExistingSupplier(sb, doc, answerId.slice("supplier:".length)));
      } else if (answerId === "add_supplier") {
        parts.push(await addSupplierIfMissing(sb, doc));
      } else if (answerId === "same_supplier") {
        parts.push(`${doc.supplier_name_read?.trim() || "This supplier"} is confirmed as the supplier we already have.`);
      } else if (answerId === "credit_leave") {
        parts.push("Left as it is. The cost per unit stays blank for this line.");
        reanalyseAfter = false;
      } else if (!option.ingredient_id && !option.product_id && option.packs_per_unit != null) {
        const l = needLine();
        if (l.match_state !== "matched" || (!l.ingredient_id && !l.product_id)) throw new Error("This line is not matched to a product yet, so the pack size cannot be saved.");
        if (!doc.supplier_id) throw new Error("This invoice has no supplier yet, so the pack size cannot be remembered.");
        const n = option.packs_per_unit;
        await learnMap(sb, { supplierId: doc.supplier_id, venueId: l.product_id ? doc.venue_id : null, line: l, target: { ingredientId: l.ingredient_id, productId: l.product_id }, packs: n, rejected: false, actor });
        const who = (await supplierName(sb, doc)) ?? doc.supplier_name_read ?? "This supplier";
        const what = l.item_code?.trim() ? `code ${l.item_code.trim()}` : `"${l.description}"`;
        const per = answerId.startsWith("packs:") && option.label.includes(" per ") ? option.label : `${n} per ${l.unit?.trim().toLowerCase() || "unit"}`;
        parts.push(`${who} ${what} is counted as ${per}.`);
      } else if (option.ingredient_id || option.product_id) {
        const l = needLine();
        if (!doc.supplier_id) throw new Error("This invoice has no supplier yet, so the match cannot be remembered.");
        // only a pack size somebody stated (or the engine derived safely, already on the line) is remembered; never a guess of 1
        const packs = positiveOrNull(option.packs_per_unit) ?? positiveOrNull(l.packs_per_unit);
        await learnMap(sb, {
          supplierId: doc.supplier_id,
          venueId: option.product_id ? doc.venue_id : null,
          line: l,
          target: { ingredientId: option.ingredient_id ?? null, productId: option.product_id ?? null },
          packs,
          rejected: false,
          actor,
        });
        const sup = check(await sb.from("invoice_suppliers").select("name").eq("id", doc.supplier_id).maybeSingle(), "Could not read the supplier").data as { name: string } | null;
        const who = sup?.name ?? doc.supplier_name_read ?? "This supplier";
        const what = l.item_code?.trim() ? `code ${l.item_code.trim()}` : `"${l.description}"`;
        parts.push(`${who} ${what} is now ${await nameOf(sb, option)}.`);
        cls = "match";
      } else {
        parts.push("Answer noted.");
      }
    }
  }

  // ---- record the answer (only the first answer wins)
  const marked = await sb
    .from("invoice_questions")
    .update({ status: "answered", answer: note ? { option_id: optionId, note } : { option_id: optionId }, answered_by: actor, answered_at: new Date().toISOString() })
    .eq("id", questionId)
    .eq("status", "open")
    .select("id");
  if (marked.error) throw new Error(marked.error.message);
  if (!marked.data || marked.data.length === 0) return { ok: false, status: "already", message: "Someone else answered this question first.", applied };
  return { ok: true, parts, applied, docId: doc.id, lineNo: line?.line_no ?? null, cls, reanalyse: reanalyseAfter, terminal };
}

export async function answerQuestion(
  sb: SupabaseClient,
  args: { questionId: string; optionId: string; actor: string; note?: string },
  deps: AnswerDeps = {},
): Promise<AnswerResult> {
  const fail = (message: string, applied: ApplyResult[] = []): AnswerResult => ({ ok: false, message, applied });
  try {
    return await answerInner(sb, args, deps, fail);
  } catch (e) {
    return fail(`Nothing was saved. ${e instanceof Error ? e.message : "Something went wrong."}`);
  }
}
// compile-time check that this matches the contract in lib/invoice-interfaces.ts (the optional third argument is ours)
const contract: AnswerQuestion = answerQuestion;
void contract;

async function answerInner(
  sb: SupabaseClient,
  args: { questionId: string; optionId: string; actor: string; note?: string },
  deps: AnswerDeps,
  fail: (message: string, applied?: ApplyResult[]) => AnswerResult,
): Promise<AnswerResult> {
  const rec = await recordAnswer(sb, args);
  if (!rec.ok) return fail(rec.message, rec.applied);
  const parts = [...rec.parts];
  const applied = [...rec.applied];
  let autoUpdated = 0;
  // ---- look at the invoice again with what was just learned
  if (rec.reanalyse) {
    try {
      const again = await reanalyse(sb, rec.docId, args.actor, deps);
      applied.push(...again.applied);
      autoUpdated = again.applied.filter((a) => a.ok && a.changeIds.length > 0).length;
    } catch (e) {
      parts.push("The answer is saved, but the invoice could not be checked again just now.");
    }
  }
  if (autoUpdated > 0) parts.push(`${autoUpdated} more ${autoUpdated === 1 ? "line was" : "lines were"} applied automatically.`);
  return { ok: true, message: ["Saved.", ...parts].join(" "), applied };
}

// ---------------------------------------------------------------- many answers at once (the Match Lines review)

export interface BatchAnswerInput {
  questionId: string;
  optionId: string;
  note?: string;
}

export interface BatchAnswerResult {
  questionId: string;
  /** true for "saved" and for "already" (somebody answered it; nothing is left to do) */
  ok: boolean;
  status: "saved" | "already" | "failed";
  message: string;
}

export interface BatchResult {
  /** true when no answer failed */
  ok: boolean;
  /** "Saved 9 matches. 3 lines ignored. 2 prices ready to approve." */
  message: string;
  results: BatchAnswerResult[];
  saved: number;
  failed: number;
  applied: ApplyResult[];
}

export interface BatchCounts {
  matches: number;
  ignored: number;
  approved: number;
  other: number;
  already: number;
  failed: number;
  waiting: number;
  autoApplied: number;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The one sentence a person reads after Save Matches. Only says what happened. */
export function batchMessage(c: BatchCounts): string {
  const out: string[] = [];
  if (c.matches) out.push(`Saved ${plural(c.matches, "match", "matches")}.`);
  if (c.ignored) out.push(`${plural(c.ignored, "line", "lines")} ignored.`);
  if (c.approved) out.push(`${plural(c.approved, "price", "prices")} approved.`);
  if (c.other) out.push(`${plural(c.other, "other answer", "other answers")} saved.`);
  if (c.autoApplied) out.push(`${plural(c.autoApplied, "price", "prices")} applied automatically.`);
  if (c.waiting) out.push(`${plural(c.waiting, "price", "prices")} ready to approve.`);
  if (c.already) out.push(`${c.already === 1 ? "1 line was" : `${c.already} lines were`} already answered.`);
  if (c.failed) out.push(`${plural(c.failed, "answer", "answers")} could not be saved.`);
  return out.length ? out.join(" ") : "Nothing was saved.";
}

/**
 * Records many answers, then looks at each affected invoice ONCE. This is the review screen's Save Matches: twelve unmatched
 * lines used to mean twelve full re-analyses; now they are twelve answers and one re-analysis.
 *
 * Every answer is checked and learned exactly as `answerQuestion` does it (same validation of custom ids and notes, same map
 * rows: ingredient matches shared across venues, ordering products per venue). Answers about the invoice itself (a new supplier)
 * go first, so a match that needs the supplier finds it. One answer failing never stops the others; each gets its own result.
 * Safe to run again: a question that is already answered is reported as "already", never as an error.
 */
export async function answerQuestionsBatch(
  sb: SupabaseClient,
  args: { answers: BatchAnswerInput[]; actor: string },
  deps: AnswerDeps = {},
): Promise<BatchResult> {
  const results: BatchAnswerResult[] = [];
  const applied: ApplyResult[] = [];
  const counts: BatchCounts = { matches: 0, ignored: 0, approved: 0, other: 0, already: 0, failed: 0, waiting: 0, autoApplied: 0 };
  const seen = new Set<string>();
  const wanted = args.answers.filter((a) => {
    if (seen.has(a.questionId)) return false;
    seen.add(a.questionId);
    return true;
  });
  if (wanted.length === 0) return { ok: true, message: "Nothing was saved.", results, saved: 0, failed: 0, applied };

  // invoice-wide questions (no line) first
  let lineless = new Set<string>();
  try {
    const rows = check(await sb.from("invoice_questions").select("id,line_id").in("id", wanted.map((a) => a.questionId)), "Could not read the questions").data as { id: string; line_id: string | null }[] | null;
    lineless = new Set((rows ?? []).filter((r) => !r.line_id).map((r) => r.id));
  } catch {
    // the order is a nicety: each answer still reads its own question
  }
  const ordered = [...wanted.filter((a) => lineless.has(a.questionId)), ...wanted.filter((a) => !lineless.has(a.questionId))];

  const docs = new Map<string, { reanalyse: boolean; terminal: boolean; matched: Set<number> }>();
  for (const a of ordered) {
    try {
      const rec = await recordAnswer(sb, { questionId: a.questionId, optionId: a.optionId, actor: args.actor, note: a.note });
      applied.push(...rec.applied);
      if (!rec.ok) {
        if (rec.status === "already") {
          counts.already++;
          results.push({ questionId: a.questionId, ok: true, status: "already", message: rec.message });
        } else {
          counts.failed++;
          results.push({ questionId: a.questionId, ok: false, status: "failed", message: rec.message });
        }
        continue;
      }
      if (rec.cls === "match") counts.matches++;
      else if (rec.cls === "ignored") counts.ignored++;
      else if (rec.cls === "approved") counts.approved++;
      else counts.other++;
      const d = docs.get(rec.docId) ?? { reanalyse: false, terminal: false, matched: new Set<number>() };
      d.reanalyse ||= rec.reanalyse;
      d.terminal ||= rec.terminal;
      if (rec.cls === "match" && rec.lineNo != null) d.matched.add(rec.lineNo);
      docs.set(rec.docId, d);
      results.push({ questionId: a.questionId, ok: true, status: "saved", message: ["Saved.", ...rec.parts].join(" ") });
    } catch (e) {
      counts.failed++;
      results.push({ questionId: a.questionId, ok: false, status: "failed", message: `Nothing was saved. ${e instanceof Error ? e.message : "Something went wrong."}` });
    }
  }

  // each invoice is looked at once, after all its answers
  const tail: string[] = [];
  for (const [docId, d] of docs) {
    if (!d.reanalyse || d.terminal) continue;
    try {
      const again = await reanalyse(sb, docId, args.actor, deps);
      applied.push(...again.applied);
      counts.autoApplied += again.applied.filter((x) => x.ok && x.changeIds.length > 0).length;
    } catch {
      tail.push("The answers are saved, but an invoice could not be checked again just now.");
    }
    if (d.matched.size) {
      try {
        const lines = await fetchAll<{ line_no: number; decision: string; state: string }>(sb, "invoice_lines", "line_no,decision,state", (q) => q.eq("document_id", docId));
        counts.waiting += lines.filter((l) => d.matched.has(l.line_no) && l.decision === "needs_approval" && l.state !== "ignored").length;
      } catch {
        // the count is a courtesy
      }
    }
  }
  const saved = results.filter((r) => r.status === "saved").length;
  return { ok: counts.failed === 0, message: [batchMessage(counts), ...tail].join(" "), results, saved, failed: counts.failed, applied };
}
