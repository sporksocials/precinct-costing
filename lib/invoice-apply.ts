/**
 * Invoices: the only module that writes a price. Applies a line (ingredient pack price and/or ordering product price), keeps the
 * undo ledger (invoice_price_changes), and undoes. Takes ANY Supabase client (service role when the reader auto-applies, the
 * signed-in client when a person taps Approve or Undo). Never touches a sell price or a recipe.
 *
 * Safety, in the order it matters:
 *  1. STALE CHECK. Every target is re-read right before writing. If its price is no longer the one the analysis saw
 *     (within 0.00005), NOTHING is written (stale: true). The write itself is guarded `.eq("pack_price", <the price just read>)`,
 *     so two writers cannot both pass.
 *  2. LEDGER FIRST. The undo ledger row is inserted before the price is written and removed again if the guarded write finds
 *     nothing to update, so a written price always has a ledger row.
 *  3. AUTO is paranoid: decision must be apply (or same), the invoice reconciled, venue ok, learning mode off, the change
 *     under the auto-apply limit, all re-checked here even though the engine already decided.
 *  4. WRITE-TIME RE-CHECK. The numbers on the line were worked out when the invoice was read. Before any write they are worked out
 *     again from the line's own stored unit price and the ingredient AS IT IS NOW (pack, GST setting), and a mismatch refuses.
 *     Automatic mode also re-reads the things a person may have changed since: the supplier's trust switch, a deal on the product,
 *     a newer price date, the age of the invoice.
 *  5. A price that equals the current one (or a line decided "same") is a CONFIRMATION: it never writes a price, only the date and a log row.
 *  6. The price log: cost_ingredients.source is set in the SAME update as pack_price, so the existing cost_log_price() trigger
 *     writes the cost_price_log row (label, previous_price and last_price_update included). A price confirmation changes no price,
 *     so the trigger does not fire: this module writes its own cost_price_log row for it.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { brisbaneToday } from "./deals";
import { dealInForce, settingsFromRows } from "./invoice-context";
import { insertRow } from "./invoice-insert";
import type { ApplyDocumentAuto, ApplyLine, ApplyResult, UndoChange, UndoDocument, UndoResult } from "./invoice-interfaces";
import { recomputeDocumentStatus } from "./invoice-store";
import { baseQuantity, baseUnitFor } from "./invoice-units";
import { INVOICE_SETTING_KEYS, INVOICE_SOURCE_PREFIX, type InvoiceDocumentRow, type InvoiceLineRow, type InvoicePriceChangeRow } from "./invoice-types";

/** Prices compare equal within this (stored to 4 dp). */
export const MONEY_EPS = 0.00005;
/**
 * Two prices are "the same price" (a confirmation, not a change) when they differ by less than half a cent.
 * Mirrors SAME_PRICE_EPS in lib/invoice-guards.ts (isSamePrice); switch to that shared export when it lands.
 */
const SAME_PRICE_EPS = 0.005;
/** An automatic apply refuses an invoice older than this many days: the price it shows may no longer be today's. */
export const AUTO_MAX_AGE_DAYS = 45;

const toNum = (v: unknown): number | null => (v === null || v === undefined ? null : Number.isFinite(Number(v)) ? Number(v) : null);
export const round4 = (n: number) => Math.round(n * 10000) / 10000;
/** null-aware: two missing prices are the same price */
export function sameMoney(a: unknown, b: unknown): boolean {
  const x = toNum(a), y = toNum(b);
  if (x === null || y === null) return x === y;
  return Math.abs(x - y) <= MONEY_EPS;
}

