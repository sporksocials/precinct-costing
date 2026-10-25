/**
 * Invoices > To Do > Match Items: the pure rules, plus the hooks that load them.
 *
 * Mon and Matt teach the app what each supplier's items are. The SAME supplier item (supplier plus item code) shows up on many
 * invoices, and one answer is remembered for every future invoice and every venue, so the unit of work is the ITEM, not the
 * invoice line: 164 open lines from Markris are 113 items. This file groups the open "which ingredient is this?" questions by
 * item, picks the best suggestion for each, and builds the one answer that goes to every question about the item.
 *
 * The grouping, suggestions and answers are pure (no React, no database). The hooks at the bottom load the questions through
 * the signed-in client; a missing table or any failure gives "no data", never a throw.
 */
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseBrowser } from "./supabase/client";
import { useStore } from "./store";
import { descKey, normCode } from "./invoice-names";
import { loadQuestionBundles, type QuestionLoad } from "./invoice-data-extra";
import type { ItemGroupAnswer } from "./invoice-answer";
import type { QuestionOption } from "./invoice-types";
import { conversionView, type ConversionView } from "./invoice-conversion";
import { finalName, nameProblem, nameSizeFor, renameDefault, tidyInvoiceName, type RenameKind } from "./invoice-match-names";
import {
  ingredientAnswer,
  isMatchKind,
  readableCase,
  rowSuggestion,
  shortDate,
  supplierLabel,
  type Decision,
  type IngredientLite,
  type QuestionBundle,
  type RowSuggestion,
} from "./invoice-questions-view";

/* ---------------------------------------------------------------- the shapes */

/** Invoices in these states are not real work: a duplicate, a failed read, or one set aside. */
const SKIP_DOC_STATUS = new Set(["duplicate", "failed", "ignored"]);

/** The route segment for lines whose invoice has no supplier yet. */
export const UNKNOWN_SUPPLIER_PARAM = "unknown";
export const UNKNOWN_SUPPLIER_NAME = "Unknown Supplier";

export interface ItemInvoice {
  docId: string;
  number: string | null;
  /** yyyy-mm-dd, or null when the invoice has no date */
  date: string | null;
}

/** One supplier item with everything open about it. */
export interface ItemGroup {
  /** "<supplier id>|c:<code>" or "<supplier id>|d:<description key>" */
  key: string;
  supplierId: string | null;
  supplierName: string;
  /** the latest printed description, in readable case */
  description: string;
  code: string | null;
  unit: string | null;
  /** the unit price ex GST on the newest invoice that has one */
  lastPriceEx: number | null;
  /** the distinct invoices this item sits on, newest first */
  invoices: ItemInvoice[];
  /** every open question about the item (one per invoice line) */
  questionIds: string[];
  /** the same questions with their line and invoice; the latest first */
  bundles: QuestionBundle[];
  /** what the engine offered across the questions, one entry per option id */
  options: QuestionOption[];
  venueIds: number[];
}

export interface SupplierCard {
  supplierId: string | null;
  /** the segment for /invoices/match/<param> */
  param: string;
  name: string;
  items: number;
  invoices: number;
  /** the newest invoice date among its items */
  lastDate: string | null;
}

export interface MatchCounts {
  items: number;
  suppliers: number;
}

/* ---------------------------------------------------------------- grouping */

/** The key two lines share when they are the same supplier item: the item code when there is one, else the description. */
export function itemKey(supplierId: string | null, line: { item_code?: string | null; description?: string | null }): string {
  const code = normCode(line.item_code);
  const scope = supplierId ?? UNKNOWN_SUPPLIER_PARAM;
  if (code) return `${scope}|c:${code}`;
  return `${scope}|d:${descKey(line.description)}`;
}

/** True for a question the Match Items screen answers: an open "which ingredient is this line?" on a real invoice. */
export function isMatchItemQuestion(b: QuestionBundle): boolean {
  return b.q.status === "open" && isMatchKind(b.q.kind) && !!b.q.line_id && !!b.line && !(b.doc && SKIP_DOC_STATUS.has(b.doc.status));
}

