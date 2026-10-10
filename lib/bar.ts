/**
 * Bar display (the public iPad drinks station at /bar/<venue>): data shape and pure display helpers.
 * Data comes from the public `cost_bar_menu(slug)` function: display fields only, never prices or notes.
 */

/** Venues with a drinks station. Gelato Rumba has none. Order = the venue select screen. */
export const BAR_VENUES = ["drift", "chiobu", "greedy"] as const;
export type BarVenueSlug = (typeof BAR_VENUES)[number];
export function isBarVenue(slug: string): slug is BarVenueSlug {
  return (BAR_VENUES as readonly string[]).includes(slug);
}

/**
 * Public routes of the bar display: /bar, /bar/<venue>, its manifest and its refresh API (/api/bar/<venue>).
 * middleware.ts lets these through with no session check: they only ever read cost_bar_menu (no prices).
 */
export function isBarPath(pathname: string): boolean {
  return ["/bar", "/api/bar"].some((p) => pathname === p || pathname.startsWith(p + "/"));
}

/** What the drinks station carries: cocktails, mocktails and Drift's cold drinks (smoothies, iced coffees, frappes, milkshakes, spiders). */
export const BAR_CATEGORIES = ["Cocktail", "Mocktail", "Cold Drink"] as const;
export type BarCategory = (typeof BAR_CATEGORIES)[number];
export function isBarCategory(category: string | null | undefined): category is BarCategory {
  return (BAR_CATEGORIES as readonly string[]).includes(category ?? "");
}

/** The plural the station's selection chips use for each category. */
export const BAR_CATEGORY_LABELS: Record<BarCategory, string> = { Cocktail: "Cocktails", Mocktail: "Mocktails", "Cold Drink": "Cold Drinks" };

export interface BarChip {
  key: "all" | BarCategory;
  label: string;
}

/**
 * The selection chips for a venue: All, then one chip per category that venue actually has on the station (Chiobu and Greedy
 * have no cold drinks, so they never see a Cold Drinks chip that leads to an empty screen). With fewer than two categories
 * there is nothing to choose between, so no chips at all.
 */
export function barChips(items: readonly { category: string }[]): BarChip[] {
  const present = BAR_CATEGORIES.filter((c) => items.some((i) => i.category === c));
  if (present.length < 2) return [];
  return [{ key: "all", label: "All" }, ...present.map((c) => ({ key: c, label: BAR_CATEGORY_LABELS[c] }))];
}

export interface BarLine {
  name: string;
  qty: number;
  unit: string;
  note: string | null;
}

export interface BarItem {
  id: string;
  name: string;
  category: string;
  glass: string | null;
  /** photo file name in public/bar/cocktails/ (cost_menu_items.bar_photo); null falls back to the item's name */
  photo: string | null;
  /**
   * cost_menu_items.menu_group: items sharing it (at this venue) show as one card that opens to the flavours (lib/menu-groups.ts).
   * Absent from the payload (an older copy on the iPad, or a database without the column yet) reads as null: everything shows flat.
   */
  menuGroup: string | null;
  method: string[];
  garnish: string[];
  lines: BarLine[];
}

export interface BarMenu {
  venue: { slug: string; name: string };
  items: BarItem[];
  /** when this copy was read from the database (ISO) */
  syncedAt: string;
}

/** Ordered text list from a jsonb column: trimmed, empties dropped, anything that isn't a list of strings ignored. */
export function textList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((s): s is string => typeof s === "string").map((s) => s.trim()).filter(Boolean);
}

/**
 * What a cocktail, mocktail or cold drink still needs before the station shows it: both a glass and at least one method step
 * (the `cost_bar_menu` function applies the same rule). Photo and garnish are optional.
 */
export function barMissing(item: { glass?: string | null; method?: unknown }): ("glass" | "method")[] {
  const out: ("glass" | "method")[] = [];
  if (!(typeof item.glass === "string" && item.glass.trim())) out.push("glass");
  if (textList(item.method).length === 0) out.push("method");
  return out;
}

