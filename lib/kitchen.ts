import { isUploadedPhoto, textList } from "./bar";

/**
 * Kitchen station (the public iPad recipe screen at /kitchen/<venue>): data shape and pure display helpers.
 * Data comes from the public `cost_kitchen_data(slug)` function: ready dishes and preps with their recipe lines and the
 * allergen fields needed to roll allergens up. Display fields only, never prices. The allergen model lives in
 * lib/kitchen-model.ts so this file stays small enough for middleware.ts to import.
 */

/** Venues with a kitchen station. Adding a venue is one line here (its accent is already in globals.css). Order = the venue select screen. */
export const KITCHEN_VENUES = ["drift"] as const;
export type KitchenVenueSlug = (typeof KITCHEN_VENUES)[number];
export function isKitchenVenue(slug: string): slug is KitchenVenueSlug {
  return (KITCHEN_VENUES as readonly string[]).includes(slug);
}

export const KITCHEN_NAMES: Record<string, string> = { drift: "Drift", chiobu: "Chiobu", greedy: "Greedy Gringo's", gelato: "Gelato Rumba" };

/**
 * Public routes of the kitchen station: /kitchen, /kitchen/<venue>, its photos, manifest and refresh API (/api/kitchen/<venue>).
 * middleware.ts lets these through with no session check: they only ever read cost_kitchen_data (no prices).
 */
export function isKitchenPath(pathname: string): boolean {
  return ["/kitchen", "/api/kitchen"].some((p) => pathname === p || pathname.startsWith(p + "/"));
}

export type YieldUnit = "kg" | "L" | "each";

export interface KitchenDish {
  id: string;
  name: string;
  section: string | null;
  /** the recipe lines make this many portions */
  portions: number;
  method: string[];
  plating: string[];
  /** storage path in the bar-photos bucket ("uploads/..."), already validated; null = no photo */
  photo: string | null;
  allergenAdd: string[];
  allergenRemove: string[];
  allergenNotes: Record<string, string> | null;
}

export interface KitchenPrep {
  id: string;
  name: string;
  prepType: string | null;
  yieldQty: number;
  yieldUnit: YieldUnit;
  /** the head chef signed it off: only these are listed on the Prep tab (the others exist so a dish's allergens and components resolve) */
  ready: boolean;
  method: string[];
  storage: string | null;
  allergenAdd: string[];
  allergenRemove: string[];
  allergenNotes: Record<string, string> | null;
}

export interface KitchenIngredient {
  id: string;
  name: string;
  allergens: string[];
  /** false unless the database says true, so a missing value never reads as "reviewed" */
  reviewed: boolean;
  dietFlags: string[];
}

export interface KitchenLine {
  parentType: "item" | "prep";
  parentId: string;
  componentType: "ingredient" | "prep";
  componentId: string;
  qty: number;
  unit: string;
  note: string | null;
  sort: number;
}

export interface KitchenData {
  venue: { slug: string; name: string };
  dishes: KitchenDish[];
  preps: KitchenPrep[];
  ingredients: KitchenIngredient[];
  lines: KitchenLine[];
  /** when this copy was read from the database (ISO) */
  syncedAt: string;
}

/* ------------------------------------------------------------------ parsing */

function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}
function idOf(v: unknown): string | null {
  if (typeof v === "string" && v.trim()) return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}
function textOrNull(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}
function numberOr(v: unknown, fallback: number): number {
  const n = Number(v);
  return v != null && v !== "" && Number.isFinite(n) ? n : fallback;
}
/** A list of plain strings (allergen ids, diet flags): anything else in it is dropped. */
function stringList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : [];
}
function noteMap(v: unknown): Record<string, string> | null {
  const o = obj(v);
  if (!o) return null;
  const out: Record<string, string> = {};
  for (const [k, n] of Object.entries(o)) if (typeof n === "string" && n.trim()) out[k] = n.trim();
  return Object.keys(out).length ? out : null;
}