/** "$68.90" for most prices, more places only when the price really has them. */
export function money(n: number | null | undefined): string {
  if (n === null || n === undefined) return "no price";
  const two = n.toFixed(2);
  return Math.abs(Number(two) - n) < MONEY_EPS ? `$${two}` : `$${round4(n)}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** yyyy-mm-dd to "14 Oct 2026" without any timezone shift. */
export function formatInvoiceDate(d: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d ?? "");
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : null;
}

/**
 * The one wording for a price's source: "Invoice 51329 · Daniel Street Fish Market · 14 Oct 2026". It becomes
 * cost_ingredients.source (so the price log and history show it) and every screen reuses it.
 */
export function invoiceSourceLabel(doc: Pick<InvoiceDocumentRow, "invoice_number" | "invoice_date">, supplierName: string | null | undefined): string {
  const parts = [`${INVOICE_SOURCE_PREFIX} ${doc.invoice_number?.trim() || "(no number)"}`, supplierName?.trim() || "Unknown supplier"];
  const date = formatInvoiceDate(doc.invoice_date);
  if (date) parts.push(date);
  return parts.join(" · ");
}

function check<T extends { error: any }>(res: T, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message ?? "database error"}`);
  return res;
}

async function loadDoc(sb: SupabaseClient, id: string): Promise<InvoiceDocumentRow | null> {
  return check(await sb.from("invoice_documents").select("*").eq("id", id).maybeSingle(), "Could not read the invoice").data as InvoiceDocumentRow | null;
}

async function supplierNameFor(sb: SupabaseClient, doc: InvoiceDocumentRow): Promise<string | null> {
  if (doc.supplier_id) {
    const s = check(await sb.from("invoice_suppliers").select("name").eq("id", doc.supplier_id).maybeSingle(), "Could not read the supplier").data as { name: string } | null;
    if (s?.name) return s.name;
  }
  return doc.supplier_name_read;
}

const later = (a: string | null, b: string | null): string | null => (a && b ? (a >= b ? a : b) : a ?? b);

// ============================================================================================================== apply
const OPENABLE: Record<"auto" | "approved", string[]> = { auto: ["open"], approved: ["open", "reverted", "approved_skip"] };
const DECISIONS: Record<"auto" | "approved", string[]> = { auto: ["apply", "same"], approved: ["apply", "needs_approval", "same"] };

export const applyLine: ApplyLine = async (sb, { lineId, actor, mode }) => {
  const refuse = (message: string, extra: Partial<ApplyResult> = {}): ApplyResult => ({ lineId, ok: false, message, changeIds: [], ...extra });
  try {
    return await applyLineInner(sb, lineId, actor, mode, refuse);
  } catch (e) {
    return refuse(`Nothing was changed. ${e instanceof Error ? e.message : "Something went wrong."}`);
  }
};

const daysBetween = (a: string, b: string): number => {
  const day = (s: string) => {
    const [y, m, d] = s.slice(0, 10).split("-").map(Number);
    return Math.floor(Date.UTC(y, (m || 1) - 1, d || 1) / 86_400_000);
  };
  return day(b) - day(a);
};
const isoDate = /^\d{4}-\d{2}-\d{2}/;
const withinEps = (a: unknown, b: unknown): boolean => {
  const x = toNum(a), y = toNum(b);
  return x !== null && y !== null && Math.abs(x - y) < SAME_PRICE_EPS;
};

const STALE_BASIS = "The ingredient's pack or GST setting changed since this invoice was read. Open the invoice and check it again.";

