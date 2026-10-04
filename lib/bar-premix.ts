/**
 * Bar display, Pre-Mix Bottles page (/bar/<venue>/premix): data shape and pure display helpers.
 * At Drift and Greedy Gringo's the bar makes drink pre-mixes before service in 700 ml bottles labelled with the drink
 * ("Bulcock Banger Pre-Mix"), and a cocktail card says "2½ shots Bulcock Banger Pre-Mix" (1 shot = 30 ml).
 * Data comes from the public `cost_bar_premix(slug)` function: display fields only, never prices, costs or notes.
 */
import { barIngredientName, qtyText, toMl } from "./bar";

export const SHOT_ML = 30;

export interface PremixLine {
  /** ingredient name as shown on the bar (pack size dropped) */
  name: string;
  qty: number;
  unit: string;
  sort: number;
}

export interface PremixUse {
  /** the cocktail or mocktail that uses this pre-mix */
  drink: string;
  qty: number;
  unit: string;
}

export interface Premix {
  id: string;
  name: string;
  yieldQty: number;
  yieldUnit: string;
  lines: PremixLine[];
  usedIn: PremixUse[];
}

export interface BarPremix {
  venue: { slug: string; name: string };
  premixes: Premix[];
  /** when this copy was read from the database (ISO) */
  syncedAt: string;
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** A finite number, or 0 for anything that isn't one ("90", 90 and 90.0 all read as 90). */
function num(v: unknown): number {
  const n = typeof v === "string" && v.trim() === "" ? NaN : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function rows(v: unknown): Record<string, unknown>[] {
  return (Array.isArray(v) ? v : []).filter((x): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x));
}

/**
 * Validates the `cost_bar_premix` payload. Null when the venue doesn't exist or the reply isn't the right shape.
 * Malformed rows are dropped rather than failing the page: a pre-mix with no name, an ingredient line with no name,
 * a "used in" row with no drink. Numbers are coerced; lines stay in recipe order (`sort`), pre-mixes and drinks A to Z.
 */
export function parseBarPremix(raw: unknown, syncedAt: string): BarPremix | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { venue?: { slug?: unknown; name?: unknown }; premixes?: unknown };
  if (!r.venue || typeof r.venue.slug !== "string") return null;
  const premixes: Premix[] = rows(r.premixes)
    .map((p, i) => {
      const name = str(p.name);
      if (!name) return null;
      const lines = rows(p.lines)
        .map((l, j) => ({ name: str(l.name), qty: num(l.qty), unit: str(l.unit), sort: l.sort == null ? j : num(l.sort), j }))
        .filter((l) => l.name)
        .sort((a, b) => a.sort - b.sort || a.j - b.j)
        .map(({ name: n, qty, unit, sort }) => ({ name: n, qty, unit, sort }));
      const usedIn = rows(p.used_in)
        .map((u) => ({ drink: str(u.drink), qty: num(u.qty), unit: str(u.unit) }))
        .filter((u) => u.drink)
        .sort((a, b) => a.drink.localeCompare(b.drink, "en-AU"));
      return { id: str(p.id) || `premix-${i}`, name, yieldQty: num(p.yield_qty), yieldUnit: str(p.yield_unit), lines, usedIn };
    })
    .filter((p): p is Premix => p !== null)
    .sort((a, b) => a.name.localeCompare(b.name, "en-AU"));
  return { venue: { slug: r.venue.slug, name: str(r.venue.name) || r.venue.slug }, premixes, syncedAt };
}

/** The pre-mix's full volume in ml ("0.7 L" gives 700), or null when it isn't a volume. */
export function bottleMl(p: Pick<Premix, "yieldQty" | "yieldUnit">): number | null {
  const ml = toMl(p.yieldQty, p.yieldUnit);
  return ml != null && ml > 0 ? ml : null;
}

