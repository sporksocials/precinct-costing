import { isBeerItemId, parseBeerItemId } from "./beer";
import { isVirtualItemId } from "./gelato";
import { isActive } from "./active";
import { titleCase } from "./name-tidy";
import { OWN_FORM_CATEGORIES } from "./add-choices";
import type { Beer, BeerServe, GelatoServe, MenuItem } from "./types";

/**
 * POS list: the menu and prices as a spreadsheet the venue team keys or imports into the till (Toast at Chiobu).
 * Pure logic only (rows, group order, size split, button names, file name). The workbook itself is written by
 * lib/pos-list-xlsx.ts. Nothing here is stored: everything is worked out from data the app already holds, and
 * no cost, GP or target ever appears in a row.
 */

/** The longest POS button name (characters). */
export const BUTTON_MAX = 19;
/** The only things written in the Notes column besides item notes. */
export const NOTE_NO_PRICE = "No price set";
export const NOTE_BUTTON_LONG = "Button name too long, shorten by hand";

export interface PosVenue {
  id: number;
  slug: string;
  /** full name, used in the title line */
  name: string;
  /** short name, used for the tab and the file name ("Chiobu") */
  short: string;
}

export interface PosRow {
  group: string;
  item: string;
  button: string;
  /** false when the button name could not be brought to BUTTON_MAX or less */
  buttonFits: boolean;
  size: string;
  priceInc: number | null;
  hhInc: number | null;
  notes: string;
  /** a row that needs a look before setup: no price, or a button name that does not fit. Shown yellow. */
  needsLook: boolean;
}

export interface PosSheet {
  venue: PosVenue;
  rows: PosRow[];
}

export interface PosInput {
  /** every menu item the app costs: stored items plus the virtual beer and gelato ones (virtual gelato ones are ignored here) */
  items: MenuItem[];
  beers: Beer[];
  /** active tap beer serves */
  beerServes: BeerServe[];
  /** active gelato serves */
  gelatoServes: GelatoServe[];
}

/* ------------------------------------------------------------------ names */

// Title Case lives in lib/name-tidy.ts (shared with the name tidy on the entry screens); re-exported for the POS list tests.
export { titleCase };

/** Categories whose names can contain " - " for another reason, so they are never split into item and size. */
const NO_SPLIT = new Set(["Food", "Cocktail", "Mocktail"]);

/** "House Red - 150ml Glass" -> item "House Red", size "150ml Glass": split on the LAST " - ". No separator: no size. */
export function splitSize(name: string, category: string): { item: string; size: string } {
  const n = name.trim();
  if (NO_SPLIT.has(category)) return { item: n, size: "" };
  const at = n.lastIndexOf(" - ");
  if (at <= 0) return { item: n, size: "" };
  const item = n.slice(0, at).trim();
  const size = n.slice(at + 3).trim();
  return item && size ? { item, size } : { item: n, size: "" };
}

/* ------------------------------------------------------------ button names */

const DROP_WORDS = ["Chicken", "Salad", "Crispy", "Traditional", "Classic"];
/** Tried in this order, one at a time, stopping as soon as the name fits. */
const ABBREVIATIONS: Array<[RegExp, string]> = [
  [/\bSalt (?:&|and) Pepper\b/g, "S&P"],
  [/\bBarramundi\b/g, "Barra"],
  [/\bMargarita\b/g, "Marg"],
  [/\bSauvignon\b/g, "Sauv"],
  [/\bChardonnay\b/g, "Chard"],
  [/\bCabernet\b/g, "Cab"],
  [/\bStrawberry\b/g, "Strawb"],
  [/\bRaspberry\b/g, "Rasp"],
  [/\bVegetables?\b/g, "Veg"],
  [/\bVegetarian\b/g, "Veg"],
  [/\bMushrooms?\b/g, "Mush"],
  [/\bMarinated\b/g, "Marin"],
  [/\bCaramelised\b/g, "Caramel"],
  [/\bParmigiana\b/g, "Parma"],
  [/\bSandwich\b/g, "Sando"],
  [/\bChocolate\b/g, "Choc"],
  [/\bLemongrass\b/g, "LG"],
  [/\bMasterpeace\b/g, "MP"],
  [/\bSpring Rolls?\b/g, "Spr Roll"],
  [/\bDumplings?\b/g, "Dumpling"],
  [/\bPassionfruit\b/g, "Passion"],
  [/\bVietnamese\b/g, "Viet"],
];