async function applyLineInner(
  sb: SupabaseClient,
  lineId: string,
  actor: string,
  mode: "auto" | "approved",
  refuse: (message: string, extra?: Partial<ApplyResult>) => ApplyResult,
): Promise<ApplyResult> {
  const line = check(await sb.from("invoice_lines").select("*").eq("id", lineId).maybeSingle(), "Could not read the line").data as InvoiceLineRow | null;
  if (!line) return refuse("That line no longer exists.");
  if (!OPENABLE[mode].includes(line.state)) return refuse(`This line is already ${line.state === "open" ? "open" : line.state.replace("_", " ")}, so nothing was changed.`);
  if (!DECISIONS[mode].includes(line.decision)) {
    return refuse(mode === "auto" ? "This price is not set to apply itself, so it waits for a tap." : "This line has no price change to apply.");
  }
  if (line.line_class !== "product" || line.match_state !== "matched") return refuse("Only a matched product line can change a price.");

  const doc = await loadDoc(sb, line.document_id);
  if (!doc) return refuse("The invoice for this line no longer exists.");
  if (doc.status === "ignored" || doc.status === "duplicate" || doc.status === "failed") return refuse(`This invoice is marked ${doc.status}, so its prices are not applied.`);
  if (mode === "auto") {
    if (!doc.reconciled) return refuse("This invoice does not add up, so the price waits for a tap.");
    if (line.decision === "apply" && doc.mode !== "auto") return refuse("This invoice is not set to apply itself, so the price waits for a tap.");
  }

  const already = check(await sb.from("invoice_price_changes").select("id").eq("line_id", lineId).eq("status", "applied"), "Could not read the undo ledger").data ?? [];
  if (already.length) return refuse("This line has already been applied. Undo it first if you want to apply it again.");

  // ---- plan both targets and re-read them live BEFORE writing anything
  const wantsIngredient = !!line.ingredient_id && toNum(line.new_pack_price) !== null;
  const wantsProduct = !!line.product_id && toNum(line.new_product_price) !== null;
  if (!wantsIngredient && !wantsProduct) return refuse("This line has no new price to write.");

  // a line decided "same" is a confirmation whatever its numbers say: a confirmation never writes a price
  const confirmLine = line.decision === "same";

  type IngRow = { id: string; name: string; pack_price: number; previous_price: number | null; last_price_update: string | null; source: string | null; price_inc_gst: boolean | null; gst_free: boolean | null; pack_size: number | null; pack_unit: string | null };
  type ProdRow = { id: string; venue_id: number; name: string; price_inc_gst: number | null; ingredient_id: string | null; costing_packs_per_unit: number | null; deal_buy_qty: number | null; deal_free_qty: number | null };
  let ing: IngRow | null = null;
  let ingKind: "price_change" | "price_confirmed" = "price_change";
  if (wantsIngredient) {
    if (toNum(line.old_pack_price) === null) return refuse("This line does not record the current price, so nothing was changed. Re-check the invoice first.");
    ing = check(
      await sb.from("cost_ingredients").select("id,name,pack_price,previous_price,last_price_update,source,price_inc_gst,gst_free,pack_size,pack_unit").eq("id", line.ingredient_id!).maybeSingle(),
      "Could not read the ingredient",
    ).data as IngRow | null;
    if (!ing) return refuse("The ingredient for this line no longer exists.");
    if (!sameMoney(ing.pack_price, line.old_pack_price)) {
      return refuse(`The price of ${ing.name} changed since this invoice was read (now ${money(toNum(ing.pack_price))}, the invoice was compared with ${money(toNum(line.old_pack_price))}). Nothing was written.`, { stale: true });
    }
    ingKind = confirmLine || withinEps(line.old_pack_price, line.new_pack_price) ? "price_confirmed" : "price_change";
  }
  let prod: ProdRow | null = null;
  let prodKind: "price_change" | "price_confirmed" = "price_change";
  if (wantsProduct) {
    prod = check(
      await sb.from("ordering_products").select("id,venue_id,name,price_inc_gst,ingredient_id,costing_packs_per_unit,deal_buy_qty,deal_free_qty").eq("id", line.product_id!).maybeSingle(),
      "Could not read the ordering product",
    ).data as ProdRow | null;
    if (!prod) return refuse("The ordering product for this line no longer exists.");
    if (prod.venue_id !== doc.venue_id) return refuse(`${prod.name} belongs to another venue, so nothing was changed.`);
    if (!sameMoney(prod.price_inc_gst, line.old_product_price)) {
      return refuse(`The order price of ${prod.name} changed since this invoice was read (now ${money(toNum(prod.price_inc_gst))}, the invoice was compared with ${money(toNum(line.old_product_price))}). Nothing was written.`, { stale: true });
    }
    prodKind = confirmLine || withinEps(line.old_product_price, line.new_product_price) ? "price_confirmed" : "price_change";
  }

  // ---- the settings (GST rate for the re-check, learning mode and the limit for an automatic apply)
  const settingRows = check(await sb.from("cost_settings").select("key,value").in("key", ["gst_rate", ...Object.values(INVOICE_SETTING_KEYS)]), "Could not read the settings").data ?? [];
  const { settings, gstRate } = settingsFromRows(settingRows as { key: string; value: unknown }[]);

  // ---- STALE BASIS: work the new price out again from the line's own unit price and the ingredient as it is NOW
  if (ing && wantsIngredient) {
    const packs = toNum(line.packs_per_unit);
    if (packs === null || !(packs > 0)) return refuse("The pack size for this line has not been confirmed, so no price was changed. Answer the pack size question first.", { stale: true });
    const up = toNum(line.unit_price_ex);
    if (up === null || !(up > 0)) return refuse("This line has no unit price to work from, so no price was changed. Open the invoice and check it again.", { stale: true });
    const perPack = up / packs;
    const needsInc = !!ing.price_inc_gst && !ing.gst_free;
    const expected = needsInc ? (line.gst === "taxable" ? perPack * (1 + gstRate) : line.gst === "free" ? perPack : null) : perPack;
    if (expected === null) return refuse("GST is unclear on this line, so the price cannot be checked. Open the invoice and check it again.", { stale: true });
    if (Math.abs(round4(expected) - toNum(line.new_pack_price)!) > SAME_PRICE_EPS) return refuse(STALE_BASIS, { stale: true });
    // the pack itself: the quantity in kg, L or each the line recorded was worked out from the ingredient's pack size and unit
    const baseSaved = toNum(line.base_qty);
    if (baseSaved !== null) {
      const now = baseQuantity(toNum(line.qty), packs, { pack_size: toNum(ing.pack_size) ?? 1, pack_unit: String(ing.pack_unit ?? "") });
      const unitNow = baseUnitFor(ing.pack_unit);
      if (now === null || Math.abs(now - baseSaved) > 0.0005 || (line.base_unit && unitNow && line.base_unit !== unitNow)) return refuse(STALE_BASIS, { stale: true });
    }
  }
  if (prod && wantsProduct && line.ingredient_id) {
    const linkChanged = !!prod.ingredient_id && prod.ingredient_id !== line.ingredient_id;
    const packs = toNum(line.packs_per_unit);
    const costing = toNum(prod.costing_packs_per_unit) ?? 1;
    const packsChanged = wantsIngredient && packs !== null && Math.abs(costing - packs) > 1e-9;
    if (linkChanged || packsChanged) return refuse("The ordering product's pack size or ingredient link changed since this invoice was read. Open the invoice and check it again.", { stale: true });
  }

  // ---- AUTO is paranoid: what a person may have changed since the analysis can no longer be trusted
  const anyChange = (wantsIngredient && ingKind === "price_change") || (wantsProduct && prodKind === "price_change");
  if (mode === "auto" && anyChange) {
    if (settings.learningMode) return refuse("Learning mode is on, so every price waits for a tap.");
    for (const [oldP, newP] of [[line.old_pack_price, line.new_pack_price], [line.old_product_price, line.new_product_price]] as const) {
      const o = toNum(oldP), n = toNum(newP);
      if (o === null || n === null || withinEps(o, n)) continue;
      if (o === 0 || Math.abs(n - o) / o >= settings.autoApplyPct) return refuse("This price change is over the automatic limit, so it waits for a tap.");
    }
    const supplier = doc.supplier_id
      ? (check(await sb.from("invoice_suppliers").select("id,auto_apply").eq("id", doc.supplier_id).maybeSingle(), "Could not read the supplier").data as { id: string; auto_apply: boolean | null } | null)
      : null;
    if (!supplier || supplier.auto_apply !== true) return refuse("This supplier is no longer set to apply prices by itself, so the price waits for a tap.");

    const today = brisbaneToday();
    const invDate = doc.invoice_date && isoDate.test(doc.invoice_date) ? doc.invoice_date.slice(0, 10) : null;
    if (!invDate) return refuse("The date of this invoice is not known, so the price waits for a tap.");
    if (invDate > today) return refuse("The date on this invoice is in the future, so the price waits for a tap.");
    if (daysBetween(invDate, today) > AUTO_MAX_AGE_DAYS) return refuse(`This invoice is more than ${AUTO_MAX_AGE_DAYS} days old, so the price waits for a tap.`);
    if (ing && ingKind === "price_change") {
      if (ing.last_price_update && invDate < ing.last_price_update.slice(0, 10)) {
        return refuse(`The price of ${ing.name} was updated on ${formatInvoiceDate(ing.last_price_update)}, after the date of this invoice, so the price waits for a tap.`);
      }
      const deals = check(await sb.from("cost_ingredient_deals").select("id,active,starts_on,ends_on").eq("ingredient_id", ing.id).eq("active", true), "Could not read the deals").data ?? [];
      if ((deals as { active: boolean; starts_on: string | null; ends_on: string | null }[]).some((d) => dealInForce(d, today))) {
        return refuse(`${ing.name} now has a deal, so its price cannot apply itself and waits for a tap.`);
      }
    }
    if (prod && prodKind === "price_change" && ((toNum(prod.deal_buy_qty) ?? 0) > 0 || (toNum(prod.deal_free_qty) ?? 0) > 0)) {
      return refuse(`${prod.name} now has a free-unit deal, so its price cannot apply itself and waits for a tap.`);
    }
  }

  const supplierName = await supplierNameFor(sb, doc);
  const label = invoiceSourceLabel(doc, supplierName);
  const today = brisbaneToday();
  const changeIds: string[] = [];
  const done: string[] = [];
  const problems: string[] = [];
  let wrotePrice = false;
  const alreadyApplied = "Someone else has already applied this line.";

  // ---- ingredient
  if (ing && wantsIngredient) {
    const newPrice = round4(toNum(line.new_pack_price)!);
    const ledger = await insertLedger(sb, {
      line_id: line.id, document_id: doc.id, venue_id: doc.venue_id, target: "ingredient", target_id: ing.id, kind: ingKind, mode,
      old_price: toNum(ing.pack_price), new_price: ingKind === "price_confirmed" ? toNum(ing.pack_price) : newPrice,
      old_last_price_update: ing.last_price_update, old_previous_price: toNum(ing.previous_price), old_source: ing.source, applied_by: actor,
    });
    if (ledger === null) return refuse(alreadyApplied);
    if (ingKind === "price_change") {
      const upd = await sb.from("cost_ingredients").update({ pack_price: newPrice, source: label }).eq("id", ing.id).eq("pack_price", ing.pack_price).select("id");
      if (upd.error || !upd.data || upd.data.length === 0) {
        await sb.from("invoice_price_changes").delete().eq("id", ledger);
        if (upd.error) throw new Error(upd.error.message);
        return refuse(`The price of ${ing.name} changed while this was being applied. Nothing was written.`, { stale: true });
      }
      wrotePrice = true;
      changeIds.push(ledger);
      // the trigger set last_price_update to today; an invoice dated earlier (but later than the old date) sets the real date
      const patch: Record<string, unknown> = {};
      const invDate = doc.invoice_date;
      if (invDate && invDate < today && (!ing.last_price_update || invDate > ing.last_price_update)) {
        await sb.from("cost_ingredients").update({ last_price_update: invDate }).eq("id", ing.id).eq("pack_price", newPrice);
      }
      const log = await sb.from("cost_price_log").select("id,source,new_price").eq("ingredient_id", ing.id).order("id", { ascending: false }).limit(1);
      const row = (log.data ?? [])[0] as { id: number; source: string | null; new_price: number } | undefined;
      if (row && row.source === label && sameMoney(row.new_price, newPrice)) patch.cost_log_id = row.id;
      if (Object.keys(patch).length) await sb.from("invoice_price_changes").update(patch).eq("id", ledger);
      done.push(`${ing.name} is now ${money(newPrice)} (was ${money(toNum(ing.pack_price))}).`);
    } else {
      const lpu = later(ing.last_price_update, invDateCapped(doc.invoice_date, today));
      const upd = await sb.from("cost_ingredients").update({ last_price_update: lpu }).eq("id", ing.id).eq("pack_price", ing.pack_price).select("id");
      if (upd.error || !upd.data || upd.data.length === 0) {
        await sb.from("invoice_price_changes").delete().eq("id", ledger);
        if (upd.error) throw new Error(upd.error.message);
        return refuse(`The price of ${ing.name} changed while this was being confirmed. Nothing was written.`, { stale: true });
      }
      changeIds.push(ledger);
      const log = await insertRow(sb, "cost_price_log", { ingredient_id: ing.id, old_price: toNum(ing.pack_price), new_price: toNum(ing.pack_price), source: `${label} (price confirmed)`, entered_by: actor }).select("id").single();
      if (log.data) await sb.from("invoice_price_changes").update({ cost_log_id: (log.data as { id: number }).id }).eq("id", ledger);
      done.push(`${ing.name}: price confirmed at ${money(toNum(ing.pack_price))}.`);
    }
  }

  // ---- ordering product (a confirmation changes nothing there, so there is nothing to write or undo)
  if (prod && wantsProduct) {
    const newPrice = round4(toNum(line.new_product_price)!);
    if (prodKind === "price_confirmed") {
      done.push(`${prod.name}: order price confirmed at ${money(toNum(prod.price_inc_gst) ?? newPrice)}.`);
    } else {
      const ledger = await insertLedger(sb, {
        line_id: line.id, document_id: doc.id, venue_id: doc.venue_id, target: "ordering_product", target_id: prod.id, kind: "price_change", mode,
        old_price: toNum(prod.price_inc_gst), new_price: newPrice, old_last_price_update: null, old_previous_price: null, old_source: null, applied_by: actor,
      });
      if (ledger === null) {
        if (changeIds.length) problems.push(`The order price of ${prod.name} was applied by someone else, so it was left alone.`);
        else return refuse(alreadyApplied);
      } else {
        let q: any = sb.from("ordering_products").update({ price_inc_gst: newPrice }).eq("id", prod.id);
        q = prod.price_inc_gst === null ? q.is("price_inc_gst", null) : q.eq("price_inc_gst", prod.price_inc_gst);
        const upd = await q.select("id");
        if (upd.error || !upd.data || upd.data.length === 0) {
          await sb.from("invoice_price_changes").delete().eq("id", ledger);
          if (changeIds.length) problems.push(`The order price of ${prod.name} changed while this was being applied, so it was left alone.`);
          else if (upd.error) throw new Error(upd.error.message);
          else return refuse(`The order price of ${prod.name} changed while this was being applied. Nothing was written.`, { stale: true });
        } else {
          wrotePrice = true;
          changeIds.push(ledger);
          const log = await insertRow(sb, "ordering_price_log", { venue_id: doc.venue_id, product_id: prod.id, old_price: toNum(prod.price_inc_gst), new_price: newPrice, changed_by: actor, invoice_document_id: doc.id }).select("id").single();
          if (log.data) await sb.from("invoice_price_changes").update({ ordering_log_id: (log.data as { id: string }).id }).eq("id", ledger);
          done.push(`${prod.name} order price is now ${money(newPrice)} inc GST (was ${money(toNum(prod.price_inc_gst))}).`);
        }
      }
    }
  }

  const state = wrotePrice ? "applied" : "confirmed";
  check(await sb.from("invoice_lines").update({ state }).eq("id", lineId), "Could not update the line");
  await recomputeDocumentStatus(sb, doc.id);
  return { lineId, ok: true, message: [...done, ...problems].join(" "), changeIds };
}