const dateOf = (b: QuestionBundle) => b.doc?.invoice_date ?? "";

/** Newest invoice first; ties by when the question was raised. */
function newestFirst(a: QuestionBundle, c: QuestionBundle): number {
  return dateOf(c).localeCompare(dateOf(a)) || c.q.created_at.localeCompare(a.q.created_at);
}

/**
 * Open match questions grouped by supplier item. Biggest first (most invoices, then most lines), then A to Z. Lines on a
 * duplicate, failed or ignored invoice are left out. An item with no code is grouped by its description.
 */
export function groupItems(bundles: readonly QuestionBundle[]): ItemGroup[] {
  const by = new Map<string, QuestionBundle[]>();
  for (const b of bundles) {
    if (!isMatchItemQuestion(b)) continue;
    const key = itemKey(b.doc?.supplier_id ?? null, b.line!);
    const list = by.get(key);
    if (list) list.push(b);
    else by.set(key, [b]);
  }
  const groups: ItemGroup[] = [];
  for (const [key, list] of by) {
    list.sort(newestFirst);
    const latest = list[0];
    const line = latest.line!;
    const priced = list.find((b) => b.line?.unit_price_ex != null);
    const seen = new Map<string, ItemInvoice>();
    for (const b of list) if (!seen.has(b.q.document_id)) seen.set(b.q.document_id, { docId: b.q.document_id, number: b.doc?.invoice_number?.trim() || null, date: b.doc?.invoice_date ?? null });
    const options = new Map<string, QuestionOption>();
    for (const b of list) for (const o of b.q.options ?? []) if (!options.has(o.id)) options.set(o.id, o);
    groups.push({
      key,
      supplierId: latest.doc?.supplier_id ?? null,
      supplierName: latest.doc?.supplier_id ? supplierLabel(latest) : UNKNOWN_SUPPLIER_NAME,
      description: readableCase(line.description) || "(No description)",
      code: line.item_code?.trim() || null,
      unit: line.unit?.trim() || null,
      lastPriceEx: priced?.line?.unit_price_ex != null ? Number(priced.line.unit_price_ex) : null,
      invoices: [...seen.values()],
      questionIds: list.map((b) => b.q.id),
      bundles: list,
      options: [...options.values()],
      venueIds: [...new Set(list.map((b) => b.q.venue_id))],
    });
  }
  return groups.sort((a, c) => c.invoices.length - a.invoices.length || c.questionIds.length - a.questionIds.length || a.description.localeCompare(c.description));
}

export function supplierParam(supplierId: string | null): string {
  return supplierId ?? UNKNOWN_SUPPLIER_PARAM;
}

/** The groups for one supplier, from the route segment. */
export function groupsForSupplier(groups: readonly ItemGroup[], param: string): ItemGroup[] {
  return groups.filter((g) => supplierParam(g.supplierId) === param);
}

/** One card per supplier, the one with the most to match first. */
export function supplierCards(groups: readonly ItemGroup[]): SupplierCard[] {
  const by = new Map<string, { card: SupplierCard; docs: Set<string> }>();
  for (const g of groups) {
    const param = supplierParam(g.supplierId);
    let e = by.get(param);
    if (!e) {
      e = { card: { supplierId: g.supplierId, param, name: g.supplierName, items: 0, invoices: 0, lastDate: null }, docs: new Set() };
      by.set(param, e);
    }
    e.card.items++;
    for (const inv of g.invoices) {
      e.docs.add(inv.docId);
      if (inv.date && (!e.card.lastDate || inv.date > e.card.lastDate)) e.card.lastDate = inv.date;
    }
  }
  return [...by.values()].map(({ card, docs }) => ({ ...card, invoices: docs.size })).sort((a, c) => c.items - a.items || a.name.localeCompare(c.name));
}

export function matchCounts(groups: readonly ItemGroup[]): MatchCounts {
  return { items: groups.length, suppliers: new Set(groups.map((g) => supplierParam(g.supplierId))).size };
}