const tidy = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * The POS button name, 19 characters or fewer, never stored. Starts from the item name; if too long, in order:
 * " and " becomes " & ", a leading "The " goes, a trailing "(3)" count goes, then words like Chicken and Salad go (one at
 * a time, only while still too long), then known long words are abbreviated, then the name is cut at a word boundary.
 * `fits` is false only when even that cannot get under the limit (one very long word): the caller flags the row.
 */
export function buttonName(item: string, max: number = BUTTON_MAX): { name: string; fits: boolean } {
  let s = tidy(item);
  const ok = () => s.length <= max;
  if (ok()) return { name: s, fits: true };

  s = tidy(s.replace(/\s+and\s+/gi, " & "));
  if (ok()) return { name: s, fits: true };

  s = tidy(s.replace(/^the\s+/i, ""));
  if (ok()) return { name: s, fits: true };

  const noCount = tidy(s.replace(/\s*\(\d+\)\s*$/, ""));
  if (noCount) s = noCount;
  if (ok()) return { name: s, fits: true };

  for (const w of DROP_WORDS) {
    const words = s.split(" ");
    const idx = words.findIndex((x) => x.toLowerCase() === w.toLowerCase());
    if (idx >= 0 && words.length > 1) {
      words.splice(idx, 1);
      s = words.join(" ");
      if (ok()) return { name: s, fits: true };
    }
  }

  for (const [re, to] of ABBREVIATIONS) {
    const next = tidy(s.replace(re, to));
    if (next !== s) {
      s = next;
      if (ok()) return { name: s, fits: true };
    }
  }

  // last resort: cut at a word boundary, never leaving a dangling "&", "of" and the like
  const words = s.split(" ");
  while (words.length > 1 && words.join(" ").length > max) words.pop();
  while (words.length > 1 && /^(&|and|of|with|in|on|the|a|an|-)$/i.test(words[words.length - 1])) words.pop();
  s = words.join(" ");
  return { name: s, fits: s.length > 0 && s.length <= max };
}

/* ------------------------------------------------------------------ groups */

/** Where each menu group sits. "Smalls" and "Mains" are Chiobu's words for Small chow and Big chow. */
const GROUP_ORDER: string[][] = [["small chow", "smalls"], ["salads"], ["sides"], ["big chow", "mains"], ["food"], ["cocktails"], ["mocktails"], ["wine"], ["tap beer"], ["soft drinks"]];

export function groupRank(group: string): number {
  const g = group.trim().toLowerCase();
  const i = GROUP_ORDER.findIndex((names) => names.includes(g));
  return i >= 0 ? i : GROUP_ORDER.length;
}

const CATEGORY_GROUP: Record<string, string> = {
  Cocktail: "Cocktails",
  Mocktail: "Mocktails",
  "Cold Drink": "Soft Drinks",
  Wine: "Wine",
  Food: "Food",
  "Tap Beer": "Tap Beer",
};

/** Menu Group: the item's section when set, otherwise by category (any other category is its own group). */
export function menuGroup(category: string, section: string | null | undefined): string {
  const s = (section ?? "").trim();
  if (s) return s;
  return CATEGORY_GROUP[category] ?? (category.trim() || "Other");
}

/* ------------------------------------------------------------------- sizes */

const NAMED_SIZE_ML: Record<string, number> = { pot: 285, middy: 285, schooner: 425, pint: 570, jug: 1140, pitcher: 1140, small: 150, regular: 250, medium: 250, large: 400 };
const BOTTLE_BASE = 100000;
const UNKNOWN_SIZE = 50000;

