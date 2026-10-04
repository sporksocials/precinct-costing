import type { Beer, GelatoServe, GelatoServeLine, MenuItem, Offer, OfferLine, Prep, RecipeLine } from "./types";

/**
 * "What uses this record": the one place that answers it for the impact sheets (turning a record off, deleting it).
 * Pure, so it is tested without a browser. A reference is another record that points at this one; a plain note
 * (a computed price list, a deal that is live today) is not a reference and never blocks a delete.
 */

export type UsageKind = "recipe" | "prep" | "serve" | "beer" | "offer";
/** The kind of record the sheet is about. */
export type RecordKind = "item" | "prep" | "ingredient" | "beer" | "serve" | "offer" | "deal";

export interface UsageRef {
  kind: UsageKind;
  id: string;
  name: string;
  href: string;
  active: boolean;
}

/** What the impact sheets know about a record: the records that use it, and any plain-English side effects. */
export interface RecordImpact {
  refs: UsageRef[];
  /** side effects that are not references (e.g. "Every flavour loses this serve"). They show in the sheet but never block a delete. */
  notes: string[];
}

export interface UsageData {
  /** stored recipe lines (never the computed gelato or tap beer lines) */
  lines: readonly RecipeLine[];
  /** stored menu items */
  items: readonly Pick<MenuItem, "id" | "name" | "active">[];
  preps: readonly Pick<Prep, "id" | "name" | "active">[];
  serveLines?: readonly GelatoServeLine[];
  serves?: readonly Pick<GelatoServe, "id" | "name" | "active">[];
  beers?: readonly Pick<Beer, "id" | "name" | "active" | "ingredient_id">[];
  offerLines?: readonly OfferLine[];
  offers?: readonly Pick<Offer, "id" | "name" | "status">[];
}

const byName = (a: UsageRef, b: UsageRef) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name);

/** Records that use an ingredient or a prep as a component: menu items and preps (recipe lines), serves (packaging), tap beers (the keg). */
function usersOfComponent(type: "ingredient" | "prep", id: string, d: UsageData): UsageRef[] {
  const out = new Map<string, UsageRef>();
  const itemById = new Map(d.items.map((i) => [i.id, i]));
  const prepById = new Map(d.preps.map((p) => [p.id, p]));
  for (const l of d.lines) {
    if (l.component_type !== type || l.component_id !== id) continue;
    if (l.parent_type === "item") {
      const it = itemById.get(l.parent_id);
      if (it) out.set(`recipe:${it.id}`, { kind: "recipe", id: it.id, name: it.name, href: `/items/${it.id}`, active: it.active !== false });
    } else {
      const p = prepById.get(l.parent_id);
      if (p && !(type === "prep" && p.id === id)) out.set(`prep:${p.id}`, { kind: "prep", id: p.id, name: p.name, href: `/preps/${p.id}`, active: p.active !== false });
    }
  }
  if (type === "ingredient") {
    const serveById = new Map((d.serves ?? []).map((s) => [s.id, s]));
    for (const l of d.serveLines ?? []) {
      if (l.ingredient_id !== id) continue;
      const s = serveById.get(l.serve_id);
      if (s) out.set(`serve:${s.id}`, { kind: "serve", id: s.id, name: s.name, href: "/gelato/serves", active: s.active !== false });
    }
    for (const b of d.beers ?? []) {
      if (b.ingredient_id === id) out.set(`beer:${b.id}`, { kind: "beer", id: b.id, name: b.name, href: `/beers/${b.id}`, active: b.active !== false });
    }
  }
  return [...out.values()].sort(byName);
}

export const usageOfIngredient = (id: string, d: UsageData): UsageRef[] => usersOfComponent("ingredient", id, d);
export const usageOfPrep = (id: string, d: UsageData): UsageRef[] => usersOfComponent("prep", id, d);

function offersUsing(match: (l: OfferLine) => boolean, d: UsageData): UsageRef[] {
  const offerById = new Map((d.offers ?? []).map((o) => [o.id, o]));
  const out = new Map<string, UsageRef>();
  for (const l of d.offerLines ?? []) {
    if (!match(l)) continue;
    const o = offerById.get(l.offer_id);
    if (o) out.set(o.id, { kind: "offer", id: o.id, name: o.name, href: `/specials/${o.id}`, active: o.status !== "retired" });
  }
  return [...out.values()].sort(byName);
}

/** A menu item is used by the offers (combos, specials) that list it as a component. */
export const usageOfItem = (id: string, d: UsageData): UsageRef[] => offersUsing((l) => l.item_id === id, d);
/** A tap beer is used by the offers that list one of its serves. */
export const usageOfBeer = (id: string, d: UsageData): UsageRef[] => offersUsing((l) => l.beer_id === id, d);

/* ---------------------------------------------------------------- wording */