/** "Missing glass, missing method" for the editor; empty when nothing is missing. */
export function barMissingText(missing: readonly string[]): string {
  return missing.map((m, i) => `${i === 0 ? "Missing" : "missing"} ${m}`).join(", ");
}

/** Validates the `cost_bar_menu` payload. Null when the venue doesn't exist. */
export function parseBarMenu(raw: unknown, syncedAt: string): BarMenu | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { venue?: { slug?: unknown; name?: unknown }; items?: unknown };
  if (!r.venue || typeof r.venue.slug !== "string") return null;
  const items: BarItem[] = (Array.isArray(r.items) ? r.items : []).map((x) => {
    const i = x as Record<string, unknown>;
    return {
      id: String(i.id),
      name: String(i.name ?? "").trim(),
      category: String(i.category ?? ""),
      glass: typeof i.glass === "string" && i.glass.trim() ? i.glass.trim() : null,
      photo: typeof i.photo === "string" && i.photo.trim() ? i.photo.trim() : null,
      menuGroup: typeof i.menu_group === "string" && i.menu_group.trim() ? i.menu_group.replace(/\s+/g, " ").trim() : null,
      method: textList(i.method),
      garnish: textList(i.garnish),
      lines: (Array.isArray(i.lines) ? i.lines : []).map((y) => {
        const l = y as Record<string, unknown>;
        const note = typeof l.note === "string" && l.note.trim() ? l.note.trim() : null;
        return { name: String(l.name ?? ""), qty: Number(l.qty) || 0, unit: String(l.unit ?? ""), note };
      }),
    };
  });
  return { venue: { slug: r.venue.slug, name: String(r.venue.name ?? r.venue.slug) }, items, syncedAt };
}

/**
 * Clean measures a bartender pours with a jigger, from the approved design (15/30/45/60/90/120 ml),
 * plus 75 ml (2½ shots), which the live house pre-mix recipes use.
 */
export const SHOT_LABELS: Record<number, string> = { 15: "½ shot", 30: "1 shot", 45: "1½ shots", 60: "2 shots", 75: "2½ shots", 90: "3 shots", 120: "4 shots" };

/** Volume in ml for an ml or L amount; null for anything else (g, kg, each). */
export function toMl(qty: number, unit: string): number | null {
  if (unit === "ml") return qty;
  if (unit === "L") return Math.round(qty * 1000 * 1000) / 1000;
  return null;
}

/** "1½ shots" when the amount is a clean jigger measure, else null. */
export function shotsFor(qty: number, unit: string): string | null {
  const ml = toMl(qty, unit);
  if (ml == null || !Number.isInteger(ml)) return null;
  return SHOT_LABELS[ml] ?? null;
}

/**
 * Counting units that read as words ("2 scoops", "3 pumps"), singular to plural. The costing app's own units are only
 * g, kg, ml, L and each, but a line can arrive from other data (or a future unit) in these words, so the card reads sensibly.
 */
const WORD_UNITS: Record<string, string> = {
  scoop: "scoops",
  pump: "pumps",
  cup: "cups",
  slice: "slices",
  shot: "shots",
  dash: "dashes",
  drop: "drops",
  spoon: "spoons",
  handful: "handfuls",
  sachet: "sachets",
  wedge: "wedges",
  pinch: "pinches",
};

/** The unit as a word for a count: "scoop" for exactly 1, "scoops" otherwise; null when it is not a counting word. */
function wordUnit(unit: string, qty: number): string | null {
  const u = unit.trim().toLowerCase();
  const plural = Object.prototype.hasOwnProperty.call(WORD_UNITS, u) ? WORD_UNITS[u] : Object.values(WORD_UNITS).includes(u) ? u : null;
  if (!plural) return null;
  const singular = Object.keys(WORD_UNITS).find((k) => WORD_UNITS[k] === plural) as string;
  return qty === 1 ? singular : plural;
}