/* ---------------------------------------------------------------- words */

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "38 items to match" */
export function itemsToMatch(n: number): string {
  return `${plural(n, "item", "items")} to match`;
}

/** "on 6 invoices" */
export function onInvoices(n: number): string {
  return `on ${plural(n, "invoice", "invoices")}`;
}

/** "6 invoices, last 19 Oct" (the year appears when it is not this year). */
export function seenOn(g: Pick<ItemGroup, "invoices">, today?: string): string {
  const n = g.invoices.length;
  const dates = g.invoices.map((i) => i.date).filter((d): d is string => !!d).sort();
  const last = dates.length ? shortDate(dates[dates.length - 1], today) : "";
  if (n === 1) return last ? `1 invoice, ${last}` : "1 invoice";
  return last ? `${n} invoices, last ${last}` : `${n} invoices`;
}

/** "Code 15026 · KG · 6 invoices": the quiet line under an item's name, minus the parts it lacks. */
export function itemMeta(g: Pick<ItemGroup, "code" | "unit">): string {
  return [g.code ? `Code ${g.code}` : null, g.unit ? g.unit.toUpperCase() : null].filter(Boolean).join(" · ");
}

/* ---------------------------------------------------------------- suggestions */

export interface GroupSuggestion {
  suggestion: RowSuggestion | null;
  /** the closest ingredients, best first, offered before anyone types */
  candidateIds: string[];
}

export type LocalSuggest = (line: { description: string; item_code: string | null; unit: string | null; unit_price_ex: number | null }, limit: number) => { ingredientId: string; score: number; why: string }[];

/**
 * The best suggestion and the closest ingredients for every item. The AI pass's pick (an option `suggest:<ingredientId>` on any of
 * the item's questions, best confidence first) wins; else the local scorer's top candidate when it is strong enough to pre-set.
 * The engine's own offers (older questions) come last among the candidates.
 */
export function groupSuggestions(groups: readonly ItemGroup[], suggest: LocalSuggest, presetScore: number, candidatesShown = 6): Map<string, GroupSuggestion> {
  const out = new Map<string, GroupSuggestion>();
  for (const g of groups) {
    const line = g.bundles[0].line!;
    const local = suggest({ description: line.description, item_code: line.item_code ?? null, unit: line.unit ?? null, unit_price_ex: line.unit_price_ex != null ? Number(line.unit_price_ex) : null }, 5);
    const conf = (o: QuestionOption) => {
      const c = (o as { confidence?: unknown }).confidence;
      return typeof c === "number" ? c : 0;
    };
    const own = g.bundles.flatMap((b) => b.q.options ?? []);
    const ai = own.filter((o) => o.id.startsWith("suggest:") && o.ingredient_id).sort((a, b) => conf(b) - conf(a));
    const suggestion = rowSuggestion([...ai, ...own.filter((o) => !o.id.startsWith("suggest:"))], local, presetScore);
    const ids: string[] = [];
    if (suggestion) ids.push(suggestion.ingredientId);
    for (const c of local) ids.push(c.ingredientId);
    for (const o of own) if (o.ingredient_id) ids.push(o.ingredient_id);
    const seen = new Set<string>();
    const candidateIds: string[] = [];
    for (const id of ids) {
      if (seen.has(id)) continue;
      seen.add(id);
      candidateIds.push(id);
      if (candidateIds.length >= candidatesShown) break;
    }
    out.set(g.key, { suggestion, candidateIds });
  }
  return out;
}

/** Items with a usable suggestion first, then the ones on the most invoices (the order the screen opens in). */
export function screenOrder(groups: readonly ItemGroup[], hasSuggestion: (key: string) => boolean): ItemGroup[] {
  return [...groups].sort((a, c) => Number(hasSuggestion(c.key)) - Number(hasSuggestion(a.key)) || c.invoices.length - a.invoices.length || a.description.localeCompare(c.description));
}