/** An invoice dated in the future (a misread date) never pushes last_price_update past today. */
function invDateCapped(invoiceDate: string | null, today: string): string {
  return invoiceDate && invoiceDate < today ? invoiceDate : today;
}

/**
 * Writes the undo ledger row. Returns its id, or null when the database says this line and target already have a live change
 * (the partial unique index on invoice_price_changes(line_id, target) where status = 'applied': Postgres 23505).
 */
async function insertLedger(sb: SupabaseClient, row: Omit<InvoicePriceChangeRow, "id" | "cost_log_id" | "ordering_log_id" | "note" | "status" | "applied_at" | "reverted_by" | "reverted_at" | "revert_note">): Promise<string | null> {
  const res = await insertRow(sb, "invoice_price_changes", { ...row, status: "applied", applied_at: new Date().toISOString() }).select("id").single();
  if (res.error && (res.error as { code?: string }).code === "23505") return null;
  return (check(res, "Could not write the undo ledger, so nothing was changed").data as { id: string }).id;
}

export const applyDocumentAuto: ApplyDocumentAuto = async (sb, { documentId, actor }) => {
  const doc = await loadDoc(sb, documentId);
  // nothing_to_apply still holds confirmations: an invoice whose every price equals the app's has no change to apply but does confirm them
  if (!doc || (doc.status !== "needs_review" && doc.status !== "partly_applied" && doc.status !== "nothing_to_apply")) return [];
  const lines = (check(await sb.from("invoice_lines").select("id,line_no,decision,state").eq("document_id", documentId).eq("state", "open").order("line_no", { ascending: true }), "Could not read the lines").data ?? []) as Pick<InvoiceLineRow, "id" | "decision" | "state">[];
  const results: ApplyResult[] = [];
  for (const l of lines) {
    // learning mode applies nothing, except that confirming a price changes no cost
    const eligible = l.decision === "same" || (l.decision === "apply" && doc.mode === "auto");
    if (!eligible) continue;
    results.push(await applyLine(sb, { lineId: l.id, actor, mode: "auto" }));
  }
  return results;
};