function parseDish(x: unknown): KitchenDish | null {
  const d = obj(x);
  const id = d && idOf(d.id);
  const name = d && textOrNull(d.name);
  if (!d || !id || !name) return null;
  const photo = textOrNull(d.photo);
  return {
    id,
    name,
    section: textOrNull(d.section),
    portions: numberOr(d.portions, 1) > 0 ? numberOr(d.portions, 1) : 1,
    method: textList(d.method),
    plating: textList(d.plating),
    photo: isUploadedPhoto(photo) ? photo : null,
    allergenAdd: stringList(d.allergen_add),
    allergenRemove: stringList(d.allergen_remove),
    allergenNotes: noteMap(d.allergen_notes),
  };
}

function parsePrep(x: unknown): KitchenPrep | null {
  const p = obj(x);
  const id = p && idOf(p.id);
  const name = p && textOrNull(p.name);
  if (!p || !id || !name) return null;
  const unit = p.yield_unit === "kg" || p.yield_unit === "L" ? p.yield_unit : "each";
  return {
    id,
    name,
    prepType: textOrNull(p.prep_type),
    yieldQty: Math.max(0, numberOr(p.yield_qty, 0)),
    yieldUnit: unit,
    ready: p.ready === true,
    method: textList(p.method),
    storage: textOrNull(p.storage),
    allergenAdd: stringList(p.allergen_add),
    allergenRemove: stringList(p.allergen_remove),
    allergenNotes: noteMap(p.allergen_notes),
  };
}

function parseIngredient(x: unknown): KitchenIngredient | null {
  const i = obj(x);
  const id = i && idOf(i.id);
  if (!i || !id) return null;
  return { id, name: textOrNull(i.name) ?? "Unknown ingredient", allergens: stringList(i.allergens), reviewed: i.allergens_reviewed === true, dietFlags: stringList(i.diet_flags) };
}

function parseLine(x: unknown): KitchenLine | null {
  const l = obj(x);
  const parentId = l && idOf(l.parent_id);
  const componentId = l && idOf(l.component_id);
  if (!l || !parentId || !componentId) return null;
  if ((l.parent_type !== "item" && l.parent_type !== "prep") || (l.component_type !== "ingredient" && l.component_type !== "prep")) return null;
  return { parentType: l.parent_type, parentId, componentType: l.component_type, componentId, qty: numberOr(l.qty, 0), unit: typeof l.unit === "string" ? l.unit : "", note: textOrNull(l.note), sort: numberOr(l.sort, 0) };
}

function list<T>(v: unknown, parse: (x: unknown) => T | null): T[] {
  return (Array.isArray(v) ? v : []).map(parse).filter((x): x is T => x !== null);
}

/** Validates the `cost_kitchen_data` payload. Null when the venue doesn't exist. Never throws on a malformed row: it is dropped. */
export function parseKitchenData(raw: unknown, syncedAt: string): KitchenData | null {
  const r = obj(raw);
  const venue = r && obj(r.venue);
  if (!r || !venue || typeof venue.slug !== "string") return null;
  return {
    venue: { slug: venue.slug, name: String(venue.name ?? venue.slug) },
    dishes: list(r.dishes, parseDish),
    preps: list(r.preps, parsePrep),
    ingredients: list(r.ingredients, parseIngredient),
    lines: list(r.lines, parseLine),
    syncedAt,
  };
}

/* ------------------------------------------------------------------ photos */

/** Same-origin path of a dish photo (a rewrite to the bar-photos bucket, see next.config.mjs), so the iPad's offline copy can hold it. Null when there is no valid upload. */
export function kitchenPhotoSrc(photo: string | null | undefined): string | null {
  return isUploadedPhoto(photo) ? `/kitchen/photo/${photo}` : null;
}

/* ------------------------------------------------------------------ sections */

/** Drift's menu sections in the order they are cooked and served. Unknown sections follow alphabetically, "Other" is last. */
export const SECTION_ORDER = ["Breakfast", "Kids", "Small Plates", "Little Drifters", "Mains", "Bowls & Salads", "Grill", "Burgers", "Pizzas", "Daily Specials", "Sweets"] as const;

export const OTHER_LABEL = "Other";
export function groupLabel(name: string | null | undefined): string {
  return name?.trim() || OTHER_LABEL;
}