/** "700 ml bottle". Anything past a litre is a batch, not a bottle; a non-volume yield reads "Makes 2 kg". */
export function bottleSizeText(p: Pick<Premix, "yieldQty" | "yieldUnit">): string {
  const ml = bottleMl(p);
  if (ml == null) return p.yieldQty > 0 ? `Makes ${qtyText(p.yieldQty, p.yieldUnit).replace(/(\d)([a-z])/i, "$1 $2")}` : "";
  const n = Math.round(ml * 10) / 10;
  if (ml <= 1000) return `${n.toLocaleString("en-AU", { maximumFractionDigits: 1 })} ml bottle`;
  return `${(Math.round(ml) / 1000).toLocaleString("en-AU", { maximumFractionDigits: 2 })} L batch`;
}

/**
 * "2½ shots" for a pour that is a whole number of half shots (15 ml steps), else null. Same wording as the cocktail card
 * ("½ shot", "1 shot", "1½ shots", "2½ shots"...), carried on past the card's own table so a 150 ml line still reads "5 shots".
 */
export function shotsText(qty: number, unit: string): string | null {
  const ml = toMl(qty, unit);
  if (ml == null || ml <= 0) return null;
  const halves = ml / (SHOT_ML / 2);
  const h = Math.round(halves);
  if (h < 1 || Math.abs(halves - h) > 1e-6) return null;
  const whole = Math.floor(h / 2);
  const amount = h % 2 ? `${whole || ""}½` : String(whole);
  return `${amount} ${h <= 2 ? "shot" : "shots"}`;
}

/** The amount as poured, big on the card: "150 ml" (one decimal at most, "116.7 ml"). Other units keep their own style. */
export function premixAmount(qty: number, unit: string): string {
  const ml = toMl(qty, unit);
  if (ml == null) return qtyText(qty, unit);
  return `${(Math.round(ml * 10) / 10).toLocaleString("en-AU", { maximumFractionDigits: 1 })} ml`;
}

/** How many full serves of `qty`/`unit` one bottle holds: a 700 ml bottle at 75 ml a drink makes 9. Null when it can't be worked out. */
export function servesPerBottle(bottle: number | null, qty: number, unit: string): number | null {
  const serve = toMl(qty, unit);
  if (bottle == null || serve == null || serve <= 0) return null;
  return Math.floor(bottle / serve + 1e-9);
}

/**
 * An ingredient line on the bottle card, in whole millilitres, rounded DOWN ("233.3 ml" reads "233 ml"): nobody measures
 * a third of a ml, and a bottle that is a few drops short still fits in the 700 ml. The tiny addition stops float noise
 * (149.9999999) from dropping a clean 150. Other units keep their own style.
 */
export function bottleLineAmount(qty: number, unit: string): string {
  const ml = toMl(qty, unit);
  if (ml == null) return qtyText(qty, unit);
  return `${Math.floor(ml + 1e-6).toLocaleString("en-AU")} ml`;
}

export interface PremixLineDisplay {
  name: string;
  /** "150 ml" */
  amount: string;
  /** "5 shots" when the line is a clean multiple of 15 ml */
  shots: string | null;
}

export function premixLineDisplay(l: PremixLine): PremixLineDisplay {
  return { name: barIngredientName(l.name), amount: bottleLineAmount(l.qty, l.unit), shots: shotsText(l.qty, l.unit) };
}

export interface PremixUseDisplay {
  drink: string;
  /** "2½ shots" for a clean pour, else the amount ("80 ml") */
  pour: string;
  /** "9 serves per bottle" */
  serves: string | null;
}

export function premixUseDisplay(u: PremixUse, bottle: number | null): PremixUseDisplay {
  const n = servesPerBottle(bottle, u.qty, u.unit);
  return { drink: u.drink, pour: shotsText(u.qty, u.unit) ?? premixAmount(u.qty, u.unit), serves: n == null || n < 1 ? null : `${n} ${n === 1 ? "serve" : "serves"} per bottle` };
}

/** "2 pre-mixes" / "1 pre-mix" for the entry row on the station. */
export function premixCountText(n: number): string {
  return `${n} ${n === 1 ? "pre-mix" : "pre-mixes"}`;
}