// ============================================================================================================== undo
export const undoChange: UndoChange = async (sb, { changeId, actor, force }) => {
  try {
    return await undoInner(sb, changeId, actor, !!force);
  } catch (e) {
    return { ok: false, message: `Nothing was changed. ${e instanceof Error ? e.message : "Something went wrong."}` };
  }
};

async function undoInner(sb: SupabaseClient, changeId: string, actor: string, force: boolean): Promise<UndoResult> {
  const ch = check(await sb.from("invoice_price_changes").select("*").eq("id", changeId).maybeSingle(), "Could not read the undo ledger").data as InvoicePriceChangeRow | null;
  if (!ch) return { ok: false, message: "That change was not found." };
  if (ch.status !== "applied") return { ok: false, message: "That change has already been undone." };
  const doc = await loadDoc(sb, ch.document_id);
  if (!doc) return { ok: false, message: "The invoice for that change no longer exists." };
  const label = invoiceSourceLabel(doc, await supplierNameFor(sb, doc));
  const notes: string[] = [];
  let message: string;

  if (ch.target === "ingredient") {
    const ing = check(await sb.from("cost_ingredients").select("id,name,pack_price").eq("id", ch.target_id).maybeSingle(), "Could not read the ingredient").data as { id: string; name: string; pack_price: number } | null;
    if (!ing) return { ok: false, message: "The ingredient for that change no longer exists." };
    const live = toNum(ing.pack_price);
    const expected = ch.kind === "price_confirmed" ? ch.old_price : ch.new_price;
    if (!sameMoney(live, expected) && !force) {
      return { ok: false, needsForce: true, currentPrice: live, message: `${ing.name} is now ${money(live)}, not ${money(toNum(expected))}, so someone has changed it since this invoice. Undo it anyway only if you are sure.` };
    }
    if (!sameMoney(live, expected)) notes.push(`forced after the price had been changed to ${money(live)}`);
    if (ch.kind === "price_confirmed") {
      check(await sb.from("cost_ingredients").update({ last_price_update: ch.old_last_price_update ?? null }).eq("id", ing.id), "Could not restore the price date");
      message = `${ing.name}: the price confirmation was undone.`;
    } else {
      const old = toNum(ch.old_price);
      if (old === null) return { ok: false, message: "The ledger has no earlier price to go back to, so nothing was changed." };
      if (!sameMoney(live, old)) {
        const first = await sb.from("cost_ingredients").update({ pack_price: old, source: `Undo: ${label}` }).eq("id", ing.id).eq("pack_price", ing.pack_price).select("id");
        if (first.error) throw new Error(first.error.message);
        if (!first.data || first.data.length === 0) return { ok: false, message: `The price of ${ing.name} changed while this was being undone. Nothing was changed.` };
        const log = await sb.from("cost_price_log").select("id,source").eq("ingredient_id", ing.id).order("id", { ascending: false }).limit(1);
        const row = (log.data ?? [])[0] as { id: number; source: string | null } | undefined;
        if (row && row.source === `Undo: ${label}`) notes.push(`price log row ${row.id}`);
      }
      // the trigger moved previous_price, last_price_update and source; put them back (this update leaves pack_price alone, so it logs nothing)
      check(
        await sb.from("cost_ingredients").update({ previous_price: ch.old_previous_price ?? null, last_price_update: ch.old_last_price_update ?? null, source: ch.old_source ?? null }).eq("id", ing.id).eq("pack_price", old),
        "Could not restore the earlier price details",
      );
      message = `${ing.name} is back to ${money(old)} (was ${money(live)}).`;
    }
  } else {
    const prod = check(await sb.from("ordering_products").select("id,name,price_inc_gst").eq("id", ch.target_id).maybeSingle(), "Could not read the ordering product").data as { id: string; name: string; price_inc_gst: number | null } | null;
    if (!prod) return { ok: false, message: "The ordering product for that change no longer exists." };
    const live = toNum(prod.price_inc_gst);
    if (!sameMoney(live, ch.new_price) && !force) {
      return { ok: false, needsForce: true, currentPrice: live, message: `The order price of ${prod.name} is now ${money(live)}, not ${money(toNum(ch.new_price))}, so someone has changed it since this invoice. Undo it anyway only if you are sure.` };
    }
    if (!sameMoney(live, ch.new_price)) notes.push(`forced after the price had been changed to ${money(live)}`);
    const old = toNum(ch.old_price);
    let q: any = sb.from("ordering_products").update({ price_inc_gst: old }).eq("id", prod.id);
    q = prod.price_inc_gst === null ? q.is("price_inc_gst", null) : q.eq("price_inc_gst", prod.price_inc_gst);
    const upd = await q.select("id");
    if (upd.error) throw new Error(upd.error.message);
    if (!upd.data || upd.data.length === 0) return { ok: false, message: `The order price of ${prod.name} changed while this was being undone. Nothing was changed.` };
    const log = await insertRow(sb, "ordering_price_log", { venue_id: ch.venue_id, product_id: prod.id, old_price: live, new_price: old, changed_by: actor, invoice_document_id: ch.document_id }).select("id").single();
    if (log.data) notes.push(`order price log row ${(log.data as { id: string }).id}`);
    message = `${prod.name} order price is back to ${money(old)} (was ${money(live)}).`;
  }

  const revertNote = `Undone by ${actor}${notes.length ? `: ${notes.join(", ")}` : ""}.`;
  check(
    await sb.from("invoice_price_changes").update({ status: "reverted", reverted_by: actor, reverted_at: new Date().toISOString(), revert_note: revertNote }).eq("id", ch.id).eq("status", "applied"),
    "Could not mark the change as undone",
  );
  // the line is reverted only when none of its changes (ingredient and ordering product) is still applied
  const left = check(await sb.from("invoice_price_changes").select("id").eq("line_id", ch.line_id).eq("status", "applied"), "Could not read the undo ledger").data ?? [];
  if (left.length === 0) await sb.from("invoice_lines").update({ state: "reverted" }).eq("id", ch.line_id);
  await recomputeDocumentStatus(sb, ch.document_id);
  return { ok: true, message };
}

export const undoDocument: UndoDocument = async (sb, { documentId, actor, force }) => {
  const { data, error } = await sb.from("invoice_price_changes").select("id,applied_at").eq("document_id", documentId).eq("status", "applied").order("applied_at", { ascending: false });
  if (error) return [{ ok: false, message: `Nothing was changed. ${error.message}` }];
  const rows = (data ?? []) as { id: string }[];
  if (rows.length === 0) return [{ ok: false, message: "This invoice has no applied changes to undo." }];
  const results: UndoResult[] = [];
  for (const r of rows) {
    const res = await undoChange(sb, { changeId: r.id, actor, force });
    results.push(res);
    if (res.needsForce) break; // newest first: stop at the first price someone else has moved
  }
  return results;
};