/** Compact amount as it reads behind a bar: "60ml", "5g", "2 each", "2 scoops". Empty for a zero amount. */
export function qtyText(qty: number, unit: string): string {
  if (!qty) return "";
  const ml = toMl(qty, unit);
  const n = ml ?? (unit === "kg" && qty < 1 ? qty * 1000 : qty);
  const u = ml != null ? "ml" : unit === "kg" && qty < 1 ? "g" : unit;
  const s = (Math.round(n * 1000) / 1000).toLocaleString("en-AU", { maximumFractionDigits: 3 });
  if (u === "each") return `${s} each`;
  const word = ml == null ? wordUnit(u, qty) : null;
  return word ? `${s} ${word}` : `${s}${u}`;
}

/**
 * Ingredient names in the costing app carry the pack size they're bought in ("Aperol (700ml)",
 * "Petes Pure Prosecco (bottle 750ml)"). On the bar that reads like a pour size, so it's dropped.
 * A bare "(L)" is a pack unit too, and frozen-fruit lines drop the "IQF" and the supplier ("Strawberries IQF (Caterers Choice)"
 * reads "Strawberries"). Other brackets ("House Pre-Mix (TBC)") stay.
 */
export function barIngredientName(name: string): string {
  let n = name;
  if (/\bIQF\b/i.test(n)) n = n.replace(/\s*\([^)]*\)\s*$/, "").replace(/\s+IQF\b/i, "");
  n = n.replace(/\s*\((?:[a-z]+\s+)?\d+(?:\.\d+)?\s*(?:ml|l|g|kg)\)\s*$/i, "").replace(/\s*\(L\)\s*$/, "");
  return n.trim() || name.trim();
}

export interface IngredientDisplay {
  /** shots ("2 shots") when the pour is a clean jigger measure */
  shots: string | null;
  /** the raw amount ("60ml"); shown small under the shots, or alone when there are no shots */
  qty: string;
  /** one-line amount when there are no shots: the line's note ("Splash", "3 dashes") or the raw amount */
  plain: string;
  /** a note that adds to a clean shot measure ("Floated on top"), shown under the ingredient name */
  aside: string | null;
  name: string;
}

/**
 * A note that IS the amount a bartender pours ("Splash", "3 dashes", "Pinch", "1 spoon, muddled", "Fill to the line",
 * "Top with soda"). The ml on those lines is only a costing estimate, so the note replaces the shots. Any other
 * note is an instruction ("Floated on top") and sits under the ingredient name, keeping the jigger measure.
 */
const AMOUNT_NOTE =
  /^(?:a\s+)?(?:splash|dash|dashes|pinch|top|topped|fill|spoon|drizzle|squeeze|rinse|scoop|pump)\b|^\d+(?:\.\d+)?\s*(?:dash|dashes|drops?|spoons?|tsp|tbsp|bar\s?spoons?|scoops?|pumps?|cups?|slices?|handfuls?)\b/i;
export function isAmountNote(note: string | null): boolean {
  return !!note && AMOUNT_NOTE.test(note.trim());
}

/**
 * `shots: false` is for drinks that are not poured by the jigger (smoothies, frappes, milkshakes): 90 ml of milk reads
 * "90ml", never "3 shots". A note that is the amount ("2 scoops") still replaces the ml; any other note sits under the name.
 */
export function ingredientDisplay(line: BarLine, opts: { shots?: boolean } = {}): IngredientDisplay {
  const qty = qtyText(line.qty, line.unit);
  const name = barIngredientName(line.name);
  if (opts.shots === false) {
    if (isAmountNote(line.note) || !qty) return { shots: null, qty, plain: line.note ?? qty, aside: null, name };
    return { shots: null, qty, plain: qty, aside: line.note, name };
  }
  const shots = isAmountNote(line.note) ? null : shotsFor(line.qty, line.unit);
  return {
    shots,
    qty,
    plain: shots ? "" : line.note ?? qty,
    aside: shots ? line.note : null,
    name,
  };
}

/** Cold drinks are measured in ml, scoops and pumps, not shots: the card turns the jigger measures off for them. */
export function usesShots(category: string | null | undefined): boolean {
  return category !== "Cold Drink";
}

export type GlassType = "martini" | "rocks" | "highball" | "coupe" | "wine";