/** The progress line: "12 of 38 chosen". */
export function progressText(chosen: number, total: number): string {
  return `${chosen} of ${total} chosen`;
}

/* ---------------------------------------------------------------- answers */

/** Accept All Suggestions on items: every item with a suggestion (to an ingredient still in the app) and no choice yet takes it. */
export function acceptItemSuggestions(
  groups: readonly ItemGroup[],
  sugg: ReadonlyMap<string, GroupSuggestion>,
  decisions: ReadonlyMap<string, Decision>,
  nameOf: (ingredientId: string) => string | undefined,
): Map<string, Decision> {
  const next = new Map(decisions);
  for (const g of groups) {
    if (next.has(g.key)) continue;
    const s = sugg.get(g.key)?.suggestion;
    const name = s ? nameOf(s.ingredientId) : undefined;
    if (s && name) next.set(g.key, { t: "ingredient", ingredientId: s.ingredientId, name, via: "suggestion" });
  }
  return next;
}

export function acceptableItems(groups: readonly ItemGroup[], sugg: ReadonlyMap<string, GroupSuggestion>, decisions: ReadonlyMap<string, Decision>, nameOf: (id: string) => string | undefined): number {
  return groups.filter((g) => {
    if (decisions.has(g.key)) return false;
    const s = sugg.get(g.key)?.suggestion;
    return !!s && !!nameOf(s.ingredientId);
  }).length;
}

/**
 * What Save Matches sends for the chosen items: one answer per item, for every open question about it. Items with no choice are
 * left out. `packs` holds the conversion for the rows that show one (packs per invoice unit); an ingredient choice on a row that
 * is in the map is sent with that number in its note, and left out while the number is null (an unknown conversion is never
 * sent as 1). A row not in the map (a just-added ingredient) is sent as before and the engine works the unit out itself.
 */
export function buildItemAnswers(groups: readonly ItemGroup[], decisions: ReadonlyMap<string, Decision>, packs?: ReadonlyMap<string, number | null>): { key: string; answer: ItemGroupAnswer }[] {
  const out: { key: string; answer: ItemGroupAnswer }[] = [];
  for (const g of groups) {
    const d = decisions.get(g.key);
    if (!d) continue;
    if (d.t === "ingredient") {
      if (packs?.has(g.key) && !((packs.get(g.key) ?? 0) > 0)) continue;
      const a = ingredientAnswer(d.ingredientId, packs?.get(g.key) ?? null);
      out.push({ key: g.key, answer: { questionIds: g.questionIds, optionId: a.optionId, note: a.note } });
    } else if (d.t === "none") {
      out.push({ key: g.key, answer: { questionIds: g.questionIds, optionId: "not_a_product" } });
    } else {
      out.push({ key: g.key, answer: { questionIds: g.questionIds, optionId: d.optionId, ...(d.note !== undefined ? { note: d.note } : {}) } });
    }
  }
  return out;
}

/* ---------------------------------------------------------------- the conversion and the new name, per chosen item */

export interface NameEdit {
  /** what the person typed in the name box (undefined = the tidied invoice name) */
  text?: string;
  /** the Keep Current Name switch (undefined = its starting position) */
  keep?: boolean;
}

export interface NameView {
  current: string;
  /** what the box shows */
  text: string;
  /** Keep Current Name is on */
  keep: boolean;
  kind: RenameKind;
  /** a quiet sentence: why the switch started on, or "already named this" */
  note: string | null;
  /** why the typed name cannot be used (a clash, blank); the rename is skipped while it stands */
  problem: string | null;
  /** the name the ingredient will have after Save Matches, or null when it keeps its own */
  newName: string | null;
}

export interface RowDetail {
  ingredient: IngredientLite;
  conversion: ConversionView;
  name: NameView;
}