/**
 * Where a size sorts inside an item: by millilitres when the name has them ("150ml Glass", "Pot 285ml"), by the usual
 * Pot / Schooner / Pint / Jug order otherwise, bottles after every glass, anything unrecognised between the two.
 */
export function sizeRank(size: string): number {
  const s = size.toLowerCase();
  const ml = s.match(/(\d+(?:\.\d+)?)\s*ml\b/);
  const litres = s.match(/(\d+(?:\.\d+)?)\s*l\b/);
  const amount = ml ? Number(ml[1]) : litres ? Number(litres[1]) * 1000 : null;
  if (/\bbottle\b/.test(s)) return BOTTLE_BASE + (amount ?? 0);
  if (amount != null) return amount;
  for (const w of s.split(/[^a-z]+/)) if (w in NAMED_SIZE_ML) return NAMED_SIZE_ML[w];
  return UNKNOWN_SIZE;
}

/* ------------------------------------------------------------------- notes */

const NOTE_MAX = 60;
const NOTE_PLAIN = /^[A-Za-z0-9 ,.'’&()/+!-]+$/;
/** words that mark a note as internal (costing, suppliers, to-dos): never put on a file that gets passed around onsite */
const NOTE_INTERNAL = /\b(cost|costs|gp|margin|supplier|invoice|price|prices|pricing|target|check|todo|tbc|confirm|ask|fix|wrong)\b/i;

/** The item's own note, only when it is short and plain enough to pass around. Otherwise "". */
export function plainNote(note: string | null | undefined): string {
  const n = (note ?? "").trim();
  if (!n || n.length > NOTE_MAX || !NOTE_PLAIN.test(n) || NOTE_INTERNAL.test(n)) return "";
  return n;
}

/* -------------------------------------------------------------------- rows */

const money = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
};

interface Draft extends PosRow {
  /** sort position of the size inside its item */
  sizeOrder: number;
}

function makeRow(parts: { group: string; item: string; size: string; sizeOrder: number; priceInc: unknown; hhInc: unknown; note: string }): Draft {
  const button = buttonName(parts.item);
  const priceInc = money(parts.priceInc);
  const flags = [priceInc == null ? NOTE_NO_PRICE : "", button.fits ? "" : NOTE_BUTTON_LONG].filter(Boolean);
  const notes = [...flags, parts.note].filter(Boolean).join(". ");
  return {
    group: parts.group,
    item: parts.item,
    button: button.name,
    buttonFits: button.fits,
    size: parts.size,
    priceInc,
    hhInc: money(parts.hhInc),
    notes,
    needsLook: flags.length > 0,
    sizeOrder: parts.sizeOrder,
  };
}

/**
 * The Size / Option text of a tap beer serve: the serve's name and its size, once. "Schooner" and 425 read "Schooner 425ml", but a serve
 * whose name already carries its size ("500ml Glass", 500) is left as "500ml Glass" and not "500ml Glass 500ml" (Troy, 11 Oct 2026).
 */
export function serveSizeLabel(name: string, ml: number): string {
  const n = titleCase(name.trim());
  const size = Math.round(Number(ml) * 100) / 100;
  const already = new RegExp(`(^|[^0-9.])${String(size).replace(".", "\\.")}\\s*(ml|millilitres?|milliliters?)(?![a-z])`, "i").test(n);
  return already ? n : `${n} ${size}ml`;
}

const byText = (a: string, b: string) => a.localeCompare(b, "en", { sensitivity: "base" });

