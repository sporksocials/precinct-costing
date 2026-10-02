/**
 * Bar display (the public iPad cocktail station at /bar/<venue>): data shape and pure display helpers.
 * Data comes from the public `cost_bar_menu(slug)` function: display fields only, never prices or notes.
 */

/** Venues with a cocktail station. Gelato Rumba has none. Order = the venue select screen. */
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

export const BAR_CATEGORIES = ["Cocktail", "Mocktail"] as const;
export type BarCategory = (typeof BAR_CATEGORIES)[number];
export function isBarCategory(category: string | null | undefined): category is BarCategory {
  return (BAR_CATEGORIES as readonly string[]).includes(category ?? "");
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

function toMl(qty: number, unit: string): number | null {
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

/** Compact amount as it reads behind a bar: "60ml", "5g", "2 each". Empty for a zero amount. */
export function qtyText(qty: number, unit: string): string {
  if (!qty) return "";
  const ml = toMl(qty, unit);
  const n = ml ?? (unit === "kg" && qty < 1 ? qty * 1000 : qty);
  const u = ml != null ? "ml" : unit === "kg" && qty < 1 ? "g" : unit;
  const s = (Math.round(n * 1000) / 1000).toLocaleString("en-AU", { maximumFractionDigits: 3 });
  return u === "each" ? `${s} each` : `${s}${u}`;
}

/**
 * Ingredient names in the costing app carry the pack size they're bought in ("Aperol (700ml)",
 * "Petes Pure Prosecco (bottle 750ml)"). On the bar that reads like a pour size, so it's dropped.
 * Other brackets ("House Pre-Mix (TBC)") stay.
 */
export function barIngredientName(name: string): string {
  return name.replace(/\s*\((?:[a-z]+\s+)?\d+(?:\.\d+)?\s*(?:ml|l|g|kg)\)\s*$/i, "").trim() || name.trim();
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
const AMOUNT_NOTE = /^(?:a\s+)?(?:splash|dash|dashes|pinch|top|topped|fill|spoon|drizzle|squeeze|rinse)\b|^\d+(?:\.\d+)?\s*(?:dash|dashes|drops?|spoons?|tsp|tbsp|bar\s?spoons?)\b/i;
export function isAmountNote(note: string | null): boolean {
  return !!note && AMOUNT_NOTE.test(note.trim());
}

export function ingredientDisplay(line: BarLine): IngredientDisplay {
  const shots = isAmountNote(line.note) ? null : shotsFor(line.qty, line.unit);
  const qty = qtyText(line.qty, line.unit);
  return {
    shots,
    qty,
    plain: shots ? "" : line.note ?? qty,
    aside: shots ? line.note : null,
    name: barIngredientName(line.name),
  };
}

export type GlassType = "martini" | "rocks" | "highball" | "coupe" | "wine";

/**
 * Reference photo path for a cocktail, from its name: "Mai Tai" -> "/bar/cocktails/mai-tai.jpg".
 * Not every item has a file yet (a new cocktail, or Chiobu/Greedy before they're photographed) — the
 * station hides the photo on a 404 rather than reserve space for a broken image.
 */
export function barPhotoSrc(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/'/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `/bar/cocktails/${slug}.jpg`;
}

/** Which line icon to draw for a glass description. */
export function glassType(glass: string | null | undefined): GlassType {
  const g = (glass ?? "").toLowerCase();
  if (g.includes("martini")) return "martini";
  if (g.includes("rocks")) return "rocks";
  if (g.includes("tall") || g.includes("highball")) return "highball";
  if (g.includes("coupe")) return "coupe";
  if (g.includes("wine")) return "wine";
  return "rocks";
}

/** "Synced just now" / "Synced 4 min ago" / "Synced 2 hr ago". */
export function syncedLabel(syncedAt: string, now: number): string {
  const mins = Math.floor((now - Date.parse(syncedAt)) / 60000);
  if (!Number.isFinite(mins) || mins < 1) return "Synced just now";
  if (mins < 60) return `Synced ${mins} min ago`;
  return `Synced ${Math.floor(mins / 60)} hr ago`;
}