export interface DetailContext {
  ingById: ReadonlyMap<string, IngredientLite>;
  ingredients: readonly { id: string; name: string }[];
  gstRate: number;
  /** what was typed in each row's pack box */
  typedPacks: ReadonlyMap<string, string>;
  nameEdits: ReadonlyMap<string, NameEdit>;
  /** other active suppliers with an item matched to each ingredient */
  otherSuppliers: ReadonlyMap<string, number>;
}

/**
 * The conversion and the new name for every row whose choice is an ingredient already in the app (a just-added ingredient is
 * built from the line, so it has neither). Rows are taken in screen order: the first row to rename an ingredient wins and a
 * later row for the same ingredient starts with Keep Current Name on. Nothing here writes.
 */
export function buildDetails(rows: readonly ItemGroup[], decisions: ReadonlyMap<string, Decision>, ctx: DetailContext): Map<string, RowDetail> {
  const out = new Map<string, RowDetail>();
  const claimed = new Set<string>();
  for (const g of rows) {
    const d = decisions.get(g.key);
    if (!d || d.t !== "ingredient" || d.via === "new") continue;
    const ing = ctx.ingById.get(d.ingredientId);
    if (!ing) continue;
    const line = g.bundles[0].line!;
    const conversion = conversionView({ description: line.description, unit: g.unit, unitPriceEx: g.lastPriceEx, ingredient: ing, gstRate: ctx.gstRate, typed: ctx.typedPacks.get(g.key) });
    const edit = ctx.nameEdits.get(g.key);
    const tidy = tidyInvoiceName(line.description, nameSizeFor(line.description, conversion.packs));
    const text = edit?.text ?? tidy;
    const choice = renameDefault({ ingredientId: ing.id, currentName: ing.name, newName: finalName(text) || text, ingredients: ctx.ingredients, otherSuppliers: ctx.otherSuppliers.get(ing.id) ?? 0, takenInBatch: claimed.has(ing.id) });
    const keep = edit?.keep ?? !choice.rename;
    const problem = !keep && choice.kind !== "same" ? nameProblem(finalName(text), ing.id, ing.name, ctx.ingredients) : null;
    const willRename = !keep && !problem && choice.kind === "rename";
    if (willRename) claimed.add(ing.id);
    out.set(g.key, {
      ingredient: ing,
      conversion,
      name: { current: ing.name, text, keep: keep || choice.kind === "same", kind: choice.kind, note: choice.note, problem, newName: willRename ? finalName(text) : null },
    });
  }
  return out;
}

/** A row is settled once its choice is made AND, when it shows a conversion, the pack number is a real number. */
export function rowSettled(decision: Decision | undefined, detail: RowDetail | undefined): boolean {
  if (!decision) return false;
  if (decision.t !== "ingredient" || !detail) return true;
  return detail.conversion.packs != null;
}

/** The pack counts Save Matches sends, for the rows that show a conversion (null = held back until it is filled in). */
export function packsMap(details: ReadonlyMap<string, RowDetail>): Map<string, number | null> {
  return new Map([...details].map(([k, v]) => [k, v.conversion.packs]));
}

/** The renames the person has chosen, for the rows that are ready: old name, new name. */
export function chosenRenames(rows: readonly ItemGroup[], decisions: ReadonlyMap<string, Decision>, details: ReadonlyMap<string, RowDetail>): { key: string; ingredientId: string; from: string; to: string }[] {
  const out: { key: string; ingredientId: string; from: string; to: string }[] = [];
  for (const g of rows) {
    const det = details.get(g.key);
    if (!det || !decisions.has(g.key) || !rowSettled(decisions.get(g.key), det) || !det.name.newName) continue;
    out.push({ key: g.key, ingredientId: det.ingredient.id, from: det.ingredient.name, to: det.name.newName });
  }
  return out;
}

/** "3 items need a pack size" for the line above the bar; null when none. */
export function needsPackText(n: number): string | null {
  return n === 0 ? null : `${n} ${n === 1 ? "item needs" : "items need"} a pack size before ${n === 1 ? "it" : "they"} can be saved.`;
}