/** The rows for one venue, in menu order. Active items only. */
export function buildPosRows(input: PosInput, venueId: number): PosRow[] {
  const out: Draft[] = [];
  const beerById = new Map(input.beers.map((b) => [b.id, b]));
  const serveById = new Map(input.beerServes.map((s) => [s.id, s]));

  for (const it of input.items) {
    if (it.venue_id !== venueId || !isActive(it)) continue;
    if (isBeerItemId(it.id)) {
      const ids = parseBeerItemId(it.id);
      const beer = ids ? beerById.get(ids.beerId) : undefined;
      const serve = ids ? serveById.get(ids.serveId) : undefined;
      if (!beer || !serve) continue;
      const size = serveSizeLabel(serve.name, Number(serve.ml));
      out.push(makeRow({ group: "Tap Beer", item: titleCase(beer.name), size, sizeOrder: sizeRank(size), priceInc: it.sell_price_inc, hhInc: it.hh_price_inc, note: "" }));
      continue;
    }
    if (isVirtualItemId(it.id)) continue; // gelato flavour x serve: gelato is listed by serve below
    // a plain menu item filed under Tap Beer or Gelato is a mistake (a keg or a flavour typed in as a menu item): those two are listed from the beer and serve tables only
    if (OWN_FORM_CATEGORIES.includes(it.category)) continue;
    const { item, size } = splitSize(it.name, it.category);
    const sz = size ? titleCase(size) : "";
    out.push(
      makeRow({
        group: menuGroup(it.category, it.section),
        item: titleCase(item),
        size: sz,
        sizeOrder: sz ? sizeRank(sz) : 0,
        priceInc: it.sell_price_inc,
        hhInc: it.hh_price_inc,
        note: plainNote(it.notes),
      }),
    );
  }

  // gelato: one row per serve that is on the menu, with its price (flavours are not listed)
  const serves = input.gelatoServes.filter((s) => s.venue_id === venueId && isActive(s) && s.on_menu).sort((a, b) => a.sort - b.sort || byText(a.name, b.name));
  serves.forEach((s, i) => {
    out.push(makeRow({ group: "Gelato", item: "Gelato", size: titleCase(s.name), sizeOrder: i, priceInc: s.sell_price_inc, hhInc: null, note: "" }));
  });

  out.sort(
    (a, b) =>
      groupRank(a.group) - groupRank(b.group) ||
      byText(a.group, b.group) ||
      byText(a.item, b.item) ||
      a.sizeOrder - b.sizeOrder ||
      byText(a.size, b.size),
  );
  return out.map(({ sizeOrder: _o, ...row }) => row);
}

/**
 * The sheets to write. `venueSlug` null means All: one sheet per venue that has rows, in the order given.
 * A venue with nothing to list has no sheet, so an empty result means there is nothing to download.
 */
export function buildPosSheets(input: PosInput, venues: PosVenue[], venueSlug: string | null): PosSheet[] {
  const chosen = venueSlug ? venues.filter((v) => v.slug === venueSlug) : venues;
  return chosen.map((venue) => ({ venue, rows: buildPosRows(input, venue.id) })).filter((s) => s.rows.length > 0);
}

/* --------------------------------------------------------------- file name */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "7 Oct 2026" in Brisbane time. */
export function brisbaneDateLabel(at: Date): string {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Brisbane", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(at).map((x) => [x.type, x.value]));
  return `${Number(p.day)} ${MONTHS[Number(p.month) - 1]} ${p.year}`;
}

/** "Chiobu POS List (7 Oct 2026).xlsx"; All venues: "All Venues POS List (...)". */
export function posFileName(venueShort: string | null, at: Date): string {
  const who = (venueShort ?? "").trim().replace(/[\\/:*?"<>|]/g, "") || "All Venues";
  return `${who} POS List (${brisbaneDateLabel(at)}).xlsx`;
}

/** An Excel tab name: at most 31 characters, none of []:*?/\ , and never "Notes" (that tab is ours). */
export function sheetTabName(short: string, taken: ReadonlySet<string> = new Set()): string {
  let base = short.replace(/[[\]:*?/\\]/g, "").trim().slice(0, 31) || "Venue";
  if (base.toLowerCase() === "notes") base = "Notes (venue)";
  let name = base;
  for (let n = 2; taken.has(name.toLowerCase()); n += 1) name = `${base.slice(0, 28)} ${n}`;
  return name;
}