/** A plain file name only ("mai-tai.jpg"): no folders, no dots at the start, so a stored value can't point outside the photo folder. */
const PHOTO_FILE = /^[a-z0-9][a-z0-9._-]*\.(?:jpe?g|png|webp)$/i;

/** Photos uploaded from the recipe editor live in the `bar-photos` storage bucket as "uploads/<item id>-<stamp>.jpg". */
const UPLOADED_PHOTO = /^uploads\/[a-z0-9][a-z0-9-]*\.(?:jpe?g|png|webp)$/i;
export function isUploadedPhoto(photo: string | null | undefined): photo is string {
  return !!photo && UPLOADED_PHOTO.test(photo);
}

/** A new, never-reused storage path for an item's photo, so a replaced photo can't be served stale from any cache. */
export function barUploadPath(itemId: string, now: number): string {
  return `uploads/${itemId.toLowerCase()}-${now.toString(36)}.jpg`;
}

/** Longest side capped at `max`, shape kept, never scaled up. */
export function fitWithin(width: number, height: number, max: number): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= max) return { width, height };
  const k = max / longest;
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) };
}

/** "Piña Colada" -> "pina-colada": accents folded to plain letters, apostrophes dropped, the rest to hyphens. */
export function slugForPhoto(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['\u2019]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Reference photo path for a cocktail. The item's own `photo` wins (an upload, or a file set when it was photographed, so
 * renaming the drink in the costing app can't orphan it); otherwise the file named after the drink. Not every item has a
 * file yet, so the station hides the photo on a 404 rather than reserve space for a broken image.
 */
export function barPhotoSrc(name: string, photo?: string | null): string {
  // uploaded photos are served through the app's own /bar/photo/ path (a rewrite to storage) so the iPad's offline copy can hold them
  if (isUploadedPhoto(photo)) return `/bar/photo/${photo}`;
  if (photo && PHOTO_FILE.test(photo)) return `/bar/cocktails/${photo}`;
  return `/bar/cocktails/${slugForPhoto(name)}.jpg`;
}

/** Which line icon to draw for a glass description. */
export function glassType(glass: string | null | undefined): GlassType {
  const g = (glass ?? "").toLowerCase();
  if (g.includes("martini")) return "martini";
  if (g.includes("rocks")) return "rocks";
  if (g.includes("tall") || g.includes("highball") || g.includes("high ball")) return "highball";
  if (g.includes("coupe") || g.includes("margarita")) return "coupe";
  if (g.includes("wine")) return "wine";
  // the large glasses and cups cold drinks come in (smoothies, shakes, frappes, iced coffees, spiders) draw as a tall glass
  if (/\b(large|pint|smoothie|iced|spider|cup|tumbler|parfait)\b|shake|frapp/.test(g)) return "highball";
  return "rocks";
}

/** "Synced just now" / "Synced 4 min ago" / "Synced 2 hr ago". */
export function syncedLabel(syncedAt: string, now: number): string {
  const mins = Math.floor((now - Date.parse(syncedAt)) / 60000);
  if (!Number.isFinite(mins) || mins < 1) return "Synced just now";
  if (mins < 60) return `Synced ${mins} min ago`;
  return `Synced ${Math.floor(mins / 60)} hr ago`;
}

/** The station refreshes every 5 minutes, so 15 minutes without a good copy means three failed tries in a row. */
export const STALE_AFTER_MS = 15 * 60_000;

/** True when the copy on screen is old enough that a bartender shouldn't trust it without knowing. */
export function isStale(syncedAt: string, now: number): boolean {
  const t = Date.parse(syncedAt);
  return !Number.isFinite(t) || now - t >= STALE_AFTER_MS;
}

/** "Last updated 25 min ago" / "Last updated 3 hr ago" for the out-of-date banner. */
export function staleAge(syncedAt: string, now: number): string {
  const mins = Math.floor((now - Date.parse(syncedAt)) / 60000);
  if (!Number.isFinite(mins) || mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  return hrs < 48 ? `${hrs} hr ago` : `${Math.floor(hrs / 24)} days ago`;
}