/** What the Not In The App confirmation lists: the items that will be ignored and remembered. */
export function ignoreItems(groups: readonly ItemGroup[]): { key: string; title: string; code: string | null; invoices: number }[] {
  return groups.map((g) => ({ key: g.key, title: g.description, code: g.code, invoices: g.invoices.length }));
}

/** Used when picking ingredient candidates for a row. */
export function candidatesFor(ids: readonly string[], lookup: ReadonlyMap<string, IngredientLite>): IngredientLite[] {
  const out: IngredientLite[] = [];
  for (const id of ids) {
    const ing = lookup.get(id);
    if (ing) out.push(ing);
  }
  return out;
}

/* ---------------------------------------------------------------- loading */

export const MATCH_KINDS = ["unmatched_line", "ambiguous_match"] as const;

/** Two screens ask for the same list at once (the To Do count and its section): the second one shares the first one's request. */
const SHARE_MS = 2000;
const shared = new Map<string, { at: number; p: Promise<QuestionLoad> }>();

function loadShared(sb: SupabaseClient, venueId: number | null, force: boolean): Promise<QuestionLoad> {
  const k = String(venueId ?? "all");
  const hit = shared.get(k);
  if (!force && hit && Date.now() - hit.at < SHARE_MS) return hit.p;
  const p = loadQuestionBundles(sb, { status: "open", venueId, kinds: MATCH_KINDS, pageAll: true });
  shared.set(k, { at: Date.now(), p });
  p.catch(() => shared.delete(k));
  return p;
}

export interface MatchData {
  sb: SupabaseClient;
  /** null until the first load finishes */
  groups: ItemGroup[] | null;
  available: boolean;
  error: string | null;
  loading: boolean;
  reload: () => Promise<void>;
}

/** The open match items for one venue (null = all), kept fresh: the last copy stays while a new one loads, and it reloads when the tab returns. */
export function useMatchData(venueId: number | null, enabled = true): MatchData {
  const sb = useMemo(() => getSupabaseBrowser(), []);
  const [groups, setGroups] = useState<ItemGroup[] | null>(null);
  const [available, setAvailable] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const load = useCallback(
    async (force = false) => {
      const mine = ++seq.current;
      try {
        const r = await loadShared(sb, venueId, force);
        if (mine !== seq.current) return;
        setGroups(groupItems(r.bundles));
        setAvailable(r.available);
        setError(null);
      } catch (e) {
        if (mine !== seq.current) return;
        setError(e instanceof Error ? e.message : String(e));
        setGroups((g) => g ?? []);
      }
    },
    [sb, venueId],
  );

  useEffect(() => {
    if (enabled) void load();
  }, [load, enabled]);

  useEffect(() => {
    if (!enabled) return;
    const again = () => {
      if (document.visibilityState === "visible") void load(true);
    };
    document.addEventListener("visibilitychange", again);
    return () => document.removeEventListener("visibilitychange", again);
  }, [load, enabled]);

  const reload = useCallback(() => load(true), [load]);
  return { sb, groups, available, error, loading: groups === null, reload };
}

/** The open match items for a venue slug (null = all venues). A slug that names no venue yet waits instead of showing everything. */
export function useMatchGroups(venue: string | null): MatchData & { waiting: boolean } {
  const { venues } = useStore();
  const found = venue ? venues.find((v) => v.slug === venue) : undefined;
  const waiting = !!venue && !found;
  const data = useMatchData(found ? found.id : null, !waiting);
  return { ...data, waiting, loading: waiting || data.loading };
}

/**
 * How many distinct items and suppliers have something to match (open lines on real invoices only). `venue` is a venue slug, or
 * null for all venues. A missing table or any error gives `data: null`, never a throw.
 */
export function useMatchCounts(venue: string | null): { data: MatchCounts | null; loading: boolean; reload: () => void } {
  const { groups, available, error, loading, reload } = useMatchGroups(venue);
  const data = useMemo<MatchCounts | null>(() => (groups && available && !error ? matchCounts(groups) : null), [groups, available, error]);
  return { data, loading, reload: () => void reload() };
}