const NOUN: Record<UsageKind, [string, string]> = {
  recipe: ["recipe", "recipes"],
  prep: ["prep", "preps"],
  serve: ["serve", "serves"],
  beer: ["tap beer", "tap beers"],
  offer: ["offer", "offers"],
};
const ORDER: UsageKind[] = ["recipe", "prep", "offer", "beer", "serve"];

function joinAnd(parts: string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** "12 recipes, 2 preps and 1 offer". Empty string when nothing uses the record. */
export function summariseUsage(refs: readonly UsageRef[]): string {
  const counts = new Map<UsageKind, number>();
  for (const r of refs) counts.set(r.kind, (counts.get(r.kind) ?? 0) + 1);
  const parts: string[] = [];
  for (const k of ORDER) {
    const n = counts.get(k);
    if (n) parts.push(`${n} ${NOUN[k][n === 1 ? 0 : 1]}`);
  }
  return joinAnd(parts);
}

/** Up to `max` names, then how many more: { names: ["A", "B"], more: 3, text: "A, B and 3 more" }. */
export function nameList(refs: readonly Pick<UsageRef, "name">[], max = 5): { names: string[]; more: number; text: string } {
  const names = refs.slice(0, max).map((r) => r.name);
  const more = Math.max(0, refs.length - names.length);
  const text = more > 0 ? `${names.join(", ")} and ${more} more` : joinAnd(names);
  return { names, more, text };
}

/** The line that explains what turning a used record off does. "They keep their cost" is the promise. */
export function inactiveImpactLines(record: RecordKind, impact: RecordImpact): string[] {
  const lines: string[] = [];
  const used = summariseUsage(impact.refs);
  if (used) {
    if (record === "ingredient" || record === "prep") lines.push(`Used in ${used}. They keep their cost, but it will not be offered for new recipes.`);
    else lines.push(`Used in ${used}. They keep their cost, but it will not be offered for new ones.`);
  }
  lines.push(...impact.notes);
  return lines;
}

/** True when switching the record off deserves a confirmation first. */
export const needsOffConfirm = (impact: RecordImpact): boolean => impact.refs.length > 0 || impact.notes.length > 0;

const WITH_ARTICLE: Record<RecordKind, string> = {
  item: "menu item",
  prep: "prep",
  ingredient: "ingredient",
  beer: "tap beer",
  serve: "serve",
  offer: "offer",
  deal: "deal",
};
export const recordNoun = (k: RecordKind): string => WITH_ARTICLE[k];

/* ---------------------------------------------------------------- the delete sheet */

export interface DeleteDecision {
  title: string;
  /** what uses it, e.g. "Used in 3 recipes and 1 prep." (null when nothing does) */
  usageSummary: string | null;
  /** up to five names, then "and N more" */
  names: string[];
  more: number;
  namesText: string;
  /** side effects that are not references */
  notes: string[];
  /** Delete Permanently is only available when nothing uses the record */
  canDelete: boolean;
  /** why Delete is not available (null when it is) */
  blockedReason: string | null;
  /** the sentence under the title: why delete is blocked, or that nothing uses it and archiving is the safer move */
  lead: string;
  /** the button that archives: always shown first and visible */
  archiveLabel: string;
  /** false when the record is already inactive: there is nothing to archive, the button just keeps it that way */
  archiveChangesRecord: boolean;
  deleteLabel: string;
  deleteWarning: string;
}

/**
 * What the delete sheet shows and offers. Impact first, then archive as the obvious default, then (only for a record
 * nothing uses) the permanent delete. Pure: the sheet component just renders this.
 */
export function deleteDecision(input: { record: RecordKind; name: string; impact: RecordImpact; alreadyInactive?: boolean }): DeleteDecision {
  const { record, name, impact, alreadyInactive = false } = input;
  const used = impact.refs.length > 0;
  const noun = recordNoun(record);
  const summary = summariseUsage(impact.refs);
  const list = nameList(impact.refs, 5);
  const archiveLabel = alreadyInactive ? "Keep It Inactive" : used ? "Make Inactive Instead" : "Make Inactive Instead (Recommended)";
  return {
    title: `Delete “${name}”?`,
    usageSummary: used ? `Used in ${summary}.` : null,
    names: list.names,
    more: list.more,
    namesText: list.text,
    notes: impact.notes,
    canDelete: !used,
    blockedReason: used
      ? `This ${noun} is used in ${summary}, so it cannot be deleted. ${alreadyInactive ? "It is already inactive, so it is hidden and nothing breaks." : "Make it inactive instead: it is hidden, and what uses it keeps its cost."}`
      : null,
    lead: used
      ? ""
      : `${impact.notes.length ? "" : "Nothing else uses it. "}${alreadyInactive ? "It is already hidden." : "Making it inactive hides it without losing anything."}`,
    archiveLabel,
    archiveChangesRecord: !alreadyInactive,
    deleteLabel: "Delete Permanently",
    deleteWarning: "This cannot be undone.",
  };
}