/** Orders group labels: known ones by `order`, then the rest alphabetically, "Other" last. */
export function compareGroups(a: string, b: string, order: readonly string[] = SECTION_ORDER): number {
  const rank = (s: string) => {
    if (s === OTHER_LABEL) return Infinity;
    const i = order.findIndex((o) => o.toLowerCase() === s.toLowerCase());
    return i === -1 ? order.length : i;
  };
  return rank(a) - rank(b) || a.localeCompare(b);
}

export interface Group<T> {
  label: string;
  items: T[];
}

/** Items grouped under a label (name order inside each group), groups in `compareGroups` order. */
export function groupItems<T extends { name: string }>(items: T[], labelOf: (item: T) => string | null, order: readonly string[] = SECTION_ORDER): Group<T>[] {
  const by = new Map<string, T[]>();
  for (const it of items) {
    const label = groupLabel(labelOf(it));
    const arr = by.get(label);
    if (arr) arr.push(it);
    else by.set(label, [it]);
  }
  return [...by.entries()]
    .sort(([a], [b]) => compareGroups(a, b, order))
    .map(([label, arr]) => ({ label, items: [...arr].sort((a, b) => a.name.localeCompare(b.name)) }));
}

/** Case-insensitive "contains" on the name; an empty query matches everything. */
export function matchesName(name: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  return !q || name.toLowerCase().includes(q);
}

/* ------------------------------------------------------------------ quantities */

const FRACTIONS: [number, string][] = [[0.25, "¼"], [1 / 3, "⅓"], [0.5, "½"], [2 / 3, "⅔"], [0.75, "¾"]];

/** A whole-piece count the way a chef says it: 2, 1½, ¼. */
function countText(n: number): string {
  const r = Math.round(n * 1000) / 1000;
  const whole = Math.floor(r + 0.01);
  const frac = r - whole;
  if (Math.abs(frac) < 0.01) return String(whole);
  const f = FRACTIONS.find(([v]) => Math.abs(v - frac) < 0.02);
  if (f) return whole ? `${whole}${f[1]}` : f[1];
  return String(Math.round(r * 100) / 100);
}

/** Weights and volumes: whole numbers from 100 up, one decimal from 10, two below; trailing zeros dropped. */
function metricText(n: number): string {
  const dp = n >= 100 ? 0 : n >= 10 ? 1 : 2;
  return String(Number(n.toFixed(dp)));
}

export interface QtyParts {
  value: string;
  /** "g", "kg", "ml", "L", or "" for a count of pieces */
  unit: string;
}

/**
 * An amount as a chef reads it: grams under a kilo ("150 g", not 0.15 kg), kilos from 1,000 g, the same for ml and L,
 * and "each" as a bare count ("2", "1½"). Empty value for a zero amount.
 */
export function qtyParts(qty: number, unit: string): QtyParts {
  if (!(qty > 0)) return { value: "", unit: "" };
  if (unit === "each") return { value: countText(qty), unit: "" };
  const small = unit === "g" || unit === "kg" ? "g" : unit === "ml" || unit === "L" ? "ml" : null;
  if (!small) return { value: metricText(qty), unit };
  const big = small === "g" ? "kg" : "L";
  const inSmall = unit === small ? qty : qty * 1000;
  const rounded = Number(metricText(inSmall));
  if (rounded >= 1000) return { value: metricText(inSmall / 1000), unit: big };
  return { value: String(rounded), unit: small };
}

export function formatQty(qty: number, unit: string): string {
  const p = qtyParts(qty, unit);
  return p.unit ? `${p.value} ${p.unit}` : p.value;
}

/** The prep scale buttons, in the order shown. */
export const SCALES = [1, 2, 3, 0.5] as const;
export type Scale = (typeof SCALES)[number];
export function scaleLabel(k: number): string {
  return k === 0.5 ? "×½" : `×${k}`;
}

/** Display-only scaling; rounded so ×3 of a third does not drift into float noise. */
export function scaleQty(qty: number, k: number): number {
  return Math.round(qty * k * 1e6) / 1e6;
}

/** "Makes 2 kg" / "Makes 500 g" / "Makes 12", scaled. Empty when the prep has no yield. */
export function yieldText(qty: number, unit: string, k = 1): string {
  const s = formatQty(scaleQty(qty, k), unit);
  return s ? `Makes ${s}` : "";
}
